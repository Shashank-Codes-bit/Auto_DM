// Fills the store with demo data: products from seed/mehtamart.json and a store for each of your
// 3 newest reels. Safe to run more than once.
//
//   npm run seed                               # finds your 3 newest reels via the Instagram API
//   npm run seed -- <newest> <second> <third>  # or give the reel IDs yourself
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { createRepos } from '../src/repos/index.js';
import { SETTING_DEFAULTS } from '../src/repos/settings.js';
import * as instagram from '../src/instagram.js';

export const SEED_FILE = path.join(config.rootDir, 'seed', 'mehtamart.json');

/**
 * reels: [{ id, thumbnail_url?, permalink?, caption? }, ...] in the same order as data.reels.
 * Returns a summary of what was created or reused.
 */
export async function seedDemo({ db, repos }, data, reels) {
  if (reels.length < data.reels.length) throw new Error(`Need ${data.reels.length} reels, got ${reels.length}`);

  // Settings: only fill in values that are still at their defaults, so your own edits are kept.
  const current = await repos.settings.getAll();
  const updates = {};
  for (const [key, value] of Object.entries(data.store)) {
    if (key in SETTING_DEFAULTS && current[key] === SETTING_DEFAULTS[key]) updates[key] = value;
  }
  await repos.settings.update(updates);

  const summary = { settings: Object.keys(updates), products: { created: 0, reused: 0 }, reels: [] };
  for (const [i, def] of data.reels.entries()) {
    const productIds = [];
    for (const p of def.products) {
      const [existing] = await db.query('SELECT id FROM products WHERE name = $1 LIMIT 1', [p.name]);
      if (existing) {
        productIds.push(existing.id);
        summary.products.reused++;
        continue;
      }
      const created = await repos.products.create({
        name: p.name,
        description: p.description,
        price: String(p.price),
        mrp: p.mrp ? String(p.mrp) : '',
        images: p.images,
        option_values: '',
        stock: '',
        active: true,
      });
      productIds.push(created.id);
      summary.products.created++;
    }
    const reel = reels[i];
    await repos.reels.save(reel.id, {
      headline: def.headline,
      slug: def.slug,
      keywords: def.keywords,
      dm_message: def.dm_message,
      button_text: 'Shop now',
      public_reply: 'Sent you a DM 📩',
      active: true,
      permalink: reel.permalink || '',
      thumbnail_url: reel.thumbnail_url || '',
      caption: reel.caption || '',
      productIds,
    });
    summary.reels.push({ id: reel.id, slug: def.slug, products: productIds.length });
  }
  return summary;
}

/** The newest `count` reels on the account, newest first. */
export async function newestReels(ig, count) {
  const { data = [] } = await ig.listMedia(50);
  return data
    .filter((m) => m.media_product_type === 'REELS')
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, count)
    .map((m) => ({ id: m.id, thumbnail_url: m.thumbnail_url || m.media_url, permalink: m.permalink, caption: m.caption }));
}

async function main() {
  const data = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
  let reels;
  if (ids.length) {
    reels = [];
    for (const id of ids) reels.push(await instagram.getMedia(id).catch(() => ({ id })));
    reels = reels.map((m, i) => ({ id: ids[i], thumbnail_url: m.thumbnail_url || m.media_url, permalink: m.permalink, caption: m.caption }));
  } else {
    if (!config.accessToken) throw new Error('IG_ACCESS_TOKEN is missing in .env. Add it, or pass 3 reel IDs: npm run seed -- <id1> <id2> <id3>');
    reels = await newestReels(instagram, data.reels.length);
    if (reels.length < data.reels.length) {
      throw new Error(`Found only ${reels.length} reel(s) on the account. Post ${data.reels.length} reels, or pass reel IDs: npm run seed -- <id1> <id2> <id3>`);
    }
  }

  const db = await openDb({ url: config.databaseUrl, dataDir: config.dataDir });
  const summary = await seedDemo({ db, repos: createRepos(db) }, data, reels);
  await db.close();

  const base = config.publicBaseUrl || `http://localhost:${config.port}`;
  console.log(`Products: ${summary.products.created} created, ${summary.products.reused} already there`);
  if (summary.settings.length) console.log(`Settings filled in: ${summary.settings.join(', ')}`);
  console.log('Reel stores:');
  for (const r of summary.reels) console.log(`  ${base}/r/${r.slug}  (reel ${r.id}, ${r.products} products)`);
  console.log(`\nAll products: ${base}/   Admin: ${base}/admin`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`Seeding failed: ${err.message}`);
    process.exit(1);
  });
}
