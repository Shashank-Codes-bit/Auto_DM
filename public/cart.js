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

    const bar = $('[data-bag-bar]');
    if (bar) {
      bar.hidden = n === 0 || S.page === 'checkout';
      bar.innerHTML = `<span>Bag (${n})</span><span>${money(subtotal())}</span><span class="bar-cta">Checkout</span>`;
    }

    const items = $('[data-bag-items]');
    const foot = $('[data-bag-foot]');
    if (items) {
      items.innerHTML = bag.items.length
        ? `<ul class="lines">${bag.items.map((i, idx) => lineHtml(i, idx, true)).join('')}</ul>`
        : `<div class="bag-empty"><p>Your bag is empty.</p>${S.reelSlug ? '' : '<p>Open a reel’s store to add pieces.</p>'}</div>`;
      foot.innerHTML = bag.items.length ? `${totalsHtml()}<a class="primary" href="/checkout">Checkout</a>` : '';
    }

    const summary = $('[data-summary]');
    if (summary) {
      summary.innerHTML = bag.items.length
        ? `<h2>Your order</h2><ul class="lines">${bag.items.map((i, idx) => lineHtml(i, idx, true)).join('')}</ul>${totalsHtml()}`
        : `<h2>Your order</h2><p>Your bag is empty.</p>${bag.reelSlug ? `<a href="/r/${esc(bag.reelSlug)}">Back to the reel</a>` : ''}`;
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
      <div class="sheet-head">
        ${product.image ? `<img src="${esc(product.image)}" alt="">` : ''}
        <div><p class="sheet-name">${esc(product.name)}</p><p>${money(product.price)}</p></div>
        <button type="button" class="icon-btn" data-close-sheet aria-label="Close">✕</button>
      </div>
      <fieldset class="chips"><legend>Choose ${esc(product.optionLabel.toLowerCase() || 'an option')}</legend>
        ${product.options.map((o) => `<label><input type="radio" name="option" value="${esc(o)}" required><span>${esc(o)}</span></label>`).join('')}
      </fieldset>
      <button class="primary" type="submit">Add to bag</button>
    </form>`;
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    scrim.hidden = false;
    $('input', sheet)?.focus();
    $('[data-close-sheet]', sheet).onclick = closeSheet;
    $('form', sheet).onsubmit = (e) => {
      e.preventDefault();
      const option = new FormData(e.target).get('option');
      if (!option) return;
      add(product, option, 1);
      openBag();
    };
  }
  function closeSheet() {
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    if (!drawer?.classList.contains('open')) scrim.hidden = true;
  }

  // ---- product page --------------------------------------------------------
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: bag.items.map((i) => ({ productId: i.productId, option: i.option, qty: i.qty })),
            customer: Object.fromEntries(new FormData(form)),
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

  // Remember which reel (and whether it came from the DM) for order attribution.
  if (S.reelSlug) {
    bag.reelSlug = S.reelSlug;
    const src = new URLSearchParams(location.search).get('src');
    if (src) bag.source = src.slice(0, 20);
    save(bag);
  }

  render();
})();
