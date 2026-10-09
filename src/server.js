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

export function createApp({ store = createStore(config.processedFile), ig = instagram } = {}) {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf) }));

  app.get('/', (_req, res) => res.send('auto-dm is running'));

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
