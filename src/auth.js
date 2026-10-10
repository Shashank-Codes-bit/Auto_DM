import crypto from 'node:crypto';

const COOKIE = 'sid';
const SESSION_DAYS = 30;

const hmac = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

export const safeNext = (n, fallback = '/') =>
  typeof n === 'string' && /^\/(?!\/)[\w\-./?=&%#]*$/.test(n) && !n.startsWith('/login') ? n : fallback;

/**
 * One login for the whole site. Shoppers and the owner sign in with phone + password; the owner's
 * account has role "admin". The session is a signed, HttpOnly cookie (no server-side session store).
 * Every POST made while logged in must carry a CSRF token derived from the session.
 */
export function createAuth({ secret, users }) {
  const attempts = new Map();

  function sessionToken(req) {
    const token = readCookie(req, COOKIE);
    const [uid, exp, sig] = token.split('.');
    if (!uid || !exp || !sig || Number(exp) < Date.now()) return null;
    return safeEqual(sig, hmac(secret, `session:${uid}:${exp}`)) ? { token, userId: Number(uid) } : null;
  }

  return {
    /** Loads the logged-in user (if any) into req.user / res.locals.user, and the CSRF token. */
    async load(req, res, next) {
      const s = sessionToken(req);
      req.user = s ? await users.get(s.userId) : null;
      req.csrf = s && req.user ? hmac(secret, `csrf:${s.token}`) : '';
      res.locals.user = req.user;
      res.locals.csrf = req.csrf;
      next();
    },

    /** Rejects logged-in POSTs that lack the session's CSRF token. */
    checkCsrf(req, res, next) {
      if (req.method === 'GET' || req.method === 'HEAD' || !req.user) return next();
      const sent = req.get('x-csrf-token') || req.body?._csrf || '';
      if (!safeEqual(sent, req.csrf)) return res.status(403).send('This form expired. Go back, refresh the page and try again.');
      next();
    },

    /** Login rate limit: 10 failed tries per IP per 15 minutes. */
    tooManyAttempts(req) {
      const a = attempts.get(req.ip);
      if (a && Date.now() > a.reset) attempts.delete(req.ip);
      return (attempts.get(req.ip)?.n || 0) >= 10;
    },
    recordFailure(req) {
      const now = Date.now();
      const a = attempts.get(req.ip) || { n: 0, reset: now + 15 * 60_000 };
      a.n++;
      attempts.set(req.ip, a);
    },

    login(req, res, user) {
      attempts.delete(req.ip);
      const exp = Date.now() + SESSION_DAYS * 86_400_000;
      res.cookie(COOKIE, `${user.id}.${exp}.${hmac(secret, `session:${user.id}:${exp}`)}`, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure,
        path: '/',
        maxAge: SESSION_DAYS * 86_400_000,
      });
    },

    logout(res) {
      res.clearCookie(COOKIE, { path: '/' });
    },

    requireUser(req, res, next) {
      if (req.user) return next();
      if (req.method === 'GET') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      return res.status(401).json({ error: 'Please log in again.' });
    },

    requireAdmin(req, res, next) {
      if (req.user?.role === 'admin') return next();
      if (req.method !== 'GET') return res.status(req.user ? 403 : 401).json({ error: 'Only the store owner can do this.' });
      if (req.user) return res.redirect('/account');
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    },
  };
}
