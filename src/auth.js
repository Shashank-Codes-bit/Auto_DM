import crypto from 'node:crypto';

const COOKIE = 'adm';
const SESSION_DAYS = 7;

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

/**
 * Password login for /admin with a signed, HttpOnly, SameSite=Strict cookie (no server-side sessions),
 * plus a CSRF token derived from the session that every admin form/fetch must send back.
 */
export function createAuth({ password, secret }) {
  const attempts = new Map();

  function sessionFrom(req) {
    const token = readCookie(req, COOKIE);
    const [exp, sig] = token.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return null;
    return safeEqual(sig, hmac(secret, `session:${exp}`)) ? token : null;
  }

  return {
    enabled: Boolean(password),

    checkPassword(req, given) {
      const now = Date.now();
      const a = attempts.get(req.ip) || { n: 0, reset: now + 15 * 60_000 };
      if (now > a.reset) Object.assign(a, { n: 0, reset: now + 15 * 60_000 });
      if (a.n >= 10) return 'locked';
      const ok = Boolean(password) && safeEqual(hmac(secret, String(given ?? '')), hmac(secret, password));
      if (!ok) a.n++;
      attempts.set(req.ip, a);
      return ok ? 'ok' : 'wrong';
    },

    login(req, res) {
      const exp = Date.now() + SESSION_DAYS * 86_400_000;
      res.cookie(COOKIE, `${exp}.${hmac(secret, `session:${exp}`)}`, {
        httpOnly: true,
        sameSite: 'strict',
        secure: req.secure,
        path: '/admin',
        maxAge: SESSION_DAYS * 86_400_000,
      });
    },

    logout(res) {
      res.clearCookie(COOKIE, { path: '/admin' });
    },

    csrfToken: (req) => hmac(secret, `csrf:${sessionFrom(req)}`),

    /** Gate for all admin pages. Also verifies the CSRF token on every non-GET request. */
    require(req, res, next) {
      const session = sessionFrom(req);
      if (!session) {
        if (req.method === 'GET') return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
        return res.status(401).json({ error: 'Your session expired. Log in again.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const sent = req.get('x-csrf-token') || req.body?._csrf || '';
        if (!safeEqual(sent, hmac(secret, `csrf:${session}`))) {
          return res.status(403).send('This form expired. Go back, refresh the page and try again.');
        }
      }
      req.csrf = hmac(secret, `csrf:${session}`);
      next();
    },
  };
}
