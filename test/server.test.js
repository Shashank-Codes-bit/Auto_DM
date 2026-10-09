import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autodm-'));
const reelsFile = path.join(dir, 'reels.json');
fs.writeFileSync(reelsFile, JSON.stringify({ REEL_A: { keyword: 'SHOE', url: 'https://shop.test/shoe' } }));
Object.assign(process.env, { APP_SECRET: 'secret', VERIFY_TOKEN: 'vt', REELS_FILE: reelsFile, IG_USER_ID: 'ME' });

const { createApp } = await import('../src/server.js');

async function withServer(fn) {
  const sent = [];
  const ig = { sendPrivateReply: async (id, text) => sent.push([id, text]), replyToComment: async () => {} };
  const store = { hasComment: () => false, hasUserReel: () => false, markHandled: () => {} };
  const server = createApp({ ig, store }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, sent);
  } finally {
    server.close();
  }
}

const payload = JSON.stringify({
  object: 'instagram',
  entry: [{ id: 'ME', changes: [{ field: 'comments', value: { id: 'c1', text: 'SHOE', media: { id: 'REEL_A' }, from: { id: 'u1', username: 'bob' } } }] }],
});
const sign = (body, secret = 'secret') => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

test('webhook verification handshake', async () => {
  await withServer(async (base) => {
    const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42`);
    assert.equal(await ok.text(), '42');
    const bad = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`);
    assert.equal(bad.status, 403);
  });
});

test('signed comment webhook triggers DM; bad signature is rejected', async () => {
  await withServer(async (base, sent) => {
    const post = (sig) => fetch(`${base}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: payload });

    assert.equal((await post(sign(payload, 'wrong'))).status, 401);
    assert.equal(sent.length, 0);

    assert.equal((await post(sign(payload))).status, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(sent, [['c1', 'Here is the link: https://shop.test/shoe']]);
  });
});
