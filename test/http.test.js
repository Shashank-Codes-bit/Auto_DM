import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { REEL_ID, seedReel, startApp } from './helpers.js';

const sign = (body, secret = 'secret') => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

async function login(base) {
  const res = await fetch(`${base}/admin/login`, { method: 'POST', body: new URLSearchParams({ password: 'pw' }), redirect: 'manual' });
  assert.equal(res.status, 303);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const page = await (await fetch(`${base}/admin/products/new`, { headers: { cookie } })).text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  return { cookie, csrf };
}

test('webhook verification and signature checks', async () => {
  const app = await startApp();
  try {
    assert.equal(await (await fetch(`${app.base}/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42`)).text(), '42');
    assert.equal((await fetch(`${app.base}/webhook?hub.mode=subscribe&hub.verify_token=no&hub.challenge=42`)).status, 403);
    const body = JSON.stringify({ entry: [] });
    const post = (sig) => fetch(`${app.base}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body });
    assert.equal((await post(sign(body, 'wrong'))).status, 401);
    assert.equal((await post(sign(body))).status, 200);
  } finally {
    app.close();
  }
});

test('a signed comment webhook sends the store link', async () => {
  const app = await startApp();
  try {
    await seedReel(app.repos);
    const body = JSON.stringify({ entry: [{ id: 'ME', changes: [{ field: 'comments', value: { id: 'c1', text: 'LINK', media: { id: REEL_ID }, from: { id: 'u1', username: 'bob' } } }] }] });
    await fetch(`${app.base}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) }, body });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(app.ig.calls[0][3], 'https://shop.test/r/brunch-edit?src=dm');
  } finally {
    app.close();
  }
});

test('admin requires login and a CSRF token', async () => {
  const app = await startApp();
  try {
    const anon = await fetch(`${app.base}/admin`, { redirect: 'manual' });
    assert.equal(anon.status, 302);
    assert.match(anon.headers.get('location'), /\/admin\/login/);
    const wrong = await fetch(`${app.base}/admin/login`, { method: 'POST', body: new URLSearchParams({ password: 'nope' }) });
    assert.equal(wrong.status, 401);

    const { cookie, csrf } = await login(app.base);
    const form = { name: 'Kurta', price: '999', active: 'on' };
    const noCsrf = await fetch(`${app.base}/admin/products`, { method: 'POST', headers: { cookie }, body: new URLSearchParams(form), redirect: 'manual' });
    assert.equal(noCsrf.status, 403);
    const ok = await fetch(`${app.base}/admin/products`, { method: 'POST', headers: { cookie }, body: new URLSearchParams({ ...form, _csrf: csrf }), redirect: 'manual' });
    assert.equal(ok.status, 303);
    assert.equal((await app.repos.products.list())[0].name, 'Kurta');
  } finally {
    app.close();
  }
});

test('shopper flow: store page, place order, pay page with QR', async () => {
  const app = await startApp();
  try {
    const { products } = await seedReel(app.repos);
    const store = await fetch(`${app.base}/r/brunch-edit?src=dm`);
    assert.equal(store.status, 200);
    assert.match(await store.text(), /Product 1/);

    const res = await fetch(`${app.base}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: products[0].id, qty: 1 }],
        customer: { name: 'Asha K', phone: '9876543210', address: '12 MG Road', city: 'Pune', state: 'MH', pincode: '411001' },
        reelSlug: 'brunch-edit',
        source: 'dm',
      }),
    });
    assert.equal(res.status, 201);
    const { token } = await res.json();
    const pay = await (await fetch(`${app.base}/order/${token}`)).text();
    assert.match(pay, /<svg/);
    assert.match(pay, /₹149/); // ₹100 + ₹49 delivery

    await fetch(`${app.base}/order/${token}/paid`, { method: 'POST', redirect: 'manual' });
    assert.equal((await app.repos.orders.getByToken(token)).status, 'payment_submitted');

    const bad = await fetch(`${app.base}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [] }) });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /bag is empty/);
  } finally {
    app.close();
  }
});

test('paused reel stores are not shown', async () => {
  const app = await startApp();
  try {
    await seedReel(app.repos, { active: '' });
    assert.equal((await fetch(`${app.base}/r/brunch-edit`)).status, 404);
  } finally {
    app.close();
  }
});
