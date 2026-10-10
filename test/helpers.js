import { openDb } from '../src/db/index.js';
import { createRepos } from '../src/repos/index.js';
import { createApp } from '../src/server.js';
import { config } from '../src/config.js';

export const REEL_ID = '18475694065114168';

export function fakeIg({ failButton = false } = {}) {
  const calls = [];
  return {
    calls,
    sendPrivateReplyButton: async (...a) => {
      if (failButton) throw new Error('template not supported');
      calls.push(['button', ...a]);
    },
    sendPrivateReply: async (...a) => calls.push(['text', ...a]),
    replyToComment: async (...a) => calls.push(['reply', ...a]),
    listMedia: async () => ({ data: [{ id: REEL_ID, caption: 'Brunch look', media_product_type: 'REELS' }] }),
    getMedia: async (id) => ({ id, caption: 'Brunch look', permalink: 'https://instagram.com/reel/x' }),
    getAccount: async () => ({ username: 'shop', user_id: 'ME' }),
  };
}

export async function setup() {
  const db = await openDb();
  const repos = createRepos(db);
  return { db, repos };
}

/** Creates `n` products and a reel showing them. */
export async function seedReel(repos, { n = 2, keywords = 'LINK', active = 'on', stock = '' } = {}) {
  const products = [];
  for (let i = 0; i < n; i++) {
    products.push(await repos.products.create({ name: `Product ${i + 1}`, price: String(100 * (i + 1)), stock, active: 'on' }));
  }
  const reel = await repos.reels.save(REEL_ID, { headline: 'Brunch edit', keywords, productIds: products.map((p) => p.id), active });
  return { products, reel };
}

export const OWNER = { phone: '9000000001', password: 'owner-pass' };

export async function startApp({ ig = fakeIg(), overrides = {} } = {}) {
  const { db, repos } = await setup();
  await repos.users.ensureOwner(OWNER);
  const app = createApp({
    db,
    ig,
    config: { ...config, adminPhone: OWNER.phone, adminPassword: OWNER.password, sessionSecret: 'test-secret', verifyToken: 'vt', appSecret: 'secret', publicBaseUrl: 'https://shop.test', dryRun: false, oneDmPerUser: false, ...overrides },
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, repos, ig, base, close: () => server.close() };
}

/** Logs in through /login and returns the session cookie plus a CSRF token read from `csrfPage`. */
export async function login(base, { phone = OWNER.phone, password = OWNER.password, csrfPage = '/account' } = {}) {
  const res = await fetch(`${base}/login`, { method: 'POST', body: new URLSearchParams({ phone, password }), redirect: 'manual' });
  if (res.status !== 303) throw new Error(`login failed with ${res.status}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const page = await (await fetch(`${base}${csrfPage}`, { headers: { cookie } })).text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page)?.[1] || /data-csrf="([^"]+)"/.exec(page)?.[1];
  return { cookie, csrf, location: res.headers.get('location') };
}
