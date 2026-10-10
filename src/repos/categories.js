import { ValidationError, slugify } from '../util.js';

export function normalizeCategory(input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new ValidationError('Name is required');
  if (name.length > 60) throw new ValidationError('Name must be 60 characters or fewer');
  const slug = slugify(input.slug || name);
  if (!slug) throw new ValidationError('Add a name with letters or numbers');
  const image_url = String(input.image_url ?? '').trim();
  if (image_url && !/^(https?:\/\/|\/media\/)/i.test(image_url)) throw new ValidationError('Image must be an uploaded file or an http(s) link');
  const position = Number.parseInt(input.position, 10);
  return {
    name,
    slug,
    image_url,
    description: String(input.description ?? '').trim().slice(0, 400),
    position: Number.isFinite(position) ? position : 0,
    visible: input.visible === true || input.visible === 'on' || input.visible === 'true',
  };
}

export function categoriesRepo(db) {
  const withCounts = `c.*, (SELECT count(*)::int FROM product_categories pc JOIN products p ON p.id = pc.product_id
                             WHERE pc.category_id = c.id AND p.active) AS product_count`;
  return {
    async list({ visibleOnly = false } = {}) {
      return db.query(`SELECT ${withCounts} FROM categories c WHERE (NOT $1 OR c.visible) ORDER BY c.position, c.name`, [visibleOnly]);
    },
    async get(id) {
      const [row] = await db.query(`SELECT ${withCounts} FROM categories c WHERE c.id = $1`, [Number(id) || 0]);
      return row || null;
    },
    async getBySlug(slug, { visibleOnly = true } = {}) {
      const [row] = await db.query(`SELECT ${withCounts} FROM categories c WHERE c.slug = $1 AND (NOT $2 OR c.visible)`, [String(slug), visibleOnly]);
      return row || null;
    },
    async findByName(name) {
      const [row] = await db.query('SELECT * FROM categories WHERE lower(name) = lower($1)', [String(name)]);
      return row || null;
    },
    async save(id, input) {
      const c = normalizeCategory(input);
      const [taken] = await db.query('SELECT 1 FROM categories WHERE slug = $1 AND ($2::int IS NULL OR id <> $2)', [c.slug, id ? Number(id) : null]);
      if (taken) throw new ValidationError(`The link name “${c.slug}” is already used by another category`);
      if (id) {
        const [row] = await db.query(
          `UPDATE categories SET name = $2, slug = $3, image_url = $4, description = $5, position = $6, visible = $7
           WHERE id = $1 RETURNING *`,
          [Number(id), c.name, c.slug, c.image_url, c.description, c.position, c.visible],
        );
        if (!row) throw new ValidationError('Category not found');
        return row;
      }
      const [row] = await db.query(
        `INSERT INTO categories (name, slug, image_url, description, position, visible) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [c.name, c.slug, c.image_url, c.description, c.position, c.visible],
      );
      return row;
    },
    /** Removes the category; its products stay in the catalog. */
    async remove(id) {
      await db.query('DELETE FROM categories WHERE id = $1', [Number(id)]);
    },
  };
}
