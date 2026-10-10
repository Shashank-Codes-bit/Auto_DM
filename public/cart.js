// Shopper-side bag, product sheet and checkout. Prices shown here are for display only;
// the server recalculates everything when the order is placed.
(() => {
  const S = window.STORE || {};
  const KEY = 'bag:v1';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (p) => {
    const r = (p || 0) / 100;
    return '₹' + r.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 });
  };

  // ---- storage -------------------------------------------------------------
  function load() {
    try {
      const b = JSON.parse(localStorage.getItem(KEY));
      if (b && Array.isArray(b.items)) return b;
    } catch {}
    return { items: [], reelSlug: '', source: '' };
  }
  function save(b) {
    try {
      localStorage.setItem(KEY, JSON.stringify(b));
    } catch {}
    render();
    if (typeof escapeUrl === 'function' && inApp) $$('[data-escape-link]').forEach((a) => (a.href = escapeUrl()));
  }
  let bag = load();

  const count = () => bag.items.reduce((n, i) => n + i.qty, 0);
  const subtotal = () => bag.items.reduce((s, i) => s + i.price * i.qty, 0);
  const shipping = (sub) => (sub === 0 ? 0 : S.freeShippingAbove > 0 && sub >= S.freeShippingAbove ? 0 : S.shippingFee || 0);

  function add(product, option, qty) {
    const line = bag.items.find((i) => i.productId === product.id && i.option === option);
    if (line) line.qty = Math.min(10, line.qty + qty);
    else {
      bag.items.push({
        productId: product.id, slug: product.slug, name: product.name, price: product.price,
        image: product.image, option, qty: Math.min(10, qty), reelSlug: product.reelSlug,
      });
    }
    save(bag);
  }

  // ---- bag drawer ----------------------------------------------------------
  const drawer = $('[data-bag]');
  const scrim = $('[data-scrim]');
  const sheet = $('[data-sheet]');

  function openBag() {
    if (!drawer) return;
    closeSheet();
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    scrim.hidden = false;
    $('[data-close-bag]', drawer)?.focus();
  }
  function closeBag() {
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    if (!sheet?.classList.contains('open')) scrim.hidden = true;
  }

  function lineHtml(i, idx, editable) {
    return `<li class="line">
      ${i.image ? `<img src="${esc(i.image)}" alt="">` : `<span class="noimg" aria-hidden="true">${esc(i.name.slice(0, 1))}</span>`}
      <div class="line-name">${esc(i.name)}${i.option ? `<small>${esc(i.option)}</small>` : ''}
        ${editable
          ? `<div class="stepper small" role="group" aria-label="Quantity of ${esc(i.name)}">
              <button type="button" data-line="${idx}" data-delta="-1" aria-label="Decrease">−</button>
              <span>${i.qty}</span>
              <button type="button" data-line="${idx}" data-delta="1" aria-label="Increase">+</button>
            </div>`
          : `<small>Qty ${i.qty}</small>`}
      </div>
      <div class="line-end">
        <span>${money(i.price * i.qty)}</span>
        ${editable ? `<button type="button" class="link-btn" data-remove="${idx}">Remove</button>` : ''}
      </div>
    </li>`;
  }

  function totalsHtml() {
    const sub = subtotal();
    const ship = shipping(sub);
    const toFree = S.freeShippingAbove > 0 && ship > 0 ? S.freeShippingAbove - sub : 0;
    return `<dl class="totals">
      <div><dt>Subtotal</dt><dd>${money(sub)}</dd></div>
      <div><dt>Delivery</dt><dd>${ship ? money(ship) : 'Free'}</dd></div>
      <div class="grand"><dt>Total</dt><dd>${money(sub + ship)}</dd></div>
    </dl>
    ${toFree > 0 ? `<p class="free-note">Add ${money(toFree)} more for free delivery.</p>` : ''}`;
  }

  function render() {
    const n = count();
    $$('[data-bag-count]').forEach((el) => {
      el.textContent = n;
      el.hidden = n === 0;
    });

    const items = $('[data-bag-items]');
    const foot = $('[data-bag-foot]');
    if (items) {
      items.innerHTML = bag.items.length
        ? `<ul class="lines">${bag.items.map((i, idx) => lineHtml(i, idx, true)).join('')}</ul>`
        : `<div class="bag-empty"><p>Your bag is empty.</p><a class="btn btn-line" href="${S.reelSlug ? `/r/${esc(S.reelSlug)}` : '/shop'}">Start shopping</a></div>`;
      foot.innerHTML = bag.items.length ? `${totalsHtml()}<a class="btn btn-gold btn-wide btn-lg" href="/checkout">Checkout</a>` : '';
    }

    const summary = $('[data-summary]');
    if (summary) {
      summary.innerHTML = bag.items.length
        ? `<h2>Your order</h2><ul class="lines">${bag.items.map((i, idx) => lineHtml(i, idx, true)).join('')}</ul>${totalsHtml()}`
        : `<h2>Your order</h2><p>Your bag is empty.</p><a class="link" href="${bag.reelSlug ? `/r/${esc(bag.reelSlug)}` : '/shop'}">${bag.reelSlug ? 'Back to the reel' : 'Go to the shop'}</a>`;
      const btn = $('[data-place-order]');
      if (btn) btn.disabled = bag.items.length === 0;
    }
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a, [data-scrim]');
    if (!t) return;
    if (t.matches('[data-open-bag]')) return openBag();
    if (t.matches('[data-close-bag]')) return closeBag();
    if (t.matches('[data-scrim]')) return closeBag(), closeSheet();
    if (t.matches('[data-open-filters]')) return openFilters();
    if (t.matches('[data-close-sheet]')) return closeSheet();
    if (t.dataset.delta) {
      const line = bag.items[Number(t.dataset.line)];
      if (!line) return;
      line.qty = Math.max(1, Math.min(10, line.qty + Number(t.dataset.delta)));
      return save(bag);
    }
    if (t.dataset.remove != null) {
      bag.items.splice(Number(t.dataset.remove), 1);
      return save(bag);
    }
    if (t.dataset.add) {
      const product = (S.products || []).find((p) => p.id === Number(t.dataset.add));
      if (!product) return;
      if (product.options.length) return openSheet(product);
      add(product, '', 1);
      return openBag();
    }
    if (t.dataset.step) {
      const input = t.parentElement.querySelector('input');
      input.value = Math.max(1, Math.min(10, (Number(input.value) || 1) + Number(t.dataset.step)));
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeBag(), closeSheet();
  });

  // ---- option sheet (for products with sizes etc.) -------------------------
  function openSheet(product) {
    if (!sheet) return;
    sheet.innerHTML = `<form class="sheet-inner">
      <span class="grab"></span>
      <div class="sheet-product">
        ${product.image ? `<img src="${esc(product.image)}" alt="">` : ''}
        <div><p class="sheet-name">${esc(product.name)}</p><p>${money(product.price)}</p></div>
        <button type="button" class="icon-btn" data-close-sheet aria-label="Close">✕</button>
      </div>
      <fieldset class="chips-opt"><legend>Choose ${esc(product.optionLabel.toLowerCase() || 'an option')}</legend>
        ${product.options.map((o) => `<label><input type="radio" name="option" value="${esc(o)}" required><span>${esc(o)}</span></label>`).join('')}
      </fieldset>
      <button class="btn btn-gold btn-wide btn-lg" type="submit">Add to bag</button>
    </form>`;
    showSheet();
    $('form', sheet).onsubmit = (e) => {
      e.preventDefault();
      const option = new FormData(e.target).get('option');
      if (!option) return;
      add(product, option, 1);
      openBag();
    };
  }
  function showSheet() {
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    scrim.hidden = false;
    $('input:checked, input, button', sheet)?.focus();
  }

  // Shop "Filter & sort": the form lives in a <template> on the page and opens in the sheet.
  function openFilters() {
    const tpl = $('[data-filters-template]');
    if (!tpl || !sheet) return;
    closeBag();
    sheet.innerHTML = '';
    sheet.append(tpl.content.cloneNode(true));
    const form = $('form', sheet);
    // Empty choices shouldn't clutter the link (?price=&sort=popular).
    form.addEventListener('submit', () => {
      $$('input[type=radio]:checked', form).forEach((i) => {
        if (!i.value || (i.name === 'sort' && i.value === 'popular')) i.disabled = true;
      });
    });
    showSheet();
  }

  function closeSheet() {
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    if (!drawer?.classList.contains('open')) scrim.hidden = true;
  }

  // ---- product page --------------------------------------------------------
  const gallery = $('[data-gallery]');
  const dots = $$('[data-dots] i');
  if (gallery && dots.length) {
    gallery.addEventListener('scroll', () => {
      const i = Math.round(gallery.scrollLeft / gallery.clientWidth);
      dots.forEach((d, n) => d.classList.toggle('on', n === i));
    }, { passive: true });
  }

  const pdp = $('[data-pdp-form]');
  if (pdp) {
    pdp.addEventListener('submit', (e) => {
      e.preventDefault();
      const product = S.products[0];
      const fd = new FormData(pdp);
      const option = fd.get('option') || '';
      if (product.options.length && !option) return;
      add(product, option, Math.max(1, Math.min(10, Number(fd.get('qty')) || 1)));
      openBag();
    });
  }

  // ---- checkout ------------------------------------------------------------
  const form = $('[data-checkout]');
  if (form) {
    const errorBox = $('[data-form-error]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      if (!bag.items.length) return;
      const btn = $('[data-place-order]');
      btn.disabled = true;
      btn.textContent = 'Placing order…';
      try {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': form.dataset.csrf || '' },
          body: JSON.stringify({
            items: bag.items.map((i) => ({ productId: i.productId, option: i.option, qty: i.qty })),
            customer: Object.fromEntries([...new FormData(form)].filter(([k]) => k !== 'password')),
            password: form.elements.password?.value || '',
            reelSlug: bag.reelSlug,
            source: bag.source,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Couldn’t place the order. Check your details and try again.');
        bag = { items: [], reelSlug: '', source: '' };
        save(bag);
        location.href = `/order/${encodeURIComponent(data.token)}`;
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Place order';
      }
    });
  }

  // ---- leaving Instagram's in-app browser for Chrome/Safari -----------------
  // Instagram opens DM links in its own in-app browser. We offer a way out to the real browser,
  // carrying the bag along in the link (?bag=...). Shown only inside Instagram/Facebook.
  const params = new URLSearchParams(location.search);
  const ua = navigator.userAgent || '';
  const inApp = /Instagram|FBAN|FBAV/i.test(ua) || params.get('preview_inapp') === '1';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const browserName = isAndroid ? 'Chrome' : isIOS ? 'Safari' : 'your browser';

  const b64url = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64url = (str) => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

  function escapeUrl() {
    const url = new URL('/shop', location.origin);
    if (bag.items.length) {
      url.searchParams.set('bag', b64url(JSON.stringify({
        i: bag.items.map((i) => [i.productId, i.option, i.qty]), r: bag.reelSlug || '', s: bag.source || '',
      })));
    }
    const https = url.toString();
    if (isAndroid) {
      return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(https)};end`;
    }
    if (isIOS) return `x-safari-${https}`;
    return https;
  }

  function wireEscapeLink(a) {
    a.textContent = `Open full store in ${browserName}`;
    a.addEventListener('click', () => {
      a.href = escapeUrl();
      try { sessionStorage.setItem('escapeCardClosed', '1'); } catch {}
      setTimeout(() => $$('[data-escape-tip]').forEach((t) => (t.hidden = false)), 1500);
    });
    a.href = escapeUrl();
  }

  const escapeBlock = $('[data-escape]');
  if (inApp && escapeBlock) {
    escapeBlock.hidden = false;
    $('.escape-title', escapeBlock).textContent = `Shop the full store in ${browserName}`;
    wireEscapeLink($('[data-escape-link]', escapeBlock));

    // Floating card: appears once the shopper reaches the end of the page; stays until they act.
    let cardShown = false;
    const closed = () => { try { return sessionStorage.getItem('escapeCardClosed') === '1'; } catch { return false; } };
    const showCard = () => {
      if (cardShown || closed()) return;
      cardShown = true;
      const overlay = document.createElement('div');
      overlay.className = 'escape-overlay';
      overlay.innerHTML = `<div class="escape-card" role="dialog" aria-modal="true" aria-labelledby="escape-card-title">
        <button type="button" class="icon-btn escape-close" aria-label="Close">✕</button>
        <p class="escape-title" id="escape-card-title">Shop the full store in ${esc(browserName)}</p>
        <p class="escape-text">See every product, and your bag comes with you.</p>
        <a class="escape-btn" href="/shop" data-escape-link></a>
        <p class="escape-tip" data-escape-tip hidden>If nothing happens, tap ⋯ at the top and choose “Open in external browser”.</p>
      </div>`;
      document.body.append(overlay);
      wireEscapeLink($('[data-escape-link]', overlay));
      const close = () => {
        try { sessionStorage.setItem('escapeCardClosed', '1'); } catch {}
        overlay.remove();
      };
      $('.escape-close', overlay).addEventListener('click', close);
      $('.escape-close', overlay).focus();
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries, obs) => {
        if (entries.some((e) => e.isIntersecting)) {
          obs.disconnect();
          showCard();
        }
      }, { threshold: 0.4 }).observe(escapeBlock);
    }
  }

  // Arrived from the in-app browser with a bag in the link: restore it here.
  async function restoreBagFromLink() {
    const packed = params.get('bag');
    if (!packed) return;
    params.delete('bag');
    history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`);
    try {
      const data = JSON.parse(fromB64url(packed));
      const lines = (data.i || []).slice(0, 50);
      const res = await fetch(`/api/products?ids=${lines.map((l) => Number(l[0])).join(',')}`);
      const { products = [] } = await res.json();
      const byId = new Map(products.map((p) => [p.id, p]));
      let added = 0;
      for (const [id, option, qty] of lines) {
        const p = byId.get(Number(id));
        if (!p || p.soldOut || (p.options.length && !p.options.includes(option))) continue;
        const line = bag.items.find((i) => i.productId === p.id && i.option === (option || ''));
        if (line) line.qty = Math.max(line.qty, Math.min(10, Number(qty) || 1));
        else bag.items.push({ productId: p.id, slug: p.slug, name: p.name, price: p.price, image: p.image, option: option || '', qty: Math.min(10, Number(qty) || 1), reelSlug: data.r || '' });
        added++;
      }
      if (data.r) bag.reelSlug = String(data.r).slice(0, 60);
      if (data.s) bag.source = String(data.s).slice(0, 20);
      save(bag);
      if (added) openBag();
    } catch {
      // A broken or old link just means an empty bag.
    }
  }
  restoreBagFromLink();

  // Remember which reel (and whether it came from the DM) for order attribution.
  if (S.reelSlug) {
    bag.reelSlug = S.reelSlug;
    const src = new URLSearchParams(location.search).get('src');
    if (src) bag.source = src.slice(0, 20);
    save(bag);
  }

  // /shop#search (the search icon in the header) puts the cursor in the search box.
  if (location.hash === '#search') $('[data-autofocus-hash="search"]')?.focus();

  render();
})();
