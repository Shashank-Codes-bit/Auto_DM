import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SEED_FILE, newestReels, seedDemo } from '../scripts/seed.js';
import { setup } from './helpers.js';

const data = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
const reels = [{ id: '111' }, { id: '222' }, { id: '333' }];

test('seed file: categories, products with photos, and 3 reels of 1 to 20 known products', () => {
  assert.equal(data.version, 2);
  const names = new Set(data.products.map((p) => p.name));
  const cats = new Set(data.categories.map((c) => c.name));
  for (const p of data.products) {
    assert.ok(p.name && p.price > 0 && p.images.length, p.name);
    for (const c of p.categories) assert.ok(cats.has(c), `${p.name}: unknown category ${c}`);
  }
  assert.equal(data.reels.length, 3);
  for (const r of data.reels) {
    assert.ok(r.products.length >= 1 && r.products.length <= 20, r.slug);
    for (const n of r.products) assert.ok(names.has(n), n);
  }
});

test('seeding creates categories, products and reel stores, is safe to re-run, and keeps edited settings', async () => {
  const ctx = await setup();
  await ctx.repos.settings.update({ store_name: 'My Own Name' });

  const first = await seedDemo(ctx, data, reels);
  assert.equal(first.products.created, data.products.length);
  assert.equal(first.categories.created, data.categories.length);
  const second = await seedDemo(ctx, data, reels);
  assert.equal(second.products.created, 0);
  assert.equal(second.categories.created, 0);
  assert.equal((await ctx.repos.products.list()).length, data.products.length);

  const kitchen = await ctx.repos.reels.getStore('kitchen-creations');
  assert.equal(kitchen.ig_media_id, '111');
  assert.equal(kitchen.products.length, data.reels[0].products.length);
  assert.deepEqual(kitchen.keywords, ['KITCHEN', 'LINK']);

  const cat = await ctx.repos.categories.getBySlug(data.categories[0].slug);
  assert.equal(cat.product_count, data.products.filter((p) => p.categories.includes(cat.name)).length);
  assert.equal((await ctx.repos.products.featured(20)).length, data.products.filter((p) => p.featured).length);

  const settings = await ctx.repos.settings.getAll();
  assert.equal(settings.store_name, 'My Own Name');
  assert.equal(settings.tagline, data.store.tagline);
  assert.equal(settings.gstin, data.store.gstin);
});

test('newestReels picks reels only, newest first', async () => {
  const ig = {
    listMedia: async () => ({
      data: [
        { id: '1', media_product_type: 'REELS', timestamp: '2026-10-01T00:00:00+0000' },
        { id: '2', media_product_type: 'FEED', timestamp: '2026-10-09T00:00:00+0000' },
        { id: '3', media_product_type: 'REELS', timestamp: '2026-10-08T00:00:00+0000' },
      ],
    }),
  };
  assert.deepEqual((await newestReels(ig, 3)).map((r) => r.id), ['3', '1']);
});
