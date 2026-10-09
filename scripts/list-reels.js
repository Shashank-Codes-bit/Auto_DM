import { getAccount, listMedia } from '../src/instagram.js';

try {
  const me = await getAccount();
  console.log(`Account: @${me.username}  IG_USER_ID=${me.user_id}\n`);

  const { data = [] } = await listMedia(50);
  const reels = data.filter((m) => m.media_product_type === 'REELS' || m.media_type === 'VIDEO');
  if (!reels.length) console.log('No reels found.');
  for (const m of reels) {
    const caption = (m.caption || '').replace(/\s+/g, ' ').slice(0, 60);
    console.log(`${m.id}  ${m.timestamp?.slice(0, 10)}  ${m.permalink}\n    ${caption}\n`);
  }
  console.log('Copy the IDs you want into reels.json.');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
