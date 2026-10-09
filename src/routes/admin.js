import express from 'express';
import multer from 'multer';
import { ValidationError, parseRupees } from '../util.js';
import { ALLOWED_IMAGE_TYPES } from '../repos/media.js';
import {
  activityPage, adminLayout, dashboardPage, loginPage, orderDetailPage, ordersPage, productFormPage, productValues,
  productsPage, reelFormPage, reelValues, reelsPage, settingsPage,
} from '../views/admin.js';

const FLASH = {
  saved: 'Saved.',
  created: 'Created.',
  deleted: 'Deleted.',
  reel_saved: 'Reel store saved. Comments with its keyword now get a DM with the store link.',
  reel_removed: 'Reel store removed.',
  status: 'Order updated.',
};

export const baseUrlFor = (req, config) =>
  config.publicBaseUrl || `${req.protocol}://${req.get('x-forwarded-host') || req.get('host')}`;

const list = (v) => [].concat(v ?? []).filter((x) => x !== '');

export function adminRoutes({ repos, ig, auth, config }) {
  const r = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, ALLOWED_IMAGE_TYPES.includes(file.mimetype)),
  });

  const safeNext = (n) => (typeof n === 'string' && /^\/admin(\/|$|\?)/.test(n) ? n : '/admin');

  // ---- login (public) ----
  r.get('/login', (req, res) => res.type('html').send(String(loginPage({ next: safeNext(req.query.next), enabled: auth.enabled }))));
  r.post('/login', (req, res) => {
    const result = auth.checkPassword(req, req.body?.password);
    if (result === 'ok') {
      auth.login(req, res);
      return res.redirect(303, safeNext(req.body?.next));
    }
    const error = result === 'locked' ? 'Too many attempts. Wait 15 minutes and try again.' : 'Wrong password.';
    res.status(401).type('html').send(String(loginPage({ error, next: safeNext(req.body?.next), enabled: auth.enabled })));
  });

  // ---- everything below needs a login ----
  r.use((req, res, next) => auth.require(req, res, next));

  r.post('/logout', (_req, res) => {
    auth.logout(res);
    res.redirect(303, '/admin/login');
  });

  const page = async (req, res, { title, active, body, error, status = 200 }) => {
    const stats = await repos.stats.dashboard();
    const flash = { ok: FLASH[req.query.ok], error };
    res
      .status(status)
      .type('html')
      .send(String(adminLayout({ title, active, body, csrf: req.csrf, flash, badges: { orders: stats.to_confirm } })));
  };

  // ---- dashboard ----
  r.get('/', async (req, res) => {
    const [stats, reels, orders, activity] = await Promise.all([
      repos.stats.dashboard(), repos.reels.list(), repos.orders.list(), repos.activity.list({ limit: 8 }),
    ]);
    const warnings = [];
    if (!config.accessToken) warnings.push('IG_ACCESS_TOKEN is missing in .env, so DMs can’t be sent.');
    if (config.dryRun) warnings.push('Test mode is on (DRY_RUN=1): DMs are logged, not sent.');
    if (!config.publicBaseUrl) warnings.push(`PUBLIC_BASE_URL isn’t set. DM links will use ${baseUrlFor(req, config)} — set it in .env to be sure.`);
    await page(req, res, { title: 'Dashboard', active: 'dashboard', body: dashboardPage({ stats, reels, orders: orders.slice(0, 6), activity, warnings }) });
  });

  // ---- products ----
  r.get('/products', async (req, res) => {
    const search = String(req.query.search || '');
    const status = ['active', 'archived'].includes(req.query.status) ? req.query.status : 'all';
    const products = await repos.products.list({ search, status });
    await page(req, res, { title: 'Products', active: 'products', body: productsPage({ products, search, status }) });
  });

  r.get('/products/new', async (req, res) => {
    await page(req, res, { title: 'Add product', active: 'products', body: productFormPage({ product: null, values: productValues(null), csrf: req.csrf }) });
  });

  const productInput = (body) => ({ ...body, images: list(body.images) });

  r.post('/products', async (req, res) => {
    try {
      const p = await repos.products.create(productInput(req.body));
      res.redirect(303, `/admin/products/${p.id}?ok=created`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      const values = { ...productInput(req.body), active: Boolean(req.body.active) };
      await page(req, res, { title: 'Add product', active: 'products', status: 400, error: err.message, body: productFormPage({ product: null, values, csrf: req.csrf }) });
    }
  });

  r.get('/products/:id', async (req, res) => {
    const product = await repos.products.get(req.params.id);
    if (!product) return res.redirect('/admin/products');
    await page(req, res, { title: product.name, active: 'products', body: productFormPage({ product, values: productValues(product), csrf: req.csrf }) });
  });

  r.post('/products/:id', async (req, res) => {
    const product = await repos.products.get(req.params.id);
    if (!product) return res.redirect(303, '/admin/products');
    try {
      await repos.products.update(product.id, productInput(req.body));
      res.redirect(303, `/admin/products/${product.id}?ok=saved`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      const values = { ...productInput(req.body), active: Boolean(req.body.active) };
      await page(req, res, { title: product.name, active: 'products', status: 400, error: err.message, body: productFormPage({ product, values, csrf: req.csrf }) });
    }
  });

  r.post('/products/:id/delete', async (req, res) => {
    const product = await repos.products.get(req.params.id);
    if (!product) return res.redirect(303, '/admin/products');
    try {
      await repos.products.remove(product.id);
      res.redirect(303, '/admin/products?ok=deleted');
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      await page(req, res, { title: product.name, active: 'products', status: 400, error: err.message, body: productFormPage({ product, values: productValues(product), csrf: req.csrf }) });
    }
  });

  // Image upload from the product form (one file per request, sent by admin.js).
  r.post('/media', (req, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each photo must be 5 MB or smaller' : err.message });
      if (!req.file) return res.status(400).json({ error: 'Upload a JPG, PNG, WebP or GIF image' });
      const id = await repos.media.save(req.file.buffer, req.file.mimetype);
      res.status(201).json({ url: `/media/${id}` });
    });
  });

  // ---- reels ----
  r.get('/reels', async (req, res) => {
    let posts = [];
    let postsError = '';
    try {
      posts = (await ig.listMedia(50)).data || [];
    } catch (err) {
      postsError = err.message;
    }
    const reels = await repos.reels.list();
    await page(req, res, { title: 'Reels', active: 'reels', body: reelsPage({ posts, postsError, reels }) });
  });

  async function reelEditor(req, res, { values, error, status }) {
    const mediaId = String(req.params.id);
    const reel = await repos.reels.get(mediaId);
    let post = null;
    try {
      post = await ig.getMedia(mediaId);
    } catch {
      // Instagram unreachable or post deleted: edit with what we have stored.
    }
    if (!reel && !post) return res.redirect(303, '/admin/reels');
    const products = await repos.products.list();
    await page(req, res, {
      title: 'Reel store', active: 'reels', status, error,
      body: reelFormPage({ mediaId, post, reel, products, values: values || reelValues(reel, post), baseUrl: baseUrlFor(req, config), csrf: req.csrf }),
    });
  }

  r.get('/reels/:id', (req, res) => reelEditor(req, res, {}));

  r.post('/reels/:id', async (req, res) => {
    const input = { ...req.body, productIds: list(req.body.productIds) };
    try {
      await repos.reels.save(req.params.id, input);
      res.redirect(303, `/admin/reels/${req.params.id}?ok=reel_saved`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      await reelEditor(req, res, { values: { ...input, active: Boolean(req.body.active) }, error: err.message, status: 400 });
    }
  });

  r.post('/reels/:id/delete', async (req, res) => {
    await repos.reels.remove(req.params.id);
    res.redirect(303, '/admin/reels?ok=reel_removed');
  });

  // ---- orders ----
  r.get('/orders', async (req, res) => {
    const status = String(req.query.status || '');
    const search = String(req.query.search || '');
    const orders = await repos.orders.list({ status, search });
    await page(req, res, { title: 'Orders', active: 'orders', body: ordersPage({ orders, status, search }) });
  });

  async function orderView(req, res, { error, status } = {}) {
    const order = await repos.orders.get(req.params.id);
    if (!order) return res.redirect(303, '/admin/orders');
    const reel = order.reel_id ? await repos.reels.get(order.reel_id) : null;
    const settings = await repos.settings.getAll();
    await page(req, res, {
      title: order.order_number, active: 'orders', error, status,
      body: orderDetailPage({ order, reel, csrf: req.csrf, storeName: settings.store_name }),
    });
  }

  r.get('/orders/:id', (req, res) => orderView(req, res));

  r.post('/orders/:id/status', async (req, res) => {
    try {
      await repos.orders.setStatus(req.params.id, req.body.status, String(req.body.notes ?? '').slice(0, 1000));
      res.redirect(303, `/admin/orders/${req.params.id}?ok=status`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      await orderView(req, res, { error: err.message, status: 400 });
    }
  });

  // ---- activity ----
  r.get('/activity', async (req, res) => {
    const rows = await repos.activity.list({ limit: 200 });
    await page(req, res, { title: 'DM activity', active: 'activity', body: activityPage({ rows }) });
  });

  // ---- settings ----
  async function settingsView(req, res, { error, status } = {}) {
    const settings = await repos.settings.getAll();
    const connection = {
      baseUrl: baseUrlFor(req, config),
      baseUrlFromEnv: Boolean(config.publicBaseUrl),
      dryRun: config.dryRun,
      oneDmPerUser: config.oneDmPerUser,
      database: config.databaseUrl ? 'Postgres (DATABASE_URL)' : 'Built-in database in data/pgdata',
    };
    try {
      connection.account = config.accessToken ? await ig.getAccount() : null;
      if (!config.accessToken) connection.error = 'IG_ACCESS_TOKEN is missing in .env';
    } catch (err) {
      connection.error = err.message;
    }
    await page(req, res, { title: 'Settings', active: 'settings', error, status, body: settingsPage({ settings, connection, csrf: req.csrf }) });
  }

  r.get('/settings', (req, res) => settingsView(req, res));

  r.post('/settings', async (req, res) => {
    try {
      const b = req.body;
      if (!String(b.store_name || '').trim()) throw new ValidationError('Store name is required');
      const accent = /^#[0-9a-f]{6}$/i.test(b.accent_color || '') ? b.accent_color : '#B8336A';
      if (b.logo_url && !/^https?:\/\//i.test(b.logo_url)) throw new ValidationError('Logo link must start with http:// or https://');
      await repos.settings.update({
        store_name: b.store_name.trim(), tagline: b.tagline?.trim(), accent_color: accent, logo_url: b.logo_url?.trim(),
        instagram_handle: String(b.instagram_handle || '').trim().replace(/^@/, ''),
        shipping_fee_paise: parseRupees(b.shipping_fee, 'Delivery fee') ?? 0,
        free_shipping_above_paise: parseRupees(b.free_shipping_above, 'Free delivery amount') ?? 0,
        upi_id: b.upi_id?.trim() || 'demo@upi', upi_payee: b.upi_payee?.trim(),
        support_whatsapp: String(b.support_whatsapp || '').replace(/[^\d]/g, ''), support_email: b.support_email?.trim(),
      });
      res.redirect(303, '/admin/settings?ok=saved');
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      await settingsView(req, res, { error: err.message, status: 400 });
    }
  });

  return r;
}
