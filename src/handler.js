import fs from 'node:fs';

// Re-read on every comment so edits to reels.json apply without a restart.
export function loadReels(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function matchesKeyword(text, keyword) {
  const keywords = Array.isArray(keyword) ? keyword : [keyword];
  return keywords.some(
    (k) => k && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(k)}($|[^\\p{L}\\p{N}])`, 'iu').test(text),
  );
}

const fill = (template, vars) =>
  template.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m));

/**
 * Handles one `comments` webhook change. Returns a short status string (useful for logs/tests).
 * deps: { reels, store, ig: { sendPrivateReply, replyToComment }, ownIds: Set<string>, oneDmPerUser?: boolean }
 */
export async function handleComment(value, { reels, store, ig, ownIds, oneDmPerUser = false }) {
  const commentId = value?.id;
  const mediaId = value?.media?.id;
  const userId = value?.from?.id;
  const username = value?.from?.username || '';
  const text = value?.text || '';

  if (!commentId || !mediaId || !userId) return 'skip:malformed';
  if (ownIds.has(userId)) return 'skip:own-comment';

  const reel = reels[mediaId];
  if (!reel) return 'skip:unmapped-reel';
  if (!matchesKeyword(text, reel.keyword)) return 'skip:no-keyword';
  if (store.hasComment(commentId)) return 'skip:duplicate-comment';
  if (oneDmPerUser && store.hasUserReel(userId, mediaId)) return 'skip:already-sent-to-user';

  const vars = { username, url: reel.url };
  const message = fill(reel.message || 'Here is the link: {url}', vars);

  await ig.sendPrivateReply(commentId, message);
  store.markHandled(commentId, userId, mediaId);
  console.log(`DM sent to @${username} for reel ${mediaId} -> ${reel.url}`);

  if (reel.publicReply) {
    try {
      await ig.replyToComment(commentId, fill(reel.publicReply, vars));
    } catch (err) {
      // DM already went out; a failed public reply should not cause a retry.
      console.error(`Public reply failed for comment ${commentId}: ${err.message}`);
    }
  }
  return 'sent';
}
