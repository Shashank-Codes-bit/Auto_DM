import { ValidationError, slugify } from '../util.js';

export const MIN_REEL_PRODUCTS = 1;
export const MAX_REEL_PRODUCTS = 20;

const COLS = `r.ig_media_id, r.slug, r.headline, r.keywords, r.dm_message, r.button_text, r.public_reply, r.active,
  r.permalink, r.thumbnail_url, r.video_url, r.caption, r.created_at, r.updated_at, r.media_checked_at`;

export function normalizeReel(input) {
  const keywords = String(input.keywords ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (!keywords.length) throw new ValidationError('Add at least one keyword people can comment');

  const slug = slugify(input.slug || input.headline || '');
  if (!slug) throw new ValidationError('Add a headline or a store link name');

  const productIds = [...new Set((Array.isArray(input.productIds) ? input.productIds : []).map(Number).filter(Boolean))];
  if (productIds.length < MIN_REEL_PRODUCTS) throw new ValidationError('Pick at least 1 product for this reel');
  if (productIds.length > MAX_REEL_PRODUCTS) throw new ValidationError(`A reel can show at most ${MAX_REEL_PRODUCTS} products`);

  const buttonText = String(input.button_text ?? '').trim() || 'Shop now';
  if (buttonText.length > 20) throw new ValidationError('Button text must be 20 characters or fewer');

  return {
    slug,
    headline: String(input.headline ?? '').trim(),
    keywords,
    dm_message: String(input.dm_message ?? '').trim() || 'Hey @{username}! Here’s everything from the reel 👇',
    button_text: buttonText,
    public_reply: String(input.public_reply ?? '').trim(),
    active: input.active === true || input.active === 'on' || input.active === 'true',
    permalink: String(input.permalink ?? ''),
    thumbnail_url: String(input.thumbnail_url ?? ''),
    caption: String(input.caption ?? '').slice(0, 500),
    video_url: /^https:\/\//i.test(String(input.video_url ?? '')) ? String(input.video_url) : '',
    productIds,
  };
}

export function reelsRepo(db) {
  async function productsFor(reelId, { activeOnly = false } = {}) {
    return db.query(
      `SELECT p.*, rp.position FROM reel_products rp JOIN products p ON p.id = rp.product_id
       WHERE rp.reel_id = $1 AND (NOT $2 OR p.active) ORDER BY rp.position`,
      [reelId, activeOnly],
    );
  }

  return {
    /** All configured reels with funnel numbers for the admin. */
    async list() {
      return db.query(
        `SELECT ${COLS},
           (SELECT count(*)::int FROM reel_products rp WHERE rp.reel_id = r.ig_media_id) AS product_count,
           (SELECT count(*)::int FROM activity a WHERE a.reel_id = r.ig_media_id AND a.result = 'sent') AS dm_count,
           (SELECT count(*)::int FROM visits v WHERE v.reel_id = r.ig_media_id) AS visit_count,
           (SELECT count(*)::int FROM orders o WHERE o.reel_id = r.ig_media_id AND o.status <> 'cancelled') AS order_count
         FROM reels r ORDER BY r.updated_at DESC`,
      );
    },
    async get(id) {
      const [reel] = await db.query(`SELECT ${COLS} FROM reels r WHERE r.ig_media_id = $1`, [String(id)]);
      if (!reel) return null;
      reel.products = await productsFor(reel.ig_media_id);
      return reel;
    },
    /** Reel for the public store page: must be active, shows only active products. */
    async getStore(slug) {
      const [reel] = await db.query(`SELECT ${COLS} FROM reels r WHERE r.slug = $1`, [String(slug)]);
      if (!reel) return null;
      reel.products = await productsFor(reel.ig_media_id, { activeOnly: true });
      return reel;
    },
    /** Used by the webhook: only active reels send DMs. */
    async getActiveByMediaId(id) {
      const [reel] = await db.query(`SELECT ${COLS} FROM reels r WHERE r.ig_media_id = $1 AND r.active`, [String(id)]);
      return reel || null;
    },
    async save(id, input) {
      const r = normalizeReel(input);
      const mediaId = String(id ?? '').trim();
      if (!/^\d+$/.test(mediaId)) throw new ValidationError('Invalid Instagram post ID');

      const [taken] = await db.query('SELECT 1 FROM reels WHERE slug = $1 AND ig_media_id <> $2', [r.slug, mediaId]);
      if (taken) throw new ValidationError(`The store link “${r.slug}” is already used by another reel`);
      const found = await db.query('SELECT id FROM products WHERE id = ANY($1::int[])', [r.productIds]);
      if (found.length !== r.productIds.length) throw new ValidationError('One of the picked products no longer exists');

      await db.tx(async (t) => {
        await t.query(
          `INSERT INTO reels (ig_media_id, slug, headline, keywords, dm_message, button_text, public_reply, active,
             permalink, thumbnail_url, caption, video_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (ig_media_id) DO UPDATE SET slug = $2, headline = $3, keywords = $4, dm_message = $5,
             button_text = $6, public_reply = $7, active = $8,
             permalink = COALESCE(NULLIF($9, ''), reels.permalink),
             thumbnail_url = COALESCE(NULLIF($10, ''), reels.thumbnail_url),
             caption = COALESCE(NULLIF($11, ''), reels.caption),
             video_url = COALESCE(NULLIF($12, ''), reels.video_url), updated_at = now()`,
          [mediaId, r.slug, r.headline, r.keywords, r.dm_message, r.button_text, r.public_reply, r.active,
            r.permalink, r.thumbnail_url, r.caption, r.video_url],
        );
        await t.query('DELETE FROM reel_products WHERE reel_id = $1', [mediaId]);
        for (const [i, pid] of r.productIds.entries()) {
          await t.query('INSERT INTO reel_products (reel_id, product_id, position) VALUES ($1, $2, $3)', [mediaId, pid, i]);
        }
      });
      return this.get(mediaId);
    },
    /** Instagram thumbnail links expire, so store pages refresh them from time to time. */
    async updateMediaInfo(id, { thumbnail_url, permalink, video_url }) {
      await db.query(
        `UPDATE reels SET thumbnail_url = COALESCE(NULLIF($2, ''), thumbnail_url), permalink = COALESCE(NULLIF($3, ''), permalink),
           video_url = COALESCE(NULLIF($4, ''), video_url), media_checked_at = now() WHERE ig_media_id = $1`,
        [String(id), thumbnail_url || '', permalink || '', video_url || ''],
      );
    },
    /**
     * The reels feed: live reels with at least one active product, newest first (Instagram IDs grow over time).
     * `cursor` is the last reel ID already shown. Each reel carries its product count and first 3 products.
     */
    async feed({ cursor = '', limit = 8 } = {}) {
      const rows = await db.query(
        `SELECT ${COLS},
           (SELECT count(*)::int FROM reel_products rp JOIN products p ON p.id = rp.product_id WHERE rp.reel_id = r.ig_media_id AND p.active) AS product_count
         FROM reels r
         WHERE r.active
           AND EXISTS (SELECT 1 FROM reel_products rp JOIN products p ON p.id = rp.product_id WHERE rp.reel_id = r.ig_media_id AND p.active)
           AND ($1 = '' OR (length(r.ig_media_id), r.ig_media_id) < (length($1), $1))
         ORDER BY length(r.ig_media_id) DESC, r.ig_media_id DESC
         LIMIT $2`,
        [String(cursor), Math.min(Math.max(limit, 1), 20) + 1],
      );
      const more = rows.length > limit;
      const reels = rows.slice(0, limit);
      for (const reel of reels) reel.preview = (await productsFor(reel.ig_media_id, { activeOnly: true })).slice(0, 3);
      return { reels, nextCursor: more ? reels[reels.length - 1].ig_media_id : null };
    },
    async remove(id) {
      await db.query('DELETE FROM reels WHERE ig_media_id = $1', [String(id)]);
    },
    async recordVisit(reelId, source = '') {
      await db.query('INSERT INTO visits (reel_id, source) VALUES ($1, $2)', [reelId, String(source).slice(0, 20)]);
    },
  };
}
