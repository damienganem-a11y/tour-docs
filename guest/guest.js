// The guest app ("My programme"): shows ONE guest's own programme, read from a personal link (Phase 5, SPEC.md "Guest links").
//
// How it works, in plain words:
//   1. The link is  <address>/guest/#<secret>. The secret is remembered on this phone, so the app opens without the link once it is
//      installed on the Home Screen.
//   2. The app asks the server one question: get_guest_sheet(secret). It gets back that guest's sheet (see js/guestSheet.js) or nothing.
//   3. The last sheet received is kept on the phone: with no internet the programme is still there (a plane, a hotel with no wifi).
//   4. If the server says the link is switched off or wrong, the kept copy is erased too.
// The sheet also holds the trip's tours (name, time, duration, difficulty, description, photos, how full): the "Tours" tab and each tour's own page.
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
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); // onclick -> "click"
    else el.setAttribute(k, v);
  }
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

// "Next up": the first thing still to come (an activity or a dinner), so the guest sees at once where to be next. The clock time of a
// part is its start time, or a usual hour for its half-day; it is read in the phone's own clock (a guest on the trip is in the place).
const USUAL_HOUR = { Morning: '09:00', Afternoon: '14:00', Evening: '19:00' };
function nextUp(sheet, now = new Date()) {
  for (const day of sheet.days) {
    for (const part of day.parts) {
      if (part.kind !== 'activity' && part.kind !== 'dinner') continue;
      if (part.kind === 'activity' && part.cancelled) continue;
      const clock = part.time || (part.kind === 'dinner' ? part.seating : null) || USUAL_HOUR[part.half] || '12:00';
      const start = new Date(`${day.date}T${/^\d\d:\d\d$/.test(clock) ? clock : '12:00'}:00`);
      if (start.getTime() >= now.getTime() - 60 * 60000) return { day, part, clock };
    }
  }
  return null;
}

// On an iPhone, in Safari (not yet on the Home Screen), a short hint on how to keep the app. Dismissed for good with the button.
function installHint() {
  const iphone = /iphone|ipad/i.test(navigator.userAgent);
  const installed = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (!iphone || installed || store.get('tourdocs.guest.hintDone')) return null;
  return h('div', { class: 'banner' }, 'To keep this on your phone: tap the Share button, then "Add to Home Screen". ',
    h('button', { class: 'link', type: 'button', onclick: (e) => { store.set('tourdocs.guest.hintDone', '1'); e.target.parentNode.remove(); } }, 'OK'));
}

// ---------- tours: words and small pieces ----------
const DIFFICULTY = {
  easy: { label: 'Easy', help: 'Suitable for most people: little walking, no steep parts.' },
  moderate: { label: 'Moderate', help: 'Some walking, stairs or uneven ground. A normal level of fitness is enough.' },
  demanding: { label: 'Demanding', help: 'A real effort: long distance, steep climbs or demanding conditions. Good fitness is needed.' },
};
const AVAILABILITY = { available: 'Available', limited: 'Limited availability', waitlist: 'Waitlist' };

const chip = (text, cls = '') => h('span', { class: `chip ${cls}`.trim() }, text);
const availabilityChip = (tour) => (tour.mine ? chip('You are booked', 'chip--mine') : chip(AVAILABILITY[tour.availability] ?? '', `chip--${tour.availability}`));

// The difficulty chip with its small "i" button: tapping it opens a short text (what the level means, then the leader's own details).
function difficultyBlock(info) {
  if (!info?.difficulty) return null;
  const level = DIFFICULTY[info.difficulty];
  const panel = h('div', { class: 'diff-panel', hidden: '' }, h('div', { class: 'diff-help' }, level.help), info.difficultyNote ? h('div', {}, info.difficultyNote) : null);
  const button = h('button', { class: 'info-btn', type: 'button', 'aria-label': `About the ${level.label} level`, 'aria-expanded': 'false' }, 'i');
  button.addEventListener('click', () => { const open = panel.hasAttribute('hidden'); panel.toggleAttribute('hidden', !open); button.setAttribute('aria-expanded', String(open)); });
  return { chip: h('span', { class: `chip chip--${info.difficulty}` }, level.label, button), panel };
}

