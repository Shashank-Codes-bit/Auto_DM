import crypto from 'node:crypto';
import express from 'express';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { handleComment, loadReels } from './handler.js';
import { createStore } from './store.js';
import * as instagram from './instagram.js';

export function verifySignature(rawBody, header, secret) {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = header.slice('sha256='.length);
  return (
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createApp({ store = createStore(config.processedFile), ig = instagram } = {}) {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf) }));

  app.get('/', (_req, res) => res.send('auto-dm is running'));

  // Browser page listing your reels and their IDs, for filling in reels.json.
  // Open /reels?key=<ADMIN_KEY>. Disabled when ADMIN_KEY is not set.
  app.get('/reels', async (req, res) => {
    if (!config.adminKey || req.query.key !== config.adminKey) return res.sendStatus(404);
    try {
      const [me, { data = [] }] = await Promise.all([ig.getAccount(), ig.listMedia(50)]);
      let mapped = {};
      let reelsError = '';
      try {
        mapped = loadReels(config.reelsFile);
      } catch (err) {
        reelsError = `reels.json could not be read: ${err.message}`;
      }
      // All posts are listed (not only reels): comments on any post can trigger a DM.
      const rows = data
        .map((m) => {
          const r = mapped[m.id];
          const type = m.media_product_type === 'REELS' ? 'Reel' : m.media_type;
          return `<tr><td><code>${esc(m.id)}</code></td><td>${esc(type)}</td><td>${esc(m.timestamp?.slice(0, 10))}</td>
            <td><a href="${esc(m.permalink)}" target="_blank">open</a></td>
            <td>${esc((m.caption || '').slice(0, 80))}</td>
            <td>${r ? `${esc([].concat(r.keyword).join(', '))} → ${esc(r.url)}` : '<i>not mapped</i>'}</td></tr>`;
        })
        .join('');
      res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
        <title>Reels</title><style>body{font-family:system-ui;margin:16px}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}table{border-collapse:collapse}</style>
        <h2>@${esc(me.username)} <small>IG_USER_ID: <code>${esc(me.user_id)}</code></small></h2>
        <p>Copy a post's ID into reels.json with its keyword and link.</p>
        ${reelsError ? `<p style="color:#b00020"><b>${esc(reelsError)}</b></p>` : ''}
        <table><tr><th>ID</th><th>Type</th><th>Date</th><th>Link</th><th>Caption</th><th>Mapping</th></tr>${rows || '<tr><td colspan=6>No posts found on this account yet</td></tr>'}</table>`);
    } catch (err) {
      res.status(500).send(esc(err.message));
    }
  });

  // Meta webhook verification handshake
  app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.verifyToken) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    res.sendStatus(403);
  });

  app.post('/webhook', async (req, res) => {
    if (!verifySignature(req.rawBody, req.get('x-hub-signature-256'), config.appSecret)) {
      console.warn('Rejected webhook with bad signature');
      return res.sendStatus(401);
    }
    // Acknowledge fast; Meta retries deliveries that are slow to get a 200.
    res.sendStatus(200);

    let reels;
    try {
      reels = loadReels(config.reelsFile);
    } catch (err) {
      return console.error(`Could not read ${config.reelsFile}: ${err.message}`);
    }

    for (const entry of req.body?.entry || []) {
      const ownIds = new Set([entry.id, config.igUserId].filter(Boolean).map(String));
      for (const change of entry.changes || []) {
        if (change.field !== 'comments') continue;
        try {
          const result = await handleComment(change.value, { reels, store, ig, ownIds });
          console.log(`comment ${change.value?.id} on ${change.value?.media?.id}: ${result}`);
        } catch (err) {
          console.error(`Failed to handle comment ${change.value?.id}: ${err.message}`);
        }
      }
    }
  });

  return app;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(config.port, () => {
    console.log(`auto-dm listening on :${config.port}${config.dryRun ? ' (DRY_RUN)' : ''}`);
  });
}
