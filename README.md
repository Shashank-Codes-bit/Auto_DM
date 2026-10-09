# Auto DM: Instagram reel comment → product link

Proof of concept: someone comments a keyword on one of your reels and automatically gets a DM with **that reel's** product link. You can also have it post a public reply such as "Sent you a DM 📩".

```
comment "SHOE" on Reel A  ──▶  webhook  ──▶  reels.json lookup  ──▶  DM: https://store.com/shoe
comment "BAG"  on Reel B  ──▶  webhook  ──▶  reels.json lookup  ──▶  DM: https://store.com/bag
```

It uses Instagram's official APIs: comment **webhooks**, plus **Private Replies**, which let you DM the person who wrote a comment. Instagram allows one private reply per comment, sent within 7 days of the comment.

## Requirements

- An Instagram **Business or Creator** account. Personal accounts can't use the API.
- A Meta developer app (free).
- Node.js 18 or newer.
- A public HTTPS URL for the webhook. Use [ngrok](https://ngrok.com) or `cloudflared` for local testing.

## Setup

1. **Create the Meta app.** Go to <https://developers.facebook.com/apps> → Create app → add the **Instagram** product → choose **API setup with Instagram login**.
   - Under "Generate access tokens", add your Instagram account and generate a token. Allow the `instagram_business_basic`, `instagram_business_manage_comments` and `instagram_business_manage_messages` permissions.
   - Add your Instagram account as an **Instagram Tester** (App roles → Roles), then accept the invite on instagram.com → Settings → Apps and websites → Tester invites.
   - Copy the **Instagram app secret** from the Business login settings on the same page. If the server logs `Rejected webhook with bad signature`, use the Meta app secret from App settings → Basic instead.
2. **Configure:**
   ```bash
   npm install
   cp .env.example .env   # paste IG_ACCESS_TOKEN, APP_SECRET, and a VERIFY_TOKEN of your choice
   ```
3. **Find your reel IDs:**
   ```bash
   npm run list-reels
   ```
   This prints your `IG_USER_ID` (add it to `.env`) and each reel's ID, date, link and caption.
4. **Map reels to links** in `reels.json`:
   ```json
   {
     "17912345678901234": {
       "keyword": "SHOE",
       "url": "https://store.com/shoe",
       "message": "Hey @{username}! Here's the shoe from the reel: {url}",
       "publicReply": "Sent you a DM 📩"
     }
   }
   ```
   - `keyword` can be a string or a list (`["SHOE", "LINK"]`). Matching ignores case and only counts whole words, so `shoe pls` matches but `shoelace` doesn't.
   - `message` supports the `{username}` and `{url}` placeholders.
   - `publicReply` is optional. Use `null` or leave it out for DM only.
   - The file is re-read on every comment, so edits take effect without a restart.
5. **Run it and expose it:**
   ```bash
   npm start
   ngrok http 3000
   ```
6. **Subscribe to webhooks.** In the app dashboard, open Instagram → API setup with Instagram login → **Configure webhooks**:
   - Callback URL: `https://<your-ngrok-domain>/webhook`
   - Verify token: the `VERIFY_TOKEN` from `.env`
   - Subscribe to the **`comments`** field, and switch on webhook subscription for your account.
7. **Test it.** While the app is in Development mode, only accounts with a role on the app trigger webhooks. Add a second Instagram account as an **Instagram Tester** (App roles) and accept the invite from that account. Then comment each reel's keyword from it.

## Behaviour

- Every keyword comment gets a DM, including repeat comments from the same person. Set `ONE_DM_PER_USER=1` to send each person at most one DM per reel.
- Duplicate webhook deliveries of the same comment are ignored. Handled comments are recorded in `data/processed.json`.
- Comments from your own account are ignored, so the bot never answers its own public replies.
- Comments on reels missing from `reels.json`, and comments without the keyword, are ignored.
- Every webhook's `X-Hub-Signature-256` is checked against your app secret.
- `DRY_RUN=1` logs DMs and replies instead of sending them.

## Tests

```bash
npm test
```

## Going beyond the POC

- **App Review:** to run this for accounts that aren't testers, the app needs Advanced Access for the messaging and comment permissions.
- **Hosting:** deploy anywhere that serves HTTPS, such as Render, Railway, Fly.io or a VPS, and point the webhook URL there.
- **Tokens:** long-lived tokens expire after 60 days. Refresh them with `GET /refresh_access_token`.
- **Ideas:** a small admin page instead of editing `reels.json`, UTM parameters per reel to track clicks, and a database instead of the JSON files.
