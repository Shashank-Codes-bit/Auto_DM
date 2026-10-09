# Auto DM: shoppable reels for Instagram

Someone comments a keyword on one of your reels. They get a DM with a **Shop now** button. The button opens a store page that shows only the 1–20 products from **that reel**. They add items to their bag and check out, and the order lands in your admin panel.

```
comment "LINK" on a reel ──▶ webhook ──▶ DM with "Shop now" button
                                              │
                                              ▼
                         /r/<reel-store>  (1–20 products from that reel)
                                              │  bag → checkout (address)
                                              ▼
                         /order/<id>  pay by UPI QR ──▶ order in /admin
```

It uses Instagram's official APIs: comment **webhooks**, plus **Private Replies**, which let you DM the person who wrote a comment. Instagram allows one private reply per comment, sent within 7 days of the comment.

> **Payments are a demo for now.** The checkout shows a UPI QR with the order amount, but it isn't connected to a payment gateway. The shopper taps “I've paid”, and you confirm the payment in the admin panel.

## What's inside

| Part | Where | What it does |
|---|---|---|
| Reel store | `/r/<slug>` | Mobile-first page with the reel's products in the order they appear, a product page, a bag, and checkout |
| Payment page | `/order/<token>` | Order summary, UPI QR with the amount, order progress |
| Admin panel | `/admin` | Dashboard, Orders, Products, Reels, DM activity, Settings, behind a password |
| Webhook | `/webhook` | Receives Instagram comments and sends the DM |

Admin panel sections:
- **Dashboard:** DMs sent, store visits, orders and revenue. Per reel: DMs, then visits, then orders. Also shows orders waiting for you.
- **Products:** one shared catalog. Each product has a name, description, price and MRP, up to 6 photos (upload or paste a link), one option such as Size, stock, and an archive switch.
- **Reels:** your Instagram posts, fetched live. For each reel, pick 1–20 products and set the order. Also set the headline, store link, keywords, DM text, button text, public reply, and live or paused.
- **Orders:** filter and search. Move an order through Awaiting payment, Payment submitted, Paid, Shipped and Delivered, or cancel it (cancelling puts the stock back). There's also a link to WhatsApp the customer.
- **DM activity:** every comment the webhook received, and what happened to it.
- **Settings:** store name, accent colour, logo, delivery fee, free-delivery threshold, UPI ID shown on the QR, and support contacts. Also shows the Instagram connection status.

## Run it (GitHub Codespaces or your computer)

Requirements:
- Node.js 20 or newer.
- An Instagram **Business or Creator** account, connected to a Meta app with **Instagram login**. The app needs the `instagram_business_basic`, `instagram_business_manage_comments` and `instagram_business_manage_messages` permissions.

Steps:
1. Install and configure:
   ```bash
   npm install
   cp .env.example .env
   ```
2. Fill in `.env`:
   - `IG_ACCESS_TOKEN`, `IG_USER_ID`, `APP_SECRET`, `VERIFY_TOKEN`: from the Meta app.
   - `ADMIN_PASSWORD` and `SESSION_SECRET`: choose your own.
   - `PUBLIC_BASE_URL`: the public address of the server. In Codespaces, that's the port-3000 address, e.g. `https://xxxx-3000.app.github.dev`.
   - `DATABASE_URL`: leave empty to use the built-in database stored in `data/pgdata`.
3. Start the server:
   ```bash
   npm start
   ```
   In Codespaces, set port 3000 to **Public** in the Ports tab.
4. Point Meta at it. In the Meta app, open Instagram → API setup with Instagram login → **Configure webhooks**:
   - **Callback URL:** `PUBLIC_BASE_URL/webhook`
   - **Verify token:** your `VERIFY_TOKEN`
   - Subscribe to **comments**, and switch on the webhook subscription for your account.
5. Open `PUBLIC_BASE_URL/admin` and log in with `ADMIN_PASSWORD`. Then:
   1. **Settings:** set your store name and delivery fee.
   2. **Products:** add products.
   3. **Reels:** pick a reel, then **Set up store**. Choose its products and keyword, and save.
6. From a tester account, comment the keyword on that reel. You'll get the DM, the button opens the store, and an order placed there shows up in **Orders**.

While the Meta app hasn't passed App Review, only accounts with a role on the app trigger webhooks and receive DMs. Add your test account under **App roles → Roles → Instagram tester**.

## Behaviour notes

- Every keyword comment gets a DM. Set `ONE_DM_PER_USER=1` to limit each person to one DM per reel. Keyword matching ignores case and only counts whole words.
- If Meta delivers the same comment twice, it gets one DM. Comments from your own account never get a DM.
- The DM uses a button template. If Instagram rejects it, the DM is sent as plain text with the link.
- Prices, delivery and stock are always recalculated on the server at checkout. Stock is reserved when an order is placed and restored if the order is cancelled.
- `DRY_RUN=1` logs DMs instead of sending them.

## Hosting

- Any Node host with HTTPS works: Render, Railway, Fly.io or a VPS. A `render.yaml` is included.
- Use a hosted Postgres for `DATABASE_URL`, for example the free tier of [Neon](https://neon.tech) or [Supabase](https://supabase.com). On free Render the disk is wiped on every deploy, so the built-in database would lose its data. Uploaded photos are stored in the database too.
- Set `PUBLIC_BASE_URL` to the hosted address, and update the webhook URL in Meta.

## Tests

```bash
npm test
```

## Next steps

- **Real payments:** Razorpay or Cashfree checkout, plus a payment webhook that marks orders as paid.
- **App Review:** Meta App Review (Advanced Access) so that everyone, not just testers, gets DMs.
- **Token refresh:** long-lived tokens expire after 60 days. Refresh them automatically with `GET /refresh_access_token`.
