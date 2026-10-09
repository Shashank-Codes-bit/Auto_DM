import { config } from './config.js';

const BASE = 'https://graph.instagram.com';

async function graph(method, pathname, { query = {}, body } = {}) {
  const url = new URL(`${BASE}/${config.graphVersion}/${pathname}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    throw new Error(`Instagram API ${method} /${pathname} failed (${res.status}): ${msg}`);
  }
  return data;
}

const account = () => config.igUserId || 'me';

// Private Reply: DMs the author of a comment. Allowed once per comment, within 7 days of it.
export function sendPrivateReply(commentId, text) {
  if (config.dryRun) {
    console.log(`[dry-run] DM for comment ${commentId}: ${text}`);
    return Promise.resolve({ dryRun: true });
  }
  return graph('POST', `${account()}/messages`, {
    body: { recipient: { comment_id: commentId }, message: { text } },
  });
}

export function replyToComment(commentId, text) {
  if (config.dryRun) {
    console.log(`[dry-run] public reply on comment ${commentId}: ${text}`);
    return Promise.resolve({ dryRun: true });
  }
  return graph('POST', `${commentId}/replies`, { query: { message: text } });
}

export function getAccount() {
  return graph('GET', 'me', { query: { fields: 'user_id,username' } });
}

export function listMedia(limit = 25) {
  return graph('GET', `${account()}/media`, {
    query: {
      fields: 'id,caption,media_type,media_product_type,permalink,timestamp',
      limit: String(limit),
    },
  });
}