// ---------- the programme ----------
function partView(part, sheet) {
  const lines = [];
  let cls = 'part';
  if (part.kind === 'activity') {
    lines.push(h('div', { class: 'what' }, part.name));
    const when = [part.time ? `Starts ${part.time}` : null, part.meeting ? `Meet: ${part.meeting}` : null].filter(Boolean);
    if (when.length) lines.push(h('div', { class: 'line' }, when.join(' · ')));
    const tour = part.tour >= 0 ? sheet.tours?.[part.tour] : null;
    if (tour?.info?.duration) lines.push(h('div', { class: 'line' }, tour.info.duration));
    if (part.cancelled) lines.push(h('span', { class: 'tag warn' }, 'Cancelled: your leader will tell you what happens instead'));
    if (tour) { cls += ' part--tap'; lines.push(h('div', { class: 'more' }, 'Details ›')); }
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
  const node = h('div', { class: cls }, h('div', { class: 'half' }, part.half), lines);
  if (cls.includes('part--tap')) { node.setAttribute('role', 'button'); node.tabIndex = 0; node.addEventListener('click', () => openTour(part.tour)); }
  return node;
}

function programmeView(sheet) {
  const today = localToday();
  return [
    (() => {
      const next = nextUp(sheet);
      if (!next) return null;
      const what = next.part.kind === 'dinner' ? `Dinner at ${next.part.restaurant}` : next.part.name;
      const detail = next.part.kind === 'dinner' ? `Table for ${next.part.seating}` : [next.part.time ? `Starts ${next.part.time}` : null, next.part.meeting ? `Meet: ${next.part.meeting}` : null].filter(Boolean).join(' · ');
      return h('div', { class: 'next' }, h('div', { class: 'half' }, `Next up · ${dayDate(next.day.date)} · ${next.part.half}`), h('div', { class: 'what' }, what), detail ? h('div', { class: 'line' }, detail) : null);
    })(),
    ...sheet.days.map((day) => h('section', { class: `day${day.date === today ? ' today' : ''}`, id: `d-${day.date}` },
      h('div', { class: 'day-head' },
        h('div', { class: 'day-title' }, `Day ${day.day} · ${day.destination}`, day.date === today ? h('span', { class: 'today-tag' }, 'TODAY') : null),
        h('div', { class: 'day-date' }, dayDate(day.date))),
      day.parts.map((p) => partView(p, sheet)))),
  ];
}

// ---------- the Tours tab ----------
function toursView(sheet) {
  const tours = sheet.tours ?? [];
  if (tours.length === 0) return [h('p', { class: 'muted' }, 'No tours to show yet.')];
  const groups = [];
  tours.forEach((tour, index) => {
    const key = `${tour.day}|${tour.destination}|${tour.half}`;
    let group = groups.find((g) => g.key === key);
    if (!group) { group = { key, tour, items: [] }; groups.push(group); }
    group.items.push({ tour, index });
  });
  return groups.map((group) => h('section', { class: 'tour-group' },
    h('div', { class: 'tour-group-head' }, `Day ${group.tour.day} · ${group.tour.half} · ${group.tour.destination}`, h('span', { class: 'day-date' }, dayDate(group.tour.date))),
    group.items.map(({ tour, index }) => {
      const photo = tour.info?.photos?.[0];
      const card = h('div', { class: 'tour-card', role: 'button', tabindex: '0' },
        h('div', { class: 'tour-card-text' },
          h('div', { class: 'what' }, tour.name),
          h('div', { class: 'chips' }, tour.info?.duration ? chip(tour.info.duration) : null, tour.info?.difficulty ? chip(DIFFICULTY[tour.info.difficulty].label, `chip--${tour.info.difficulty}`) : null, availabilityChip(tour))),
        photo ? h('img', { class: 'thumb', src: photo.url, alt: '', loading: 'lazy' }) : null);
      card.addEventListener('click', () => openTour(index));
      return card;
    })));
}

// ---------- one tour ----------
function tourView(sheet, tour) {
  const info = tour.info ?? {};
  const difficulty = difficultyBlock(info);
  const gallery = info.photos?.length
    ? h('div', { class: 'gallery' }, info.photos.map((p) => h('figure', { class: 'shot' }, h('img', { src: p.url, alt: p.caption || tour.name, loading: 'lazy' }), p.caption ? h('figcaption', {}, p.caption) : null)))
    : null;
  const section = (title, text) => (text ? h('div', { class: 'info-block' }, h('div', { class: 'half' }, title), h('div', {}, text)) : null);
  return [
    h('button', { class: 'back', type: 'button', onclick: () => history.back() }, '‹ Back'),
    gallery,
    h('h1', {}, tour.name),
    h('div', { class: 'line' }, `${dayDate(tour.date)} · ${tour.half} · ${tour.destination}`),
    h('div', { class: 'chips big' }, info.duration ? chip(info.duration) : null, difficulty?.chip ?? null, availabilityChip(tour)),
    difficulty?.panel ?? null,
    section('When and where', [tour.time ? `Starts ${tour.time}` : null, tour.meeting ? `Meet: ${tour.meeting}` : null].filter(Boolean).join(' · ')),
    section('What happens', info.description),
    section('Included', info.included),
    section('What to bring', info.bring),
  ].filter(Boolean);
}

// ---------- which screen is shown ----------
// view: { tab: 'programme' | 'tours' } or { tour: index }. The tour page is a step in the phone's history, so the back gesture returns to the list.
let view = { tab: 'programme' };
let lastTab = 'programme'; // the tab to return to from a tour page
let currentSheet = null;
let currentOffline = false;

function openTour(index) { lastTab = view.tab ?? lastTab; history.pushState({ tour: index }, ''); view = { tour: index }; paint(); window.scrollTo(0, 0); }
window.addEventListener('popstate', (event) => { view = event.state?.tour !== undefined ? { tour: event.state.tour } : { tab: lastTab }; if (currentSheet) paint(); });

function tabs() {
  const tab = (id, label) => h('button', { class: `tab${view.tab === id ? ' is-on' : ''}`, type: 'button', onclick: () => { view = { tab: id }; paint(); window.scrollTo(0, 0); } }, label);
  return h('nav', { class: 'tabs' }, tab('programme', 'My programme'), tab('tours', 'Tours'));
}

function paint() {
  const sheet = currentSheet;
  if (!sheet) return;
  document.documentElement.style.setProperty('--brand', /^#[0-9a-f]{6}$/i.test(sheet.accent) ? sheet.accent : '#1d5c57');
  document.title = sheet.trip;
  const tour = view.tour !== undefined ? sheet.tours?.[view.tour] : null;
  if (view.tour !== undefined && !tour) { view = { tab: 'programme' }; }
  const head = [
    sheet.company ? h('div', { class: 'company' }, sheet.company) : null,
    h('h1', {}, tour ? sheet.trip : `Hello ${sheet.first}`),
    tour ? null : h('p', { class: 'sub' }, sheet.trip),
  ];
  const offline = currentOffline ? h('div', { class: 'banner' }, `No internet right now. Showing what was last received (${updatedText(sheet.updatedAt)}).`) : null;
  const body = tour ? tourView(sheet, tour) : [tabs(), installHint(), offline, ...(view.tab === 'tours' ? toursView(sheet) : programmeView(sheet)), h('p', { class: 'foot' }, `Updated ${updatedText(sheet.updatedAt)}`)];
  app.replaceChildren(...(tour ? [offline, ...body] : [...head, ...body]).filter(Boolean));
}

function render(sheet, { offline = false } = {}) {
  if (currentSheet && offline === currentOffline && JSON.stringify(sheet) === JSON.stringify(currentSheet) && app.children.length > 0 && !app.querySelector('.problem')) return; // nothing new: do not redraw (it would close an open panel)
  currentSheet = sheet;
  currentOffline = offline;
  paint();
  // Keep the pictures for offline use: asking for them once lets the service worker keep them.
  for (const tour of (sheet.tours ?? []).slice(0, 40)) for (const p of tour.info?.photos ?? []) fetch(p.url).catch(() => {});
}

function showProblem(title, text) {
  currentSheet = null;
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
