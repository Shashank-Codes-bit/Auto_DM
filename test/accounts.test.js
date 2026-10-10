import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, login, seedReel, startApp } from './helpers.js';

const form = (o) => new URLSearchParams(o);
const customer = { name: 'Asha K', phone: '9876543210', address: '12 MG Road', city: 'Pune', state: 'MH', pincode: '411001' };

test('shoppers sign up, log in, and are kept out of the admin panel', async () => {
  const app = await startApp();
  try {
    const signup = await fetch(`${app.base}/signup`, { method: 'POST', body: form({ name: 'Asha K', phone: '98765 43210', password: 'secret1' }), redirect: 'manual' });
    assert.equal(signup.status, 303);
    assert.equal(signup.headers.get('location'), '/account');
    const cookie = signup.headers.get('set-cookie').split(';')[0];

    const account = await (await fetch(`${app.base}/account`, { headers: { cookie } })).text();
    assert.match(account, /Hi, Asha/);
    assert.match(account, /No orders yet/);

    const admin = await fetch(`${app.base}/admin`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(admin.status, 302);
    assert.equal(admin.headers.get('location'), '/account');

    const dup = await fetch(`${app.base}/signup`, { method: 'POST', body: form({ name: 'Other', phone: '9876543210', password: 'secret2' }) });
    assert.equal(dup.status, 400);
    assert.match(await dup.text(), /already exists/);

    const short = await fetch(`${app.base}/signup`, { method: 'POST', body: form({ name: 'New', phone: '9876500000', password: '123' }) });
    assert.equal(short.status, 400);

    const again = await login(app.base, { phone: '9876543210', password: 'secret1' });
    assert.equal(again.location, '/account');
  } finally {
    app.close();
  }
});

test('the owner from .env is an admin, and logins are rate limited', async () => {
  const app = await startApp();
  try {
    const owner = await app.repos.users.findByPhone(OWNER.phone);
    assert.equal(owner.role, 'admin');
    // Running ensureOwner again (every start) keeps one account.
    await app.repos.users.ensureOwner(OWNER);
    assert.equal((await app.repos.users.listCustomers()).length, 1);

    for (let i = 0; i < 10; i++) {
      await fetch(`${app.base}/login`, { method: 'POST', body: form({ phone: OWNER.phone, password: 'wrong' }) });
    }
    const locked = await fetch(`${app.base}/login`, { method: 'POST', body: form(OWNER) });
    assert.equal(locked.status, 429);
  } finally {
    app.close();
  }
});

test('login forms from another site are refused', async () => {
  const app = await startApp();
  try {
    const res = await fetch(`${app.base}/login`, { method: 'POST', headers: { origin: 'https://evil.test' }, body: form(OWNER) });
    assert.equal(res.status, 403);
  } finally {
    app.close();
  }
});

test('guest checkout can create an account; logged-in orders show on My account with a saved address', async () => {
  const app = await startApp();
  try {
    const { products } = await seedReel(app.repos, { n: 1 });
    const order = (headers, body) =>
      fetch(`${app.base}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

    const guest = await order({}, { items: [{ productId: products[0].id, qty: 1 }], customer, password: 'secret1' });
    assert.equal(guest.status, 201);
    assert.equal((await guest.json()).account, true);
    const cookie = guest.headers.get('set-cookie').split(';')[0];

    const user = await app.repos.users.findByPhone(customer.phone);
    assert.equal(user.address.pincode, '411001');

    const page = await (await fetch(`${app.base}/checkout`, { headers: { cookie } })).text();
    assert.match(page, /Ordering as/);
    assert.match(page, /value="411001"/);
    const csrf = /data-csrf="([^"]+)"/.exec(page)[1];

    // Logged in: the CSRF token is required.
    const body = { items: [{ productId: products[0].id, qty: 2 }], customer };
    assert.equal((await order({ cookie }, body)).status, 403);
    assert.equal((await order({ cookie, 'x-csrf-token': csrf }, body)).status, 201);

    const account = await (await fetch(`${app.base}/account`, { headers: { cookie } })).text();
    assert.equal((account.match(/class="order-row"/g) || []).length, 2);

    // A second guest with the same number must log in instead.
    const taken = await order({}, { ...body, password: 'another1' });
    assert.equal(taken.status, 400);
    assert.match((await taken.json()).error, /already has an account/);
  } finally {
    app.close();
  }
});

test('customers change their password; the owner can reset a forgotten one', async () => {
  const app = await startApp();
  try {
    const shopper = await app.repos.users.create({ name: 'Ravi', phone: '9123456780', password: 'first1' });
    const s = await login(app.base, { phone: '9123456780', password: 'first1' });
    const bad = await fetch(`${app.base}/account/password`, { method: 'POST', headers: { cookie: s.cookie }, body: form({ _csrf: s.csrf, current: 'nope', password: 'second2' }) });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${app.base}/account/password`, { method: 'POST', headers: { cookie: s.cookie }, body: form({ _csrf: s.csrf, current: 'first1', password: 'second2' }), redirect: 'manual' });
    assert.equal(ok.status, 303);
    assert.ok(await app.repos.users.verify('9123456780', 'second2'));

    const o = await login(app.base, { csrfPage: '/admin/customers' });
    const reset = await (await fetch(`${app.base}/admin/customers/${shopper.id}/reset`, { method: 'POST', headers: { cookie: o.cookie }, body: form({ _csrf: o.csrf }) })).text();
    const fresh = /New password for Ravi \(9123456780\): <code>([^<]+)<\/code>/.exec(reset)[1];
    assert.ok(await app.repos.users.verify('9123456780', fresh));
  } finally {
    app.close();
  }
});

test('owners see the owner bar and Edit buttons on the storefront; shoppers do not', async () => {
  const app = await startApp();
  try {
    const { products } = await seedReel(app.repos, { n: 1 });
    const anon = await (await fetch(`${app.base}/p/${products[0].slug}`)).text();
    assert.doesNotMatch(anon, /owner-bar/);
    const { cookie } = await login(app.base);
    const owner = await (await fetch(`${app.base}/p/${products[0].slug}`, { headers: { cookie } })).text();
    assert.match(owner, /class="owner-bar"/);
    assert.match(owner, new RegExp(`href="/admin/products/${products[0].id}">Edit product`));
  } finally {
    app.close();
  }
});
