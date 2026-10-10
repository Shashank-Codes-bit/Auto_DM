// Admin panel helpers: photo manager, reel product picker, copy link, confirmations.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const csrf = document.body.dataset.csrf;

  // Confirm destructive forms.
  $$('form[data-confirm]').forEach((f) =>
    f.addEventListener('submit', (e) => {
      if (!confirm(f.dataset.confirm)) e.preventDefault();
    }),
  );

  // Copy store link.
  $$('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        const old = b.textContent;
        b.textContent = 'Copied';
        setTimeout(() => (b.textContent = old), 1500);
      } catch {
        prompt('Copy this link', b.dataset.copy);
      }
    }),
  );

  // Move a list item up/down.
  function move(li, dir) {
    const sib = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
    if (!sib) return;
    dir < 0 ? li.parentNode.insertBefore(li, sib) : li.parentNode.insertBefore(sib, li);
  }

  // ---- product photos ----
  const images = $('[data-images]');
  if (images) {
    const max = Number(images.dataset.max) || 6;
    const status = $('[data-image-status]');
    const tpl = $('[data-image-template]');
    const say = (msg) => (status.textContent = msg);
    const addImage = (src) => {
      if (images.children.length >= max) return say(`You can add up to ${max} photos.`), false;
      const li = tpl.content.firstElementChild.cloneNode(true);
      $('img', li).src = src;
      $('input', li).value = src;
      images.append(li);
      return true;
    };

    images.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const li = b.closest('li');
      if (b.dataset.move) move(li, Number(b.dataset.move));
      if (b.hasAttribute('data-remove-image')) li.remove();
    });

    $('[data-add-url]').addEventListener('click', () => {
      const input = $('[data-image-url]');
      const url = input.value.trim();
      if (!/^https?:\/\//i.test(url)) return say('Paste a link that starts with https://');
      if (addImage(url)) {
        input.value = '';
        say('Photo added. Save the product to keep it.');
      }
    });

    $('[data-upload]').addEventListener('change', async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      for (const [i, file] of files.entries()) {
        if (images.children.length >= max) {
          say(`You can add up to ${max} photos.`);
          break;
        }
        say(`Uploading ${i + 1} of ${files.length}…`);
        const body = new FormData();
        body.append('file', file);
        try {
          const res = await fetch('/admin/media', { method: 'POST', body, headers: { 'x-csrf-token': csrf } });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Upload failed');
          addImage(data.url);
        } catch (err) {
          say(`${file.name}: ${err.message}`);
          return;
        }
      }
      say('Uploaded. Save the product to keep the photos.');
    });
  }

  // ---- single image (categories) ----
  const single = $('[data-upload-single]');
  if (single) {
    const field = $('[data-single-image]');
    const preview = $('[data-single-preview]');
    const status = $('[data-image-status]');
    const show = () => {
      preview.hidden = !field.value;
      if (field.value) preview.src = field.value;
    };
    field.addEventListener('change', show);
    single.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      status.textContent = 'Uploading…';
      const body = new FormData();
      body.append('file', file);
      try {
        const res = await fetch('/admin/media', { method: 'POST', body, headers: { 'x-csrf-token': csrf } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        field.value = data.url;
        show();
        status.textContent = 'Uploaded. Save to keep it.';
      } catch (err) {
        status.textContent = err.message;
      }
    });
  }

  $$('[data-autosubmit]').forEach((el) => el.addEventListener('change', () => el.form.submit()));

  // ---- reel product picker ----
  const picked = $('[data-picked]');
  if (picked) {
    const max = Number(picked.dataset.max) || 20;
    const counter = $('[data-counter]');
    const empty = $('[data-picked-empty]');
    const error = $('[data-picked-error]');
    const ids = () => $$('input[name="productIds"]', picked).map((i) => i.value);

    function refresh() {
      const chosen = ids();
      counter.textContent = `${chosen.length} / ${max}`;
      counter.classList.toggle('full', chosen.length >= max);
      empty.hidden = chosen.length > 0;
      $$('[data-pick]').forEach((b) => (b.disabled = chosen.includes(b.dataset.pick) || chosen.length >= max));
      error.hidden = true;
    }

    picked.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const li = b.closest('li');
      if (b.dataset.move) move(li, Number(b.dataset.move));
      if (b.hasAttribute('data-unpick')) li.remove();
      refresh();
    });

    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b || ids().length >= max) return;
      const tpl = $(`[data-picked-templates] template[data-for="${b.dataset.pick}"]`);
      if (tpl) picked.append(tpl.content.firstElementChild.cloneNode(true));
      refresh();
    });

    const search = $('[data-catalog-search]');
    search?.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      $$('[data-catalog] li').forEach((li) => (li.hidden = q && !li.dataset.name.includes(q)));
    });

    $('[data-reel-form]').addEventListener('submit', (e) => {
      const n = ids().length;
      if (n < 1 || n > max) {
        e.preventDefault();
        error.textContent = n < 1 ? 'Pick at least 1 product for this reel.' : `A reel can show at most ${max} products.`;
        error.hidden = false;
        error.scrollIntoView({ block: 'center' });
      }
    });
    refresh();
  }
})();
