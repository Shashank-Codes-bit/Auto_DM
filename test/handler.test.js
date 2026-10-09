import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleComment, matchesKeyword } from '../src/handler.js';

const reels = {
  REEL_A: { keyword: 'SHOE', url: 'https://shop.test/shoe', message: 'Hi @{username}: {url}', publicReply: 'Check DMs' },
  REEL_B: { keyword: ['BAG', 'LINK'], url: 'https://shop.test/bag', message: 'Bag: {url}' },
};

function memoryStore() {
  const comments = new Set();
  const pairs = new Set();
  return {
    hasComment: (c) => comments.has(c),
    hasUserReel: (u, m) => pairs.has(`${u}:${m}`),
    markHandled: (c, u, m) => (comments.add(c), pairs.add(`${u}:${m}`)),
  };
}

function fakeIg() {
  const calls = [];
  return {
    calls,
    sendPrivateReply: async (id, text) => calls.push(['dm', id, text]),
    replyToComment: async (id, text) => calls.push(['reply', id, text]),
  };
}

const comment = (id, media, text, user = 'u1') => ({ id, media: { id: media }, from: { id: user, username: 'alice' }, text });

test('each reel DMs its own link', async () => {
  const ig = fakeIg();
  const deps = { reels, store: memoryStore(), ig, ownIds: new Set(['ME']) };

  assert.equal(await handleComment(comment('c1', 'REEL_A', 'shoe please!'), deps), 'sent');
  assert.equal(await handleComment(comment('c2', 'REEL_B', 'link?'), deps), 'sent');

  assert.deepEqual(ig.calls, [
    ['dm', 'c1', 'Hi @alice: https://shop.test/shoe'],
    ['reply', 'c1', 'Check DMs'],
    ['dm', 'c2', 'Bag: https://shop.test/bag'],
  ]);
});

test('skips wrong keyword, unmapped reel, own comments and duplicate deliveries; repeat comments get a DM', async () => {
  const ig = fakeIg();
  const deps = { reels, store: memoryStore(), ig, ownIds: new Set(['ME']) };

  assert.equal(await handleComment(comment('c1', 'REEL_A', 'nice video'), deps), 'skip:no-keyword');
  assert.equal(await handleComment(comment('c2', 'REEL_X', 'SHOE'), deps), 'skip:unmapped-reel');
  assert.equal(await handleComment(comment('c3', 'REEL_A', 'SHOE', 'ME'), deps), 'skip:own-comment');
  assert.equal(await handleComment(comment('c4', 'REEL_A', 'SHOE'), deps), 'sent');
  assert.equal(await handleComment(comment('c4', 'REEL_A', 'SHOE'), deps), 'skip:duplicate-comment');
  assert.equal(await handleComment(comment('c5', 'REEL_A', 'SHOE again'), deps), 'sent');
  assert.equal(ig.calls.filter(([t]) => t === 'dm').length, 2);
});

test('ONE_DM_PER_USER limits each person to one DM per reel', async () => {
  const ig = fakeIg();
  const deps = { reels, store: memoryStore(), ig, ownIds: new Set(['ME']), oneDmPerUser: true };

  assert.equal(await handleComment(comment('c1', 'REEL_A', 'SHOE'), deps), 'sent');
  assert.equal(await handleComment(comment('c2', 'REEL_A', 'SHOE again'), deps), 'skip:already-sent-to-user');
  assert.equal(await handleComment(comment('c3', 'REEL_B', 'BAG'), deps), 'sent');
});

test('keyword matching is case-insensitive and whole-word', () => {
  assert.ok(matchesKeyword('Shoe 🙏', 'SHOE'));
  assert.ok(matchesKeyword('send me the #shoe', 'SHOE'));
  assert.ok(!matchesKeyword('shoelace', 'SHOE'));
});
