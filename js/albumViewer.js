// Our Album: the full-screen photo viewer, shared by the guest app and the staff app (v0.129.0).
//   - One photo fills the screen. Swipe left or right (or use the arrows, or the keyboard) to go to the next or the previous one: no going in and out.
//   - The top shows WHO posted it (the whole name, over as many lines as needed), when, and "3 of 24". The buttons are one slim row at the bottom, so a tall
//     (portrait) photo never hides the name.
//   - The buttons are decided by the caller (Keep, Not for me, Save, Delete, Favourite...). A button answers 'next' (go on to the next photo), 'stay', or
//     'removed' (the photo is gone from the album: the viewer moves on).
// No framework and no import: it builds its own elements, so the guest app (which has its own small helper) and the staff app can both use it.
//
// openAlbumViewer({ photos, index, fullUrl(photo) -> Promise<url|null>, thumbUrl(photo) -> url|null, title(photo), subtitle(photo), actions(photo) -> [{ label, icon, onClick(photo, api), active?, disabled? }], onClose })
// Returns { close, redraw }.

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}

const SWIPE_DISTANCE = 60;   // pixels of finger travel that count as a swipe

export function openAlbumViewer(options) {
  let photos = [...options.photos];
  let index = Math.min(Math.max(options.index ?? 0, 0), photos.length - 1);
  if (photos.length === 0) return { close() {}, redraw() {} };

  const image = el('img', { class: 'albv-image', alt: '', draggable: 'false' });
  const stage = el('div', { class: 'albv-stage' }, image);
  const titleEl = el('div', { class: 'albv-title' });
  const subtitleEl = el('div', { class: 'albv-sub' });
  const counterEl = el('div', { class: 'albv-count' });
  const bar = el('div', { class: 'albv-bar' });
  const message = el('div', { class: 'albv-message', role: 'status' });
  const prevButton = el('button', { class: 'albv-arrow albv-arrow--prev', type: 'button', 'aria-label': 'Previous photo', onclick: () => go(-1) }, '‹');
  const nextButton = el('button', { class: 'albv-arrow albv-arrow--next', type: 'button', 'aria-label': 'Next photo', onclick: () => go(1) }, '›');
  const closeButton = el('button', { class: 'albv-close', type: 'button', 'aria-label': 'Close', onclick: () => close() }, '✕');
  const root = el('div', { class: 'albv', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo' },
    el('div', { class: 'albv-top' }, closeButton, el('div', { class: 'albv-who' }, titleEl, subtitleEl), counterEl),
    stage, prevButton, nextButton, message, bar);

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.append(root);

  let shownFor = null;   // the photo id the big picture belongs to (a late answer for another photo is ignored)
  const api = {
    say(text) { message.textContent = text ?? ''; },
    get photo() { return photos[index]; },
  };

  function close() {
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = previousOverflow;
    root.remove();
    options.onClose?.();
  }

  // Shows photo `index`: the small picture at once, the big one as soon as it arrives. The neighbours are asked for in advance so swiping is quick.
  function show() {
    const photo = photos[index];
    shownFor = photo.id;
    titleEl.textContent = options.title(photo);
    subtitleEl.textContent = options.subtitle(photo);
    counterEl.textContent = `${index + 1} of ${photos.length}`;
    prevButton.hidden = index === 0; nextButton.hidden = index === photos.length - 1;
    message.textContent = '';
    image.style.transform = ''; image.style.transition = '';
    const small = options.thumbUrl?.(photo);
    if (small) image.src = small; else image.removeAttribute('src');
    image.classList.add('albv-loading');
    Promise.resolve(options.fullUrl(photo)).then((url) => { if (url && shownFor === photo.id) { image.src = url; } }).catch(() => {}).finally(() => { if (shownFor === photo.id) image.classList.remove('albv-loading'); });
    for (const near of [photos[index + 1], photos[index - 1]]) if (near) Promise.resolve(options.fullUrl(near)).then((url) => { if (url) new Image().src = url; }).catch(() => {});
    drawBar();
  }

  function drawBar() {
    const photo = photos[index];
    bar.replaceChildren(...options.actions(photo).map((a) => el('button', {
      class: `albv-action${a.active ? ' is-on' : ''}${a.danger ? ' is-danger' : ''}`, type: 'button', disabled: a.disabled ? '' : null, 'aria-pressed': a.active ? 'true' : null,
      onclick: async () => {
        const result = await a.onClick(photo, api);
        if (result === 'removed') { photos.splice(index, 1); if (photos.length === 0) { close(); return; } index = Math.min(index, photos.length - 1); show(); }
        else if (result === 'next') { if (index < photos.length - 1) go(1); else drawBar(); }
        else drawBar();
      },
    }, el('span', { class: 'albv-icon', 'aria-hidden': 'true' }, a.icon), el('span', { class: 'albv-label' }, a.label))));
  }

  function go(step) {
    const next = index + step;
    if (next < 0 || next >= photos.length) { image.style.transition = 'transform .15s'; image.style.transform = ''; return; }
    index = next; show();
  }

  // Swiping: the picture follows the finger; letting go past SWIPE_DISTANCE goes to the next or previous photo, else it springs back.
  let start = null;
  stage.addEventListener('touchstart', (e) => { start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false } : null; image.style.transition = ''; }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (!start) return;
    const dx = e.touches[0].clientX - start.x; const dy = e.touches[0].clientY - start.y;
    if (!start.moved && Math.abs(dx) < 8) return;
    if (Math.abs(dy) > Math.abs(dx) * 1.5 && !start.moved) { start = null; return; }  // a vertical move is not a swipe
    start.moved = true;
    image.style.transform = `translateX(${dx}px)`;
  }, { passive: true });
  const end = (e) => {
    if (!start) return;
    const dx = (e.changedTouches?.[0]?.clientX ?? start.x) - start.x;
    start = null;
    image.style.transition = 'transform .15s';
    if (dx <= -SWIPE_DISTANCE) go(1); else if (dx >= SWIPE_DISTANCE) go(-1); else image.style.transform = '';
  };
  stage.addEventListener('touchend', end, { passive: true });
  stage.addEventListener('touchcancel', end, { passive: true });

  function onKey(e) {
    if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);

  show();
  return { close, redraw: drawBar };
}
