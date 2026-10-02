// The guest app ("My programme"): shows ONE guest's own programme, read from a personal link (Phase 5, SPEC.md "Guest links").
//
// How it works, in plain words:
//   1. The link is  <address>/guest/#<secret>. The secret is remembered on this phone, so the app opens without the link once it is
//      installed on the Home Screen.
//   2. The app asks the server one question: get_guest_sheet(secret). It gets back that guest's sheet (see js/guestSheet.js) or nothing.
//   3. The last sheet received is kept on the phone: with no internet the programme is still there (a plane, a hotel with no wifi).
//   4. If the server says the link is switched off or wrong, the kept copy is erased too.
// The app can read nothing else: no trip, no other guest. Read only.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/supabase-config.js';

const TOKEN_KEY = 'tourdocs.guest.token';
const SHEET_KEY = 'tourdocs.guest.sheet';
const SUPPORTED_SHEET = 1;      // the sheet format this app understands (js/guestSheet.js SHEET_VERSION)
const REFRESH_EVERY = 60000;    // while the app is open and visible, look for news every minute

const app = document.getElementById('app');

// ---------- small helpers ----------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) { if (k === 'class') el.className = v; else el.setAttribute(k, v); }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode: works without */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* nothing to do */ } },
};

// The secret: from the link if there is one, else the one remembered. A link replaces what was remembered.
function currentToken() {
  const fromLink = window.location.hash.replace(/^#/, '').trim();
  if (/^[A-Za-z0-9_-]{16,64}$/.test(fromLink)) {
    if (fromLink !== store.get(TOKEN_KEY)) { store.set(TOKEN_KEY, fromLink); store.remove(SHEET_KEY); }
    return fromLink;
  }
  return store.get(TOKEN_KEY);
}

// ---------- asking the server ----------
// Returns { sheet } (a sheet), { off: true } (the server says: no such active link) or { offline: true } (could not reach it).
async function fetchSheet(token) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_guest_sheet`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    });
    if (!response.ok) return { offline: true };
    const data = await response.json();
    if (data && typeof data === 'object' && data.v === SUPPORTED_SHEET && Array.isArray(data.days)) return { sheet: data };
    return data && data.v !== undefined && data.v !== SUPPORTED_SHEET ? { tooNew: true } : { off: true };
  } catch { return { offline: true }; }
}

// ---------- showing ----------
const MONTHS_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayDate = (iso) => MONTHS_DAY.format(new Date(`${iso}T00:00:00Z`));
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const updatedText = (iso) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

function partView(part) {
  const lines = [];
  let cls = 'part';
  if (part.kind === 'activity') {
    lines.push(h('div', { class: 'what' }, part.name));
    const when = [part.time ? `Starts ${part.time}` : null, part.meeting ? `Meet: ${part.meeting}` : null].filter(Boolean);
    if (when.length) lines.push(h('div', { class: 'line' }, when.join(' · ')));
    if (part.cancelled) lines.push(h('span', { class: 'tag warn' }, 'Cancelled: your leader will tell you what happens instead'));
  } else if (part.kind === 'leisure') {
    cls += ' leisure';
    lines.push(h('div', { class: 'what' }, 'At leisure'));
  } else if (part.kind === 'dinner') {
    lines.push(h('div', { class: 'what' }, `Dinner at ${part.restaurant}`));
    lines.push(h('div', { class: 'line' }, `Table for ${part.seating}${part.with?.length ? ` · with ${part.with.join(', ')}` : ''}`));
    lines.push(h('span', { class: part.confirmed ? 'tag' : 'tag warn' }, part.confirmed ? 'Confirmed' : 'Being confirmed'));
  } else if (part.kind === 'waitlist') {
    lines.push(h('div', { class: 'what' }, part.name));
    lines.push(h('span', { class: 'tag warn' }, 'On the waiting list'));
  } else {
    cls += ' leisure';
    lines.push(h('div', { class: 'what' }, 'To be confirmed'));
  }
  return h('div', { class: cls }, h('div', { class: 'half' }, part.half), lines);
}

function render(sheet, { offline = false } = {}) {
  document.documentElement.style.setProperty('--brand', /^#[0-9a-f]{6}$/i.test(sheet.accent) ? sheet.accent : '#1d5c57');
  document.title = sheet.trip;
  const today = localToday();
  const view = [
    sheet.company ? h('div', { class: 'company' }, sheet.company) : null,
    h('h1', {}, `Hello ${sheet.first}`),
    h('p', { class: 'sub' }, `Your programme for ${sheet.trip}`),
    offline ? h('div', { class: 'banner' }, `No internet right now. Showing what was last received (${updatedText(sheet.updatedAt)}).`) : null,
    ...sheet.days.map((day) => h('section', { class: `day${day.date === today ? ' today' : ''}`, id: `d-${day.date}` },
      h('div', { class: 'day-head' },
        h('div', { class: 'day-title' }, `Day ${day.day} · ${day.destination}`, day.date === today ? h('span', { class: 'today-tag' }, 'TODAY') : null),
        h('div', { class: 'day-date' }, dayDate(day.date))),
      day.parts.map(partView))),
    h('p', { class: 'foot' }, `Updated ${updatedText(sheet.updatedAt)}`),
  ];
  app.replaceChildren(...view.filter(Boolean));
}

function showProblem(title, text) {
  app.replaceChildren(h('div', { class: 'problem' }, h('h1', {}, title), h('p', { class: 'muted' }, text)));
}

// ---------- running ----------
let scrolledToToday = false;
async function refresh() {
  const token = currentToken();
  if (!token) { showProblem('No link yet', 'Open the personal link your tour leader sent you. After that, this app opens straight on your programme.'); return; }
  const kept = (() => { try { return JSON.parse(store.get(SHEET_KEY)); } catch { return null; } })();
  if (kept && kept.v === SUPPORTED_SHEET && !app.querySelector('.day')) render(kept, { offline: !navigator.onLine });
  const result = await fetchSheet(token);
  if (result.sheet) {
    store.set(SHEET_KEY, JSON.stringify(result.sheet));
    render(result.sheet);
  } else if (result.off) {
    store.remove(SHEET_KEY);
    showProblem('This link is not active', 'Ask your tour leader for a new link.');
  } else if (result.tooNew) {
    showProblem('Please update', 'Close this app and open it again with internet to get the latest version.');
  } else if (kept && kept.v === SUPPORTED_SHEET) {
    render(kept, { offline: true });
  } else {
    showProblem('No connection', 'Connect to the internet once to receive your programme. After that it works without.');
  }
  if (!scrolledToToday) {
    const today = document.getElementById(`d-${localToday()}`);
    if (today) { today.scrollIntoView(); scrolledToToday = true; }
  }
}

refresh();
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_EVERY);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('online', refresh);
window.addEventListener('hashchange', () => { scrolledToToday = false; refresh(); });

// Offline: the service worker keeps the app's own files on the phone.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
