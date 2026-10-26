// Our Album, the guest's side (v0.128.0): a photo circle for the guests of one trip.
//   - A guest adds photos (shrunk on the phone first, so they are small and quick to send). If there is no connection, they wait on the phone and go later.
//   - Everybody on the trip sees everybody's photos. Staff photos marked as favourites are shown first.
//   - Each guest saves photos to their phone. The server remembers what THIS guest has saved or does not want, so "Download new" only gets what was added since.
//   - A guest can delete their own photos. Everything is erased from the server at the end of the download period (the app says when).
// The photo files are never public: the app asks the server (supabase/functions/album) for a link that expires in an hour.
//
// guest.js hands this file what it needs once (initAlbum), so this file does not import guest.js.

import { shrinkPhoto as shrink } from '../js/albumImage.js';

let d = null; // { h, callRpc, currentToken, store, SUPABASE_URL, SUPABASE_ANON_KEY, repaint, modal, plainHead, firstName }
export function initAlbum(deps) { d = deps; }

const NOTICE_KEY = 'tourdocs.guest.album.notice';
const BATCH = 10;               // photos saved per tap (the phone's share sheet takes a handful at a time)
const LONG_SIDE = 2000;         // the longest side of a shared photo, in pixels
const THUMB_SIDE = 420;

let state = null;               // what album_state last said: { settings, photos, marks, guest_id } (or { error })
let urls = { thumb: new Map(), full: new Map() };   // photo id -> link (links last an hour)
let loading = false;
let queueCount = 0;

