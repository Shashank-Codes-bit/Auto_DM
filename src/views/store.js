import { discountPercent, formatMoney } from '../util.js';
import { ORDER_STATUSES } from '../repos/orders.js';
import { html, jsonScript, raw } from './html.js';

const FONT_URL =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..800&display=swap';

// Light enough to show white text on? Used to pick the accent's text colour.
function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#2A1B2E' : '#fff';
}

const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#B8336A');

const bagIcon = raw(
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M5 8h14l-1 12H6L5 8Z"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M9 10V7a3 3 0 0 1 6 0v3"/></svg>',
);

export function storeLayout({ settings, title, body, pageData = {}, bare = false }) {
  const accent = safeColor(settings.accent_color);
  const data = {
    shippingFee: Number(settings.shipping_fee_paise) || 0,
    freeShippingAbove: Number(settings.free_shipping_above_paise) || 0,
    ...pageData,
  };
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title ? `${title} | ${settings.store_name}` : settings.store_name}</title>
<meta name="theme-color" content="${accent}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_URL}">
<link rel="stylesheet" href="/static/store.css">
<style>:root{--accent:${raw(accent)};--on-accent:${raw(readableOn(accent))}}</style>
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">
    ${settings.logo_url ? html`<img src="${settings.logo_url}" alt="" class="brand-logo">` : ''}
    <span>${settings.store_name}</span>
  </a>
  ${bare ? '' : html`<button class="bag-btn" type="button" data-open-bag aria-label="Open bag">
    ${bagIcon}<span class="bag-count" data-bag-count hidden>0</span>
  </button>`}
</header>
<main>${body}</main>
${bare ? '' : bagDrawer()}
<footer class="site-foot">
  <p>${settings.store_name}${settings.instagram_handle ? html` on <a href="https://instagram.com/${settings.instagram_handle.replace(/^@/, '')}">Instagram</a>` : ''}</p>
  ${settings.support_whatsapp || settings.support_email ? html`<p>Questions? ${settings.support_whatsapp ? html`<a href="https://wa.me/${settings.support_whatsapp.replace(/\D/g, '')}">WhatsApp us</a>` : ''}${settings.support_whatsapp && settings.support_email ? ' or ' : ''}${settings.support_email ? html`<a href="mailto:${settings.support_email}">email us</a>` : ''}</p>` : ''}
</footer>
<script>window.STORE = ${jsonScript(data)};</script>
<script src="/static/cart.js" defer></script>
</body>
</html>`;
}

function bagDrawer() {
  return html`
<div class="scrim" data-scrim hidden></div>
<aside class="bag" data-bag aria-label="Your bag" aria-hidden="true">
  <div class="bag-head">
    <h2>Your bag</h2>
    <button type="button" class="icon-btn" data-close-bag aria-label="Close bag">✕</button>
  </div>
  <div class="bag-items" data-bag-items></div>
  <div class="bag-foot" data-bag-foot></div>
</aside>
<div class="sheet" data-sheet aria-hidden="true"></div>
<a class="bag-bar" href="/checkout" data-bag-bar hidden></a>`;
}

/** Product data the browser needs for the bag (prices are re-checked on the server at checkout). */
export const productForClient = (p, reelSlug) => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  price: p.price_paise,
  mrp: p.mrp_paise,
  image: p.images[0] || '',
  optionLabel: p.option_label,
  options: p.option_values,
  soldOut: p.stock === 0,
  reelSlug,
});

function priceLine(p) {
  const off = discountPercent(p.price_paise, p.mrp_paise);
  return html`<span class="price">${formatMoney(p.price_paise)}</span>
    ${off ? html`<s class="mrp">${formatMoney(p.mrp_paise)}</s><span class="off">${off}% off</span>` : ''}`;
}

const productImage = (p, cls = '') =>
  p.images[0]
    ? html`<img src="${p.images[0]}" alt="${p.name}" loading="lazy" class="${cls}">`
    : html`<span class="noimg ${cls}" aria-hidden="true">${p.name.slice(0, 1)}</span>`;

export function reelStorePage({ settings, reel }) {
  const products = reel.products;
  const total = products.reduce((s, p) => s + p.price_paise, 0);
  const body = html`
<section class="reel-hero">
  <a class="reel-frame" href="${reel.permalink || '#'}" ${reel.permalink ? raw('target="_blank" rel="noopener"') : ''}>
    ${reel.thumbnail_url ? html`<img src="${reel.thumbnail_url}" alt="">` : html`<span class="reel-frame-empty"></span>`}
    <span class="reel-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>
    ${reel.permalink ? html`<span class="reel-frame-label">Watch the reel</span>` : ''}
  </a>
  <div class="reel-intro">
    <h1>${reel.headline || 'Shop the reel'}</h1>
    <p class="reel-count">${products.length === 1 ? '1 piece' : `${products.length} pieces`} from this reel, in the order they appear.</p>
    ${products.length > 1 ? html`<p class="reel-total">Everything together: <strong>${formatMoney(total)}</strong></p>` : ''}
  </div>
