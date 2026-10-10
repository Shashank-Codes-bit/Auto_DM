// The Reels tab: full-screen reels that snap one by one, play muted when in view, and keep loading.
(() => {
  const S = window.STORE || {};
  const feed = document.querySelector('[data-feed]');
  if (!feed) return;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

  let muted = true;
  let cursor = S.nextCursor || null;
  let loading = false;
  let ended = false;

  function slideHtml(r) {
    const media = r.video
      ? `<video src="${esc(r.video)}" ${r.thumb ? `poster="${esc(r.thumb)}"` : ''} muted loop playsinline preload="metadata"></video>`
      : r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : '';
    return `<section class="slide" id="${esc(r.slug)}" data-slug="${esc(r.slug)}" aria-label="${esc(r.headline)}">
      <div class="slide-media">${media}</div>
      <span class="sound-hint" data-hint></span>
      <div class="slide-actions">
        ${r.video ? `<button type="button" class="round" data-mute aria-label="Turn sound on">${icon('sound-off')}</button>` : ''}
        <button type="button" class="round" data-share aria-label="Copy link to this reel">${icon('share')}</button>
        ${S.isAdmin ? `<a class="round" href="/admin/reels/${esc(r.id)}" aria-label="Edit this reel store" style="font-size:12px;font-weight:800">Edit</a>` : ''}
      </div>
      <div class="slide-info">
        <h2>${esc(r.headline)}</h2>
        <span class="slide-meta">${r.count} ${r.count === 1 ? 'piece' : 'pieces'} from this reel${!r.video && r.permalink ? ` · <a href="${esc(r.permalink)}" style="color:#fff">Watch on Instagram</a>` : ''}</span>
        ${r.products.length ? `<div class="slide-products">${r.products.map((p) => `<a href="/r/${esc(r.slug)}/p/${esc(p.slug)}">${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}<span>${esc(p.price)}<small>${esc(p.name)}</small></span></a>`).join('')}</div>` : ''}
        <a class="btn btn-gold btn-wide btn-lg" href="/r/${esc(r.slug)}">Shop now</a>
      </div>
    </section>`;
  }

  function hint(slide, text) {
    const h = slide.querySelector('[data-hint]');
    h.textContent = text;
    h.classList.add('show');
    clearTimeout(h._t);
    h._t = setTimeout(() => h.classList.remove('show'), 1200);
  }

  function setMuteIcons() {
    feed.querySelectorAll('[data-mute]').forEach((b) => {
      b.innerHTML = icon(muted ? 'sound-off' : 'sound-on');
      b.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
    });
    feed.querySelectorAll('video').forEach((v) => (v.muted = muted));
  }

  // Only the reel on screen plays; the rest pause.
  const player = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const video = e.target.querySelector('video');
      if (!video) continue;
      if (e.isIntersecting) {
        video.muted = muted;
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  }, { root: feed, threshold: 0.6 });

  // A broken or expired video link falls back to the thumbnail.
  function watchErrors(slide) {
    const video = slide.querySelector('video');
    if (!video) return;
    video.addEventListener('error', () => {
      const poster = video.getAttribute('poster');
      video.replaceWith(Object.assign(document.createElement('img'), { src: poster || '', alt: '' }));
      slide.querySelector('[data-mute]')?.remove();
    }, { once: true });
  }

  function append(reels) {
    const tpl = document.createElement('template');
    tpl.innerHTML = reels.map(slideHtml).join('');
    const slides = [...tpl.content.children];
    feed.append(tpl.content);
    slides.forEach((s) => {
      player.observe(s);
      watchErrors(s);
    });
    // Start fetching the next batch when the second-to-last slide shows up.
    const trigger = feed.querySelectorAll('.slide')[Math.max(0, feed.querySelectorAll('.slide').length - 2)];
    if (trigger) loader.observe(trigger);
  }

  function finish() {
    if (ended) return;
    ended = true;
    const end = document.querySelector('[data-end-template]');
    if (end) feed.append(end.content.cloneNode(true));
  }

  async function loadMore() {
    if (loading || ended) return;
    if (!cursor) return finish();
    loading = true;
    try {
      const res = await fetch(`/api/reels?cursor=${encodeURIComponent(cursor)}`);
      const data = await res.json();
      cursor = data.nextCursor;
      append(data.reels || []);
      if (!cursor) finish();
    } catch {
      // Network hiccup: try again when the shopper scrolls further.
    } finally {
      loading = false;
    }
  }

  const loader = new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        obs.unobserve(e.target);
        loadMore();
      }
    }
  }, { root: feed, threshold: 0.1 });

  feed.addEventListener('click', async (e) => {
    const slide = e.target.closest('.slide');
    if (!slide) return;
    if (e.target.closest('[data-share]')) {
      const url = `${location.origin}/r/${slide.dataset.slug}`;
      try {
        if (navigator.share) await navigator.share({ url, title: slide.getAttribute('aria-label') });
        else {
          await navigator.clipboard.writeText(url);
          hint(slide, 'Link copied');
        }
      } catch {}
      return;
    }
    if (e.target.closest('a, button:not([data-mute])')) return;
    // Tapping the video (or the sound button) toggles sound for every reel, like Instagram.
    if (!slide.querySelector('video')) return;
    muted = !muted;
    setMuteIcons();
    const v = slide.querySelector('video');
    if (v.paused) v.play().catch(() => {});
    hint(slide, muted ? 'Sound off' : 'Sound on');
  });

  // Desktop: arrow keys move between reels.
  document.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'j', 'k'].includes(e.key)) return;
    e.preventDefault();
    const down = ['ArrowDown', 'PageDown', 'j'].includes(e.key);
    feed.scrollBy({ top: (down ? 1 : -1) * feed.clientHeight, behavior: 'smooth' });
  });

  const reels = S.reels || [];
  if (!reels.length) {
    finish();
    return;
  }
  append(reels);
  if (!cursor) finish();

  // /reels#<slug> opens straight at that reel.
  const target = location.hash.slice(1) && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) target.scrollIntoView({ block: 'start' });
})();
