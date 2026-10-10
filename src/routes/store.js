import express from 'express';
import QRCode from 'qrcode';
import { ValidationError } from '../util.js';
import { HOME_PAGE_SIZE, checkoutPage, homePage, notFoundPage, orderPage, productForClient, productPage, reelStorePage } from '../views/store.js';

const MEDIA_REFRESH_MS = 6 * 60 * 60 * 1000;

export function storeRoutes({ repos, db, ig }) {
  // Instagram CDN thumbnail links expire; refresh in the background, at most every 6 hours per reel.
  const refreshing = new Set();
  function refreshMedia(reel) {
    if (!ig?.getMedia || refreshing.has(reel.ig_media_id)) return;
    if (Date.now() - new Date(reel.media_checked_at).getTime() < MEDIA_REFRESH_MS) return;
    refreshing.add(reel.ig_media_id);
    ig.getMedia(reel.ig_media_id)
      .then((m) => repos.reels.updateMediaInfo(reel.ig_media_id, { thumbnail_url: m.thumbnail_url || m.media_url, permalink: m.permalink }))
      .catch((err) => console.error(`Couldn't refresh reel ${reel.ig_media_id} thumbnail: ${err.message}`))
      .finally(() => refreshing.delete(reel.ig_media_id));
  }

  const r = express.Router();
  const page = (res, view, status = 200) => res.status(status).type('html').send(String(view));
  const notFound = async (res, message) => page(res, notFoundPage({ settings: await repos.settings.getAll(), message }), 404);

  r.get('/', async (req, res) => {
    const settings = await repos.settings.getAll();
    // Newest reel first: Instagram media IDs grow over time.
    const reels = await db.query(
      `SELECT r.slug, r.headline, r.thumbnail_url,
         (SELECT count(*)::int FROM reel_products rp JOIN products p ON p.id = rp.product_id WHERE rp.reel_id = r.ig_media_id AND p.active) AS product_count
       FROM reels r WHERE r.active
       ORDER BY length(r.ig_media_id) DESC, r.ig_media_id DESC`,
    );
    const search = String(req.query.q || '').slice(0, 80);
    const shown = Math.min(Math.max(Number(req.query.show) || HOME_PAGE_SIZE, HOME_PAGE_SIZE), 480);
    const { products, total } = await repos.products.listActive({ search, limit: shown });
    page(res, homePage({ settings, reels: reels.filter((r) => r.product_count > 0), products, total, search, shown: products.length }));
  });

  r.get('/p/:productSlug', async (req, res) => {
    const product = await repos.products.getActiveBySlug(req.params.productSlug);
    if (!product) return notFound(res, 'This product isn’t available.');
    page(res, productPage({ settings: await repos.settings.getAll(), reel: null, product }));
  });

  r.get('/r/:slug', async (req, res) => {
    const reel = await repos.reels.getStore(req.params.slug);
    if (!reel || !reel.active) return notFound(res, 'This reel’s store isn’t open right now.');
    // Admin previews (?preview=1) don't count as visits.
    if (!req.query.preview) await repos.reels.recordVisit(reel.ig_media_id, req.query.src || '');
    refreshMedia(reel);
    page(res, reelStorePage({ settings: await repos.settings.getAll(), reel }));
  });

  r.get('/r/:slug/p/:productSlug', async (req, res) => {
    const reel = await repos.reels.getStore(req.params.slug);
    const product = reel?.active && reel.products.find((p) => p.slug === req.params.productSlug);
    if (!product) return notFound(res, 'This product isn’t available.');
    page(res, productPage({ settings: await repos.settings.getAll(), reel, product }));
  });

  r.get('/checkout', async (_req, res) => page(res, checkoutPage({ settings: await repos.settings.getAll() })));

  r.get('/order/:token', async (req, res) => {
    const order = await repos.orders.getByToken(req.params.token);
    if (!order) return notFound(res, 'We couldn’t find that order.');
    const settings = await repos.settings.getAll();
    let qrSvg = '';
    let upiLink = '';
    if (order.status === 'awaiting_payment') {
      const upi = new URLSearchParams({
        pa: settings.upi_id,
        pn: settings.upi_payee || settings.store_name,
        am: (order.total_paise / 100).toFixed(2),
        cu: 'INR',
        tn: `Order ${order.order_number}`,
      });
      upiLink = `upi://pay?${upi}`;
      qrSvg = await QRCode.toString(upiLink, { type: 'svg', margin: 0, color: { dark: '#2a1b2e', light: '#ffffff' } });
    }
    res.set('Cache-Control', 'no-store');
    page(res, orderPage({ settings, order, qrSvg, upiLink }));
  });

  r.post('/order/:token/paid', async (req, res) => {
    await repos.orders.markPaymentSubmitted(req.params.token);
    res.redirect(303, `/order/${encodeURIComponent(req.params.token)}`);
  });

  return r;
}

export function apiRoutes({ repos }) {
  const r = express.Router();
  const hits = new Map();

  // Basic abuse protection: at most 20 order attempts per IP per 10 minutes.
  const limit = (req, res, next) => {
    const now = Date.now();
    const h = hits.get(req.ip) || { n: 0, reset: now + 10 * 60_000 };
    if (now > h.reset) Object.assign(h, { n: 0, reset: now + 10 * 60_000 });
    h.n++;
    hits.set(req.ip, h);
    if (h.n > 20) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    next();
  };

  // Used when the bag moves to another browser (e.g. Instagram → Chrome): fills in names, prices and photos.
  r.get('/products', async (req, res) => {
    const ids = String(req.query.ids || '').split(',');
    const products = await repos.products.getActiveByIds(ids);
    res.json({ products: products.map((p) => productForClient(p, '')) });
  });

  r.post('/orders', limit, async (req, res, next) => {
    try {
      const { items, customer, reelSlug, source } = req.body || {};
      const settings = await repos.settings.getAll();
      const reel = reelSlug ? await repos.reels.getStore(reelSlug) : null;
      const order = await repos.orders.create(
        { items, customer, reelId: reel?.ig_media_id ?? null, source: source || '' },
        settings,
      );
      res.status(201).json({ token: order.public_token, orderNumber: order.order_number });
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      next(err);
    }
  });

  return r;
}

export function mediaRoutes({ repos }) {
  const r = express.Router();
  r.get('/:id', async (req, res) => {
    const m = await repos.media.get(req.params.id);
    if (!m) return res.sendStatus(404);
    res.set({ 'Content-Type': m.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.send(m.data);
  });
  return r;
}