</section>

<ol class="grid" aria-label="Products in this reel">
  ${products.map((p, i) => html`
  <li class="card ${p.stock === 0 ? 'is-soldout' : ''}">
    <a class="card-media" href="/r/${reel.slug}/p/${p.slug}">
      ${productImage(p)}
      <span class="seq" title="Appears ${i + 1}${['st', 'nd', 'rd'][i] || 'th'} in the reel">${i + 1}</span>
    </a>
    <div class="card-body">
      <a class="card-name" href="/r/${reel.slug}/p/${p.slug}">${p.name}</a>
      <div class="price-row">${priceLine(p)}</div>
      ${p.stock === 0
        ? html`<span class="soldout">Sold out</span>`
        : html`<button type="button" class="add-btn" data-add="${p.id}">Add to bag</button>`}
    </div>
  </li>`)}
</ol>
${products.length ? '' : html`<p class="empty">Nothing here right now. Check back soon.</p>`}`;
  return storeLayout({
    settings,
    title: reel.headline || 'Shop the reel',
    body,
    pageData: { reelSlug: reel.slug, products: products.map((p) => productForClient(p, reel.slug)) },
  });
}

export function productPage({ settings, reel, product: p }) {
  const body = html`
<nav class="crumb"><a href="/r/${reel.slug}">Back to ${reel.headline || 'the reel'}</a></nav>
<article class="pdp">
  <div class="gallery" ${p.images.length > 1 ? raw('data-gallery') : ''}>
    ${p.images.length ? p.images.map((src, i) => html`<img src="${src}" alt="${p.name}${i ? ` (${i + 1})` : ''}" ${i ? raw('loading="lazy"') : ''}>`) : productImage(p, 'pdp-noimg')}
  </div>
  ${p.images.length > 1 ? html`<p class="gallery-hint">Swipe for more photos (${p.images.length})</p>` : ''}
  <div class="pdp-info">
    <h1>${p.name}</h1>
    <div class="price-row big">${priceLine(p)}</div>
    ${p.stock != null && p.stock > 0 && p.stock <= 5 ? html`<p class="low">Only ${p.stock} left</p>` : ''}
    <form class="pdp-form" data-pdp-form="${p.id}">
      ${p.option_values.length ? html`
      <fieldset class="chips">
        <legend>${p.option_label}</legend>
        ${p.option_values.map((v) => html`<label><input type="radio" name="option" value="${v}" required><span>${v}</span></label>`)}
      </fieldset>` : ''}
      <div class="qty-row">
        <span class="qty-label" id="qty-label">Quantity</span>
        <div class="stepper" role="group" aria-labelledby="qty-label">
          <button type="button" data-step="-1" aria-label="Decrease quantity">−</button>
          <input name="qty" type="number" min="1" max="10" value="1" inputmode="numeric" aria-labelledby="qty-label">
          <button type="button" data-step="1" aria-label="Increase quantity">+</button>
        </div>
      </div>
      ${p.stock === 0
        ? html`<button type="button" class="primary" disabled>Sold out</button>`
        : html`<button type="submit" class="primary">Add to bag</button>`}
    </form>
    ${p.description ? html`<div class="desc">${p.description.split(/\n{2,}/).map((para) => html`<p>${para}</p>`)}</div>` : ''}
  </div>
</article>`;
  return storeLayout({
    settings,
    title: p.name,
    body,
    pageData: { reelSlug: reel.slug, products: [productForClient(p, reel.slug)] },
  });
}

export function checkoutPage({ settings }) {
  const body = html`
<section class="checkout">
  <h1>Checkout</h1>
  <div class="checkout-grid">
    <form class="address-form" data-checkout novalidate>
      <h2>Delivery details</h2>
      <label>Full name<input name="name" autocomplete="name" required maxlength="80"></label>
      <label>Mobile number<input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" required placeholder="10-digit number"></label>
      <label><span>Email <span class="opt">(optional)</span></span><input name="email" type="email" autocomplete="email"></label>
      <label>Address<textarea name="address" rows="3" autocomplete="street-address" required placeholder="House no., street, area, landmark"></textarea></label>
      <div class="row3">
        <label>PIN code<input name="pincode" inputmode="numeric" maxlength="6" autocomplete="postal-code" required></label>
        <label>City<input name="city" autocomplete="address-level2" required></label>
        <label>State<input name="state" autocomplete="address-level1" required></label>
      </div>
      <p class="form-error" data-form-error role="alert" hidden></p>
      <button type="submit" class="primary" data-place-order>Place order</button>
      <p class="fine">You'll pay on the next screen by scanning a UPI QR code.</p>
    </form>
    <aside class="summary" data-summary aria-label="Order summary"></aside>
  </div>
