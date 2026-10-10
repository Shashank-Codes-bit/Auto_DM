import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { ValidationError, normalizePhone } from '../util.js';

const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const key = await scrypt(String(password), salt, 32);
  return `scrypt$${salt}$${key.toString('base64url')}`;
}

export async function checkPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(String(password ?? ''), salt, 32);
  const want = Buffer.from(hash, 'base64url');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

export function validatePassword(password) {
  if (String(password ?? '').length < 6) throw new ValidationError('Use a password of at least 6 characters');
}

const PUBLIC = 'id, name, phone, email, role, address, created_at';

export function usersRepo(db) {
  return {
    async get(id) {
      const [row] = await db.query(`SELECT ${PUBLIC} FROM users WHERE id = $1`, [Number(id) || 0]);
      return row || null;
    },
    async findByPhone(phone) {
      const p = normalizePhone(phone);
      if (!p) return null;
      const [row] = await db.query(`SELECT ${PUBLIC} FROM users WHERE phone = $1`, [p]);
      return row || null;
    },
    async create({ name, phone, email = '', password, role = 'customer' }) {
      const n = String(name ?? '').trim();
      if (n.length < 2) throw new ValidationError('Enter your name');
      const p = normalizePhone(phone);
      if (!p) throw new ValidationError('Enter a 10-digit Indian mobile number');
      const e = String(email ?? '').trim();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ValidationError('Enter a valid email, or leave it empty');
      validatePassword(password);
      const [exists] = await db.query('SELECT 1 FROM users WHERE phone = $1', [p]);
      if (exists) throw new ValidationError('An account with this number already exists. Log in instead.');
      const [row] = await db.query(
        `INSERT INTO users (name, phone, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING ${PUBLIC}`,
        [n.slice(0, 80), p, e.slice(0, 120), await hashPassword(password), role === 'admin' ? 'admin' : 'customer'],
      );
      return row;
    },
    /** Returns the user when phone + password match, otherwise null. */
    async verify(phone, password) {
      const p = normalizePhone(phone);
      if (!p) return null;
      const [row] = await db.query('SELECT * FROM users WHERE phone = $1', [p]);
      if (!row || !(await checkPassword(password, row.password_hash))) return null;
      delete row.password_hash;
      return row;
    },
    async setPassword(id, password) {
      validatePassword(password);
      await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [Number(id), await hashPassword(password)]);
    },
    /** Only the server command (scripts/role.js) and ensureOwner change roles; signup always makes customers. */
    async setRole(id, role) {
      if (!['admin', 'customer'].includes(role)) throw new ValidationError('Role must be admin or customer');
      await db.query('UPDATE users SET role = $2 WHERE id = $1', [Number(id), role]);
      return this.get(id);
    },
    async listAdmins() {
      return db.query(`SELECT ${PUBLIC} FROM users WHERE role = 'admin' ORDER BY created_at`);
    },
    async saveAddress(id, address) {
      await db.query('UPDATE users SET address = $2 WHERE id = $1', [Number(id), JSON.stringify(address)]);
    },
    /**
     * Makes sure the owner account from .env exists and has the admin role.
     * An existing account with that phone is promoted; its password is reset to the .env one.
     */
    async ensureOwner({ phone, password, name = 'Store owner' }) {
      const p = normalizePhone(phone);
      if (!p || !password) return null;
      const [row] = await db.query('SELECT id FROM users WHERE phone = $1', [p]);
      if (row) {
        await db.query("UPDATE users SET role = 'admin', password_hash = $2 WHERE id = $1", [row.id, await hashPassword(password)]);
        return this.get(row.id);
      }
      return this.create({ name, phone: p, password, role: 'admin' });
    },
    async listCustomers({ search = '' } = {}) {
      return db.query(
        `SELECT u.id, u.name, u.phone, u.email, u.role, u.created_at,
           (SELECT count(*)::int FROM orders o WHERE o.user_id = u.id) AS order_count,
           (SELECT coalesce(sum(total_paise), 0)::bigint FROM orders o WHERE o.user_id = u.id AND o.status <> 'cancelled') AS spent
         FROM users u
         WHERE ($1 = '' OR u.name ILIKE '%' || $1 || '%' OR u.phone LIKE '%' || $1 || '%')
         ORDER BY u.role = 'admin' DESC, u.created_at DESC LIMIT 500`,
        [search.trim()],
      );
    },
  };
}
