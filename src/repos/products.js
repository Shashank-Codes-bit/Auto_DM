import { ValidationError, parseRupees, slugify } from '../util.js';

export const MAX_IMAGES = 6;

const COLS = `id, name, slug, description, price_paise, mrp_paise, images, option_label, option_values, stock, active,
  created_at, updated_at`;

/** Turns admin form input into a clean product record, or throws ValidationError. */
export function normalizeProduct(input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new ValidationError('Name is required');
  if (name.length > 120) throw new ValidationError('Name must be 120 characters or fewer');

  const price_paise = parseRupees(input.price, 'Price');
  if (price_paise == null) throw new ValidationError('Price is required');
  const mrp_paise = parseRupees(input.mrp, 'MRP');
  if (mrp_paise != null && mrp_paise < price_paise) throw new ValidationError('MRP must be the same as or higher than the price');

  const images = (Array.isArray(input.images) ? input.images : [])
    .map((u) => String(u).trim())
    .filter(Boolean);
  for (const u of images) {
    if (!/^(https?:\/\/|\/media\/)/i.test(u)) throw new ValidationError(`Image must be an uploaded file or an http(s) link: ${u}`);
  }
  if (images.length > MAX_IMAGES) throw new ValidationError(`A product can have at most ${MAX_IMAGES} images`);

  const option_values = String(input.option_values ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const option_label = option_values.length ? String(input.option_label ?? '').trim() || 'Option' : '';

  const stockRaw = String(input.stock ?? '').trim();
  let stock = null;
  if (stockRaw !== '') {
    if (!/^\d+$/.test(stockRaw)) throw new ValidationError('Stock must be a whole number, or empty for unlimited');
    stock = Number(stockRaw);
  }

  return {
    name,
    description: String(input.description ?? '').trim(),
    price_paise,
    mrp_paise,
    images,
    option_label,
    option_values,
    stock,
    active: input.active === true || input.active === 'on' || input.active === 'true',
  };
}

export function productsRepo(db) {
  async function uniqueSlug(name, exceptId = null) {
    const base = slugify(name) || 'product';
    for (let i = 1; ; i++) {
      const slug = i === 1 ? base : `${base}-${i}`;
      const [hit] = await db.query('SELECT id FROM products WHERE slug = $1 AND ($2::int IS NULL OR id <> $2)', [slug, exceptId]);
      if (!hit) return slug;
    }
  }

  return {
    async list({ search = '', status = 'all' } = {}) {
      return db.query(
        `SELECT ${COLS},
           (SELECT count(*)::int FROM reel_products rp WHERE rp.product_id = p.id) AS reel_count
         FROM products p
         WHERE ($1 = '' OR name ILIKE '%' || $1 || '%')
           AND ($2 = 'all' OR ($2 = 'active' AND active) OR ($2 = 'archived' AND NOT active))
         ORDER BY active DESC, updated_at DESC`,
        [search.trim(), status],
      );
    },
    /** Storefront listing: active products, newest first, with optional name search. */
    async listActive({ search = '', limit = 24, offset = 0 } = {}) {
      const where = `active AND ($1 = '' OR name ILIKE '%' || $1 || '%')`;
      const [{ total }] = await db.query(`SELECT count(*)::int AS total FROM products WHERE ${where}`, [search.trim()]);
      const products = await db.query(
        `SELECT ${COLS} FROM products WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [search.trim(), Math.min(Math.max(limit, 1), 500), Math.max(offset, 0)],
      );
      return { products, total };
    },
    async getActiveBySlug(slug) {
      const [row] = await db.query(`SELECT ${COLS} FROM products WHERE slug = $1 AND active`, [String(slug)]);
      return row || null;
    },
    async getActiveByIds(ids) {
      const clean = [...new Set([].concat(ids).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50);
      if (!clean.length) return [];
      return db.query(`SELECT ${COLS} FROM products WHERE id = ANY($1::int[]) AND active`, [clean]);
    },
    async get(id) {
      const [row] = await db.query(`SELECT ${COLS} FROM products WHERE id = $1`, [Number(id) || 0]);
      return row || null;
    },
    async create(input) {
      const p = normalizeProduct(input);
      const [row] = await db.query(
        `INSERT INTO products (name, slug, description, price_paise, mrp_paise, images, option_label, option_values, stock, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${COLS}`,
        [p.name, await uniqueSlug(p.name), p.description, p.price_paise, p.mrp_paise, JSON.stringify(p.images),
          p.option_label, p.option_values, p.stock, p.active],
      );
      return row;
    },
    async update(id, input) {
      const p = normalizeProduct(input);
      const [row] = await db.query(
        `UPDATE products SET name = $2, slug = $3, description = $4, price_paise = $5, mrp_paise = $6, images = $7,
           option_label = $8, option_values = $9, stock = $10, active = $11, updated_at = now()
         WHERE id = $1 RETURNING ${COLS}`,
        [Number(id), p.name, await uniqueSlug(p.name, Number(id)), p.description, p.price_paise, p.mrp_paise,
          JSON.stringify(p.images), p.option_label, p.option_values, p.stock, p.active],
      );
      if (!row) throw new ValidationError('Product not found');
      return row;
    },
    /** Deletes a product unless it appears in an order; those can only be archived. */
    async remove(id) {
      const [used] = await db.query('SELECT 1 FROM order_items WHERE product_id = $1 LIMIT 1', [Number(id)]);
      if (used) throw new ValidationError('This product is part of an order, so it can’t be deleted. Archive it instead.');
      await db.query('DELETE FROM products WHERE id = $1', [Number(id)]);
    },
  };
}