</section>`;
  return storeLayout({ settings, title: 'Checkout', body, pageData: { page: 'checkout' } });
}

const STEPS = ['awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered'];
const STEP_TEXT = {
  awaiting_payment: 'Order placed',
  payment_submitted: 'Payment sent',
  paid: 'Payment confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

export function orderPage({ settings, order, qrSvg }) {
  const current = STEPS.indexOf(order.status);
  const cancelled = order.status === 'cancelled';
  const body = html`
<section class="order">
  <p class="order-no">Order ${order.order_number}</p>
  <h1>${cancelled ? 'This order was cancelled' : order.status === 'awaiting_payment' ? 'Scan to pay' : `Thanks, ${order.customer_name.split(' ')[0]}!`}</h1>

  ${cancelled ? '' : html`
  <ol class="steps" aria-label="Order progress">
    ${STEPS.map((s, i) => html`<li class="${i < current ? 'done' : i === current ? 'now' : ''}" ${i === current ? raw('aria-current="step"') : ''}>${STEP_TEXT[s]}</li>`)}
  </ol>`}

  ${order.status === 'awaiting_payment' ? html`
  <div class="pay">
    <div class="demo-note" role="note"><strong>Demo payment.</strong> This QR isn't connected to a real account yet, so no money will move. Tap “I've paid” to continue.</div>
    <div class="pay-card">
      <div class="qr">${raw(qrSvg)}</div>
      <div class="pay-meta">
        <p class="pay-amount">${formatMoney(order.total_paise)}</p>
        <p>Scan with any UPI app</p>
        <p class="upi">UPI ID: <span>${settings.upi_id}</span></p>
      </div>
    </div>
    <form method="post" action="/order/${order.public_token}/paid">
      <button class="primary" type="submit">I've paid ${formatMoney(order.total_paise)}</button>
    </form>
  </div>` : ''}

  ${order.status === 'payment_submitted' ? html`<p class="status-note">We're checking your payment. You'll get a confirmation soon. Keep this page to track your order.</p>` : ''}
  ${['paid', 'shipped', 'delivered'].includes(order.status) ? html`<p class="status-note">${ORDER_STATUSES[order.status]}. Keep this page to track your order.</p>` : ''}

  <div class="order-detail">
    <h2>Items</h2>
    <ul class="lines">
      ${order.items.map((it) => html`<li>
        ${it.image ? html`<img src="${it.image}" alt="">` : html`<span class="noimg" aria-hidden="true">${it.name.slice(0, 1)}</span>`}
        <span class="line-name">${it.name}${it.option_value ? html`<small>${it.option_value}</small>` : ''}<small>Qty ${it.qty}</small></span>
        <span>${formatMoney(it.price_paise * it.qty)}</span>
      </li>`)}
    </ul>
    <dl class="totals">
      <div><dt>Subtotal</dt><dd>${formatMoney(order.subtotal_paise)}</dd></div>
      <div><dt>Delivery</dt><dd>${order.shipping_paise ? formatMoney(order.shipping_paise) : 'Free'}</dd></div>
      <div class="grand"><dt>Total</dt><dd>${formatMoney(order.total_paise)}</dd></div>
    </dl>
    <h2>Delivering to</h2>
    <p class="addr">${order.customer_name}<br>${order.address}<br>${order.city}, ${order.state} ${order.pincode}<br>${order.phone}</p>
  </div>
</section>`;
  return storeLayout({ settings, title: `Order ${order.order_number}`, body, pageData: { page: 'order' } });
}

export function homePage({ settings, reels }) {
  const body = html`
<section class="home">
  <h1>${settings.store_name}</h1>
  ${settings.tagline ? html`<p class="tagline">${settings.tagline}</p>` : ''}
  ${reels.length ? html`
  <ul class="reel-list">
    ${reels.map((r) => html`<li><a href="/r/${r.slug}">
      ${r.thumbnail_url ? html`<img src="${r.thumbnail_url}" alt="" loading="lazy">` : html`<span class="reel-frame-empty"></span>`}
      <span>${r.headline || 'Shop the reel'}</span>
    </a></li>`)}
  </ul>` : html`<p class="empty">New pieces are on the way.</p>`}
</section>`;
  return storeLayout({ settings, body });
}

export function notFoundPage({ settings, message = 'This page doesn’t exist.' }) {
  return storeLayout({
    settings,
    title: 'Not found',
    bare: true,
    body: html`<section class="empty-page"><h1>Nothing here</h1><p>${message}</p><a class="primary" href="/">Go to the store</a></section>`,
  });
}
