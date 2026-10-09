import fs from 'node:fs';
import path from 'node:path';

// Remembers which comments / user+reel pairs were already answered, persisted to disk
// so a restart (or Meta re-delivering a webhook) does not send duplicate DMs.
export function createStore(file) {
  let state = { comments: {}, userReel: {} };
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // first run or unreadable file: start empty
  }

  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  };

  return {
    hasComment: (commentId) => Boolean(state.comments[commentId]),
    hasUserReel: (userId, mediaId) => Boolean(state.userReel[`${userId}:${mediaId}`]),
    markHandled(commentId, userId, mediaId) {
      const at = new Date().toISOString();
      state.comments[commentId] = at;
      state.userReel[`${userId}:${mediaId}`] = at;
      save();
    },
  };
}
