import { PRICE_BANDS, ValidationError, parseRupees, slugify } from '../util.js';

export const MAX_IMAGES = 6;

const COLS = `id, name, slug, description, price_paise, mrp_paise, images, option_label, option_values, stock, active,
  featured, created_at, updated_at`;

export const SORTS = {
  popular: { label: 'Most popular', sql: 'featured DESC, sold DESC, created_at DESC, id DESC' },
  discount: { label: 'Biggest discount', sql: 'discount DESC, price_paise ASC, id DESC' },
  'price-asc': { label: 'Price: low to high', sql: 'price_paise ASC, id DESC' },
  'price-desc': { label: 'Price: high to low', sql: 'price_paise DESC, id DESC' },
  newest: { label: 'Newest', sql: 'created_at DESC, id DESC' },
};

// Extra computed columns used for sorting the storefront.
const STORE_COLS = `${COLS},
  (SELECT coalesce(sum(qty), 0)::int FROM order_items oi WHERE oi.product_id = products.id) AS sold,
  CASE WHEN mrp_paise > price_paise THEN (mrp_paise - price_paise)::float / mrp_paise ELSE 0 END AS discount`;

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
    featured: input.featured === true || input.featured === 'on' || input.featured === 'true',
    categoryIds: input.categoryIds === undefined ? undefined : [...new Set([].concat(input.categoryIds).map(Number).filter((n) => n > 0))],
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

  async function setCategories(q, productId, categoryIds) {
    if (categoryIds === undefined) return;
    await q.query('DELETE FROM product_categories WHERE product_id = $1', [productId]);
    for (const cid of categoryIds) {
      await q.query(
        'INSERT INTO product_categories (product_id, category_id) SELECT $1, id FROM categories WHERE id = $2 ON CONFLICT DO NOTHING',
        [productId, cid],
      );
    }
  }

  return {
    /** Admin list, optionally filtered by status and category. */
    async list({ search = '', status = 'all', category = 0 } = {}) {
      return db.query(
        `SELECT ${COLS},
           (SELECT count(*)::int FROM reel_products rp WHERE rp.product_id = p.id) AS reel_count,
           (SELECT coalesce(array_agg(c.name ORDER BY c.position), '{}') FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = p.id) AS category_names
         FROM products p
         WHERE ($1 = '' OR name ILIKE '%' || $1 || '%')
           AND ($2 = 'all' OR ($2 = 'active' AND active) OR ($2 = 'archived' AND NOT active) OR ($2 = 'featured' AND featured))
           AND ($3::int = 0 OR EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = $3))
         ORDER BY active DESC, updated_at DESC`,
        [search.trim(), status, Number(category) || 0],
      );
    },

    /**
     * Storefront listing: active products with search, category (slug), price band and sort.
     * Returns { products, total }.
     */
    async listActive({ search = '', category = '', band = '', sort = 'popular', limit = 24, offset = 0 } = {}) {
      const b = PRICE_BANDS.find((x) => x.key === band);
      const where = `active
        AND ($1 = '' OR name ILIKE '%' || $1 || '%')
        AND ($2 = '' OR EXISTS (SELECT 1 FROM product_categories pc JOIN categories c ON c.id = pc.category_id
                                WHERE pc.product_id = products.id AND c.slug = $2 AND c.visible))
        AND ($3::int IS NULL OR price_paise <= $3) AND ($4::int IS NULL OR price_paise >= $4)`;
      const params = [search.trim(), String(category || ''), b?.max ?? null, b?.min ?? null];
      const [{ total }] = await db.query(`SELECT count(*)::int AS total FROM products WHERE ${where}`, params);
      const order = (SORTS[sort] || SORTS.popular).sql;
      const products = await db.query(
        `SELECT ${STORE_COLS} FROM products WHERE ${where} ORDER BY ${order} LIMIT $5 OFFSET $6`,
        [...params, Math.min(Math.max(limit, 1), 500), Math.max(offset, 0)],
      );
      return { products, total };
    },
    /** Featured products for the home page's deals row, biggest discount first. */
    async featured(limit = 8) {
      return db.query(`SELECT ${STORE_COLS} FROM products WHERE active AND featured ORDER BY discount DESC, id LIMIT $1`, [limit]);
    },
    /** Products sharing a category with this one (falls back to bestsellers). */
    async related(product, limit = 6) {
      const rows = await db.query(
        `SELECT ${STORE_COLS} FROM products
         WHERE active AND id <> $1 AND EXISTS (
           SELECT 1 FROM product_categories a JOIN product_categories b ON a.category_id = b.category_id
           WHERE a.product_id = $1 AND b.product_id = products.id)
         ORDER BY featured DESC, discount DESC, id LIMIT $2`,
        [product.id, limit],
      );
      if (rows.length) return rows;
      return db.query(`SELECT ${STORE_COLS} FROM products WHERE active AND id <> $1 ORDER BY featured DESC, sold DESC, id DESC LIMIT $2`, [product.id, limit]);
    },
    async categoriesOf(productId) {
      return db.query(
        `SELECT c.* FROM product_categories pc JOIN categories c ON c.id = pc.category_id
         WHERE pc.product_id = $1 ORDER BY c.position, c.name`,
        [Number(productId)],
      );
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
      if (row) row.category_ids = (await db.query('SELECT category_id FROM product_categories WHERE product_id = $1', [row.id])).map((r) => r.category_id);
      return row || null;
    },
    async create(input) {
      const p = normalizeProduct(input);
      const slug = await uniqueSlug(p.name);
      return db.tx(async (t) => {
        const [row] = await t.query(
          `INSERT INTO products (name, slug, description, price_paise, mrp_paise, images, option_label, option_values, stock, active, featured)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLS}`,
          [p.name, slug, p.description, p.price_paise, p.mrp_paise, JSON.stringify(p.images),
            p.option_label, p.option_values, p.stock, p.active, p.featured],
        );
        await setCategories(t, row.id, p.categoryIds);
        return row;
      });
    },
    async update(id, input) {
      const p = normalizeProduct(input);
      const slug = await uniqueSlug(p.name, Number(id));
      return db.tx(async (t) => {
        const [row] = await t.query(
          `UPDATE products SET name = $2, slug = $3, description = $4, price_paise = $5, mrp_paise = $6, images = $7,
             option_label = $8, option_values = $9, stock = $10, active = $11, featured = $12, updated_at = now()
           WHERE id = $1 RETURNING ${COLS}`,
          [Number(id), p.name, slug, p.description, p.price_paise, p.mrp_paise,
            JSON.stringify(p.images), p.option_label, p.option_values, p.stock, p.active, p.featured],
        );
        if (!row) throw new ValidationError('Product not found');
        await setCategories(t, row.id, p.categoryIds);
        return row;
      });
    },
    async setCategoriesFor(productId, categoryIds) {
      await setCategories(db, Number(productId), categoryIds);
    },
    /** Deletes a product unless it appears in an order; those can only be archived. */
    async remove(id) {
      const [used] = await db.query('SELECT 1 FROM order_items WHERE product_id = $1 LIMIT 1', [Number(id)]);
      if (used) throw new ValidationError('This product is part of an order, so it can’t be deleted. Archive it instead.');
      await db.query('DELETE FROM products WHERE id = $1', [Number(id)]);
    },
  };
}