// ---------- asking the server ----------
async function post(body) {
  const response = await fetch(`${d.SUPABASE_URL}/functions/v1/album`, {
    method: 'POST', headers: { apikey: d.SUPABASE_ANON_KEY, Authorization: `Bearer ${d.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: d.currentToken(), ...body }),
  });
  return response.json();
}

export async function loadAlbum() {
  if (!d.currentToken() || loading) return;
  loading = true;
  try {
    const s = await d.callRpc('album_state', { p_token: d.currentToken() });
    state = s?.ok ? s : { error: s?.error ?? 'link' };
    if (state.ok !== false && s?.ok) await fetchLinks(state.photos.map((p) => p.id), 'thumb');
  } catch { if (!state) state = { error: 'offline' }; }
  loading = false;
  d.repaint();
}

// Links for photos that have none yet, 60 at a time.
async function fetchLinks(ids, size) {
  const known = urls[size];
  const wanted = ids.filter((id) => !known.has(id));
  for (let i = 0; i < wanted.length; i += 60) {
    try { const r = await post({ action: 'urls', ids: wanted.slice(i, i + 60), size }); if (r.ok) for (const [id, url] of Object.entries(r.urls)) known.set(id, url); } catch { /* offline: the grid shows what it has */ }
  }
}

// ---------- the rules the screen follows ----------
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
function phase() {
  const s = state?.settings;
  if (!s?.enabled) return 'off';
  if (s.purged || (s.download_until && todayIso() > s.download_until)) return 'over';
  if (s.upload_until && todayIso() > s.upload_until) return 'download';
  return 'open';
}
const niceDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const photos = () => state?.photos ?? [];
const markOf = (id) => state?.marks?.[id];
const newOnes = () => photos().filter((p) => !markOf(p.id));

// Does the album have something to say (is it on for this guest)?
export function albumAvailable(sheet) { return sheet?.album !== false; }

// ---------- adding photos ----------
// The waiting list for photos that could not be sent (no connection), kept on the phone in IndexedDB (photos are too big for localStorage).
const QUEUE = { db: null,
  open() { return this.db ??= new Promise((resolve, reject) => { const r = indexedDB.open('tourdocs-album', 1); r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'key', autoIncrement: true }); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); },
  async add(item) { const db = await this.open(); return new Promise((resolve, reject) => { const t = db.transaction('queue', 'readwrite'); t.objectStore('queue').add(item); t.oncomplete = resolve; t.onerror = () => reject(t.error); }); },
  async all() { const db = await this.open(); return new Promise((resolve) => { const r = db.transaction('queue').objectStore('queue').getAll(); r.onsuccess = () => resolve(r.result ?? []); r.onerror = () => resolve([]); }); },
  async remove(key) { const db = await this.open(); return new Promise((resolve) => { const t = db.transaction('queue', 'readwrite'); t.objectStore('queue').delete(key); t.oncomplete = resolve; t.onerror = resolve; }); },
};

async function sendOne(item) {
  const form = new FormData();
  form.append('action', 'upload'); form.append('token', d.currentToken()); form.append('author', item.author);
  form.append('w', String(item.width)); form.append('h', String(item.height));
  form.append('file', item.full, 'photo.jpg'); form.append('thumb', item.thumb, 'thumb.jpg');
  const response = await fetch(`${d.SUPABASE_URL}/functions/v1/album`, { method: 'POST', headers: { apikey: d.SUPABASE_ANON_KEY, Authorization: `Bearer ${d.SUPABASE_ANON_KEY}` }, body: form });
  return response.json();
}
const UPLOAD_ERRORS = { link: 'This link is no longer active.', off: 'Our Album is switched off.', closed: 'Our Album is closed: photos can no longer be added.', too_many: 'You have added the most photos allowed.', file: 'This photo could not be used.' };

// Sends what waits on the phone. Stops quietly when there is no connection. Returns { sent, failed: [sentences] }.
export async function sendQueue() {
  const result = { sent: 0, failed: [] };
  for (const item of await QUEUE.all()) {
    try {
      const r = await sendOne(item);
      if (r.ok) { await QUEUE.remove(item.key); result.sent++; }
      else if (r.error === 'storage') break;
      else { await QUEUE.remove(item.key); result.failed.push(UPLOAD_ERRORS[r.error] ?? 'A photo could not be sent.'); }
    } catch { break; } // no connection: the rest waits
  }
  queueCount = (await QUEUE.all()).length;
  if (result.sent) await loadAlbum();
  return result;
}

async function addFiles(files, status) {
  const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
  if (!list.length) { status.textContent = 'Please choose photos.'; return; }
  let done = 0;
  for (const file of list) {
    status.textContent = `Preparing ${done + 1} of ${list.length}…`;
    try {
      const full = await shrink(file, LONG_SIDE, 0.82); const thumb = await shrink(file, THUMB_SIDE, 0.7);
      await QUEUE.add({ author: d.firstName(), width: full.width, height: full.height, full: full.blob, thumb: thumb.blob });
      done++;
    } catch { status.textContent = 'One of the files is not a photo this phone can read.'; }
  }
  status.textContent = 'Sending…';
  const result = await sendQueue();
  queueCount = (await QUEUE.all()).length;
  status.textContent = result.failed[0] ?? (queueCount ? `${queueCount} photo${queueCount === 1 ? '' : 's'} will be sent when you are online again.` : `${result.sent} photo${result.sent === 1 ? '' : 's'} added. Thank you!`);
  d.repaint();
}

// ---------- saving photos to the phone ----------
// A phone only lets an app save photos while a finger is on a button, so it is done in two taps: "Get the photos" (fetches up to 10) then "Save to Photos".
async function fetchBlobs(list, progress) {
  await fetchLinks(list.map((p) => p.id), 'full');
  const files = [];
  for (const [i, p] of list.entries()) {
    progress(i);
    const url = urls.full.get(p.id);
    if (!url) continue;
    const blob = await (await fetch(url)).blob();
    files.push({ id: p.id, file: new File([blob], `${(p.author || 'photo').replace(/[^\w-]+/g, '_')}-${p.id.slice(0, 6)}.jpg`, { type: 'image/jpeg' }) });
  }
  return files;
}
async function mark(ids, newState) {
  try { await d.callRpc('album_mark', { p_token: d.currentToken(), p_ids: ids, p_state: newState }); } catch { /* offline: kept below */ }
  for (const id of ids) { if (newState === 'new') delete state.marks[id]; else state.marks[id] = newState; }
}

function saveSheet(list, title) {
  const batch = list.slice(0, BATCH);
  const message = d.h('p', { class: 'muted' }, `${list.length} photo${list.length === 1 ? '' : 's'} to save${list.length > BATCH ? `, ${BATCH} at a time` : ''}.`);
  const get = d.h('button', { class: 'btn-link', type: 'button' }, `Get ${batch.length} photo${batch.length === 1 ? '' : 's'}`);
  const overlay = d.modal(title, [message], [get, d.h('button', { class: 'plain-link', type: 'button', onclick: () => { overlay.remove(); d.repaint(); } }, 'Close')]);
  let ready = null;
  get.addEventListener('click', async () => {
    if (ready) { await saveReady(); return; }
    get.disabled = true;
    try {
      ready = await fetchBlobs(batch, (i) => { get.textContent = `Getting ${i + 1} of ${batch.length}…`; });
      if (!ready.length) throw new Error('none');
      get.disabled = false; get.textContent = 'Save to Photos'; message.textContent = 'Ready. Tap "Save to Photos", then choose "Save Image" (iPhone) or your gallery (Android).';
    } catch { get.disabled = false; get.textContent = `Get ${batch.length} photos`; message.textContent = 'The photos could not be fetched. Check your connection and try again.'; }
  });
  async function saveReady() {
    const files = ready.map((r) => r.file);
    try {
      if (navigator.canShare?.({ files })) await navigator.share({ files });
      else { for (const f of files) { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); } }
    } catch (e) { if (e?.name === 'AbortError') { message.textContent = 'Not saved. Tap "Save to Photos" to try again.'; return; } }
    await mark(ready.map((r) => r.id), 'downloaded');
    const left = newOnes().length;
    overlay.remove(); d.repaint();
    if (left > 0) saveSheet(newOnes(), 'Save the next photos');
  }
}

// ---------- the pages ----------
function privacyNotice(then) {
  if (d.store.get(NOTICE_KEY)) { then(); return; }
  const overlay = d.modal('Before you add photos', [d.h('p', {}, 'Photos you add are shared with everyone on this trip (guests and staff). Please only add photos you are happy to share, and ask people before sharing close-ups of them, especially children.'), d.h('p', { class: 'muted' }, 'You can delete your own photos at any time.')],
    [d.h('button', { class: 'btn-link', type: 'button', onclick: () => { d.store.set(NOTICE_KEY, '1'); overlay.remove(); then(); } }, 'OK, I understand'), d.h('button', { class: 'plain-link', type: 'button', onclick: () => overlay.remove() }, 'Cancel')]);
}

function viewer(photo) {
  const img = d.h('img', { class: 'album-big', alt: photo.caption || `Photo by ${photo.author}`, src: urls.thumb.get(photo.id) ?? '' });
  fetchLinks([photo.id], 'full').then(() => { const url = urls.full.get(photo.id); if (url) img.src = url; });
  const buttons = [d.h('button', { class: 'btn-link', type: 'button', onclick: () => { overlay.remove(); saveSheet([photo], 'Save this photo'); } }, 'Save this photo')];
  if (markOf(photo.id) !== 'skipped') buttons.push(d.h('button', { class: 'plain-link', type: 'button', onclick: async () => { await mark([photo.id], 'skipped'); overlay.remove(); d.repaint(); } }, 'Not for me'));
  else buttons.push(d.h('button', { class: 'plain-link', type: 'button', onclick: async () => { await mark([photo.id], 'new'); delete state.marks[photo.id]; overlay.remove(); d.repaint(); } }, 'Bring it back'));
  if (photo.mine) buttons.push(d.h('button', { class: 'plain-link', type: 'button', onclick: async () => {
    if (!confirm('Delete this photo for everyone?')) return;
    const r = await post({ action: 'delete', id: photo.id }).catch(() => ({ ok: false }));
    if (r.ok) { state.photos = state.photos.filter((p) => p.id !== photo.id); overlay.remove(); d.repaint(); }
  } }, 'Delete'));
  buttons.push(d.h('button', { class: 'plain-link', type: 'button', onclick: () => overlay.remove() }, 'Close'));
  const overlay = d.modal(`${photo.pinned ? '★ ' : ''}${photo.author || 'Photo'}`, [img], buttons);
}

function tile(photo) {
  const mark = markOf(photo.id);
  const url = urls.thumb.get(photo.id);
  return d.h('button', { class: `album-tile${mark === 'downloaded' ? ' is-saved' : ''}${mark === 'skipped' ? ' is-skipped' : ''}`, type: 'button', 'aria-label': `Photo by ${photo.author || 'a guest'}`, onclick: () => viewer(photo) },
    url ? d.h('img', { src: url, alt: '', loading: 'lazy' }) : d.h('span', { class: 'album-wait' }),
    photo.pinned ? d.h('i', { class: 'album-pin', 'aria-hidden': 'true' }, '★') : null);
}

// The Album page: header, what the album allows today, the buttons, then the grid.
export function albumView(sheet, offline, { backButton } = {}) {
  if (!state && !loading) loadAlbum();
  QUEUE.all().then((q) => { if (q.length !== queueCount) { queueCount = q.length; } }).catch(() => {});
  const p = phase();
  const settings = state?.settings ?? {};
  const body = d.h('div', { class: 'atl-body album' }, offline);

  if (!state) { body.append(d.h('p', { class: 'foot' }, 'Loading…')); return [header(sheet, backButton), body]; }
  if (state.error === 'offline') { body.append(d.h('p', { class: 'foot' }, 'No connection. Our Album needs the internet to show photos.')); return [header(sheet, backButton), body]; }
  if (state.error) { body.append(d.h('p', { class: 'foot' }, 'Our Album is not available with this link.')); return [header(sheet, backButton), body]; }
  if (p === 'off') { body.append(d.h('p', { class: 'foot' }, 'Our Album is not switched on for this trip.')); return [header(sheet, backButton), body]; }
  if (p === 'over') { body.append(d.h('p', { class: 'foot' }, 'The download period is over: the photos have been erased from the server. Thank you for sharing this trip.')); return [header(sheet, backButton), body]; }

  const status = d.h('p', { class: 'muted album-status', role: 'status' });
  const input = d.h('input', { type: 'file', accept: 'image/*', multiple: '', hidden: '' });
  input.addEventListener('change', () => { if (input.files.length) addFiles(input.files, status); input.value = ''; });

  // What the album allows now, in plain words.
  const notes = [];
  if (p === 'open' && settings.upload_until) notes.push(`You can add photos until ${niceDate(settings.upload_until)}.`);
  if (p === 'download') notes.push('Adding photos is closed. Please save everything you want to your phone.');
  if (settings.download_until) notes.push(`Photos stay available until ${niceDate(settings.download_until)}, then they are erased.`);
  body.append(d.h('p', { class: 'muted' }, notes.join(' ')));

  const actions = d.h('div', { class: 'album-actions' });
  if (p === 'open') actions.append(d.h('button', { class: 'btn-link', type: 'button', onclick: () => privacyNotice(() => input.click()) }, 'Add photos'));
  const fresh = newOnes();
  actions.append(
    d.h('button', { class: 'btn-link', type: 'button', disabled: fresh.length ? null : '', onclick: () => saveSheet(fresh, 'Download new photos') }, fresh.length ? `Download new (${fresh.length})` : 'Nothing new'),
    d.h('button', { class: 'plain-link', type: 'button', disabled: photos().length ? null : '', onclick: () => saveSheet(photos(), 'Download all photos') }, 'Download all'));
  body.append(actions, input, status);
  if (queueCount) body.append(d.h('p', { class: 'muted' }, `${queueCount} photo${queueCount === 1 ? '' : 's'} waiting to be sent.`, ' ', d.h('button', { class: 'link-btn', type: 'button', onclick: async () => { status.textContent = 'Sending…'; const r = await sendQueue(); status.textContent = r.sent ? `${r.sent} sent.` : 'Still no connection.'; d.repaint(); } }, 'Send now')));

  const list = photos();
  const pinned = list.filter((x) => x.pinned);
  if (pinned.length) body.append(d.h('div', { class: 'block-title' }, 'Favourites'), d.h('div', { class: 'album-grid' }, pinned.map(tile)));
  body.append(d.h('div', { class: 'block-title' }, `All photos (${list.length})`),
    list.length ? d.h('div', { class: 'album-grid' }, list.map(tile)) : d.h('p', { class: 'muted' }, p === 'open' ? 'No photos yet. Be the first to add one!' : 'No photos were added.'));
  return [header(sheet, backButton), body];
}
function header(sheet, backButton) {
  return backButton ? d.plainHead(sheet.trip, 'Our Album') : d.h('div', { class: 'atl-head' }, d.h('small', {}, sheet.trip), d.h('h1', {}, 'Our Album'));
}

// A kept note for the Today page / the farewell: how many photos are new to this guest (null when nothing to say).
export function albumNewCount() { return state?.ok ? newOnes().length : 0; }
