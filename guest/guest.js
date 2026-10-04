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
import { passportState, stampSvg, dayIn, wallToInstant } from './passport.js';
import { urlBase64ToUint8Array, subscriptionFields, pushCapability } from '../js/pushUtil.js';

const TOKEN_KEY = 'tourdocs.guest.token';
const SHEET_KEY = 'tourdocs.guest.sheet';
const SUPPORTED_SHEET = 1;      // the sheet format this app understands (js/guestSheet.js SHEET_VERSION)
const REFRESH_EVERY = 60000;    // while the app is open and visible, look for news every minute

const app = document.getElementById('app');

// ---------- small helpers ----------
// A picture that can fail to load (an old sheet pointing at a picture that has since moved, no connection and never cached): instead of the
// browser's broken-picture symbol, a soft empty block of the same size.
function picture(url, className, alt) {
  const img = document.createElement('img');
  if (className) img.className = className;
  img.alt = alt ?? '';
  img.loading = 'lazy';
  img.addEventListener('error', () => { const block = document.createElement('div'); block.className = `${className ?? ''} picture-missing`.trim(); img.replaceWith(block); });
  img.src = url;
  return img;
}

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

// iPhone/iPad: an app put on the Home Screen has its own memory, empty at first, and it opens the manifest's start address (without the secret).
// Without a manifest, iOS puts the CURRENT address (with the secret after the #) on the Home Screen, so the app opens straight on the programme.
// Android keeps one shared memory between browser and app, so it keeps the manifest.
if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
  document.querySelector('link[rel="manifest"]')?.remove();
}

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
let simulatedDate = null; // owner's preview only: "pretend today is..." (set from the sheet's previewDate)
const localToday = () => { if (simulatedDate) return simulatedDate; const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// "Today" in a given destination, in THAT place's own time zone (not the phone's clock): the same rule as the passport. A guest who has just crossed
// the date line, or lands late at night, then sees the same day everywhere in the app.
const zoneOf = (sheet, destinationName) => sheet.destinations?.find((d) => d.name === destinationName)?.tz || null;
const todayAt = (sheet, destinationName) => (simulatedDate ? simulatedDate : (zoneOf(sheet, destinationName) ? dayIn(zoneOf(sheet, destinationName), new Date()) : localToday()));
const updatedText = (iso) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

// "Next up": the first thing still to come (an activity or a dinner), so the guest sees at once where to be next. The clock time of a
// part is its start time, or a usual hour for its half-day; it is read in the phone's own clock (a guest on the trip is in the place).
const USUAL_HOUR = { 'Full day': '08:00', Morning: '09:00', Afternoon: '14:00', Evening: '19:00' };
function nextUp(sheet, now = simulatedDate ? new Date(`${simulatedDate}T07:00:00`) : new Date()) {
  for (const day of sheet.days) {
    for (const part of day.parts) {
      if (part.kind !== 'activity' && part.kind !== 'dinner') continue;
      if (part.kind === 'activity' && part.cancelled) continue;
      const clock = part.time || (part.kind === 'dinner' ? part.seating : null) || USUAL_HOUR[part.half] || '12:00';
      const wall = /^\d\d:\d\d$/.test(clock) ? clock : '12:00';
      // The part's start is read in its destination's own time zone, and compared with the real moment (when pretending, in plain wall time).
      const zone = zoneOf(sheet, day.destination);
      const start = !simulatedDate && zone ? wallToInstant(day.date, wall, zone) : new Date(`${day.date}T${wall}:00`);
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

const chip = (text, cls = '') => h('span', { class: `chip ${cls}`.trim() }, text);

// The difficulty chip with its small "i" button: tapping it opens a short text (what the level means, then the leader's own details).

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
    if (part.alt?.length) {
      const other = h('button', { class: 'other-btn', type: 'button' }, `Other options (${part.alt.length})`);
      other.addEventListener('click', (event) => { event.stopPropagation(); openOptions(part.tour); });
      lines.push(other);
    }
  } else if (part.kind === 'leisure') {
    cls += ' leisure';
    lines.push(h('div', { class: 'what' }, 'At leisure'));
  } else if (part.kind === 'dinner') {
    lines.push(h('div', { class: 'what' }, `Dinner at ${part.restaurant}`));
    lines.push(h('div', { class: 'line' }, `Table for ${part.seating}${part.with?.length ? ` · with ${part.with.join(', ')}` : ''}`));
    lines.push(h('span', { class: part.confirmed ? 'tag' : 'tag warn' }, part.confirmed ? 'Confirmed' : 'Being confirmed'));
    if (part.rest >= 0) { cls += ' part--tap'; lines.push(h('div', { class: 'more' }, 'Restaurant and menu ›')); }
  } else if (part.kind === 'waitlist') {
    lines.push(h('div', { class: 'what' }, part.name));
    lines.push(h('span', { class: 'tag warn' }, 'On the waiting list'));
  } else {
    cls += ' leisure';
    lines.push(h('div', { class: 'what' }, 'To be confirmed'));
  }
  const node = h('div', { class: cls }, h('div', { class: 'half' }, part.half), lines);
  if (cls.includes('part--tap')) { node.setAttribute('role', 'button'); node.tabIndex = 0; node.addEventListener('click', () => (part.kind === 'dinner' ? openRestaurant(part.rest) : openTour(part.tour))); }
  return node;
}

// ---------- the Today tab (Atlas look): a big photo of the place that fades into the page, the "Next up" bar, and today's cards ----------
// Which day the Today tab shows: today (each day is judged in its own destination's time zone); before the trip, its first day; after it, its last.
function dayShown(sheet) {
  const days = sheet.days;
  const isToday = (d) => d.date === todayAt(sheet, d.destination);
  const here = days.find(isToday);
  if (here) return { day: here, label: 'Today' };
  const first = days[0]; const last = days[days.length - 1];
  if (todayAt(sheet, first.destination) < first.date) return { day: first, label: `Starts ${dayDate(first.date)}` };
  if (todayAt(sheet, last.destination) > last.date) return { day: last, label: 'Trip complete' };
  const passed = days.filter((d) => d.date < todayAt(sheet, d.destination)).pop() ?? first; // a travel day with no programme line
  return { day: passed, label: 'In between' };
}

// The "Next up" bar: what is coming and when. Tap it to open the tour or the restaurant.
function nextBar(sheet) {
  const next = nextUp(sheet);
  if (!next) return null;
  const part = next.part;
  const what = part.kind === 'dinner' ? `Dinner at ${part.restaurant}` : part.name;
  const detail = [dayDate(next.day.date), part.half].join(' · ');
  const bar = h('div', { class: 'atl-next' },
    h('div', { class: 'atl-next-text' }, h('small', {}, `Next up · ${detail}`), h('b', {}, what)),
    next.clock ? h('div', { class: 'atl-next-time' }, next.clock) : null);
  const target = part.kind === 'dinner' ? part.rest : part.tour;
  if (target !== undefined && target >= 0) { bar.setAttribute('role', 'button'); bar.tabIndex = 0; bar.addEventListener('click', () => (part.kind === 'dinner' ? openRestaurant(part.rest) : openTour(part.tour))); }
  return bar;
}

function todayView(sheet, offline) {
  const { day, label } = dayShown(sheet);
  const last = sheet.days[sheet.days.length - 1];
  const place = sheet.destinations?.find((d) => d.name === day.destination);
  const next = nextUp(sheet);
  // The picture: the place where the guest is; failing that, the next tour's picture, then the first destination's.
  const art = (place?.photo ? { url: place.photo } : null)
    ?? (next && next.part.kind === 'activity' && next.part.tour >= 0 ? sheet.tours?.[next.part.tour]?.info?.photos?.[0] : null)
    ?? (sheet.destinations?.[0]?.photo ? { url: sheet.destinations[0].photo } : null);
  const initial = (sheet.first || '?').trim().charAt(0).toUpperCase();
  const hero = h('header', { class: `atl-hero${art ? '' : ' atl-hero--plain'}` },
    art ? picture(art.url, 'atl-hero-art', '') : null,
    h('div', { class: 'atl-bar' }, h('span', {}, sheet.company || sheet.trip), h('span', { class: 'atl-dot', title: `Hello ${sheet.first}` }, initial)));
  const title = h('div', { class: 'atl-title' },
    h('span', { class: 'atl-pill' }, label),
    h('h1', {}, day.destination),
    h('p', {}, `Day ${day.day} of ${last.day} · ${dayDate(day.date)}`));
  const parts = day.parts.map((p) => partView(p, sheet));
  return [hero, title, h('div', { class: 'atl-body' }, nextBar(sheet), h('div', { class: 'atl-day' }, parts), notifyRow(), myRequestsBlock(), installHint(), offline, staleNotice(sheet), updatedRow(sheet), creditsLink(sheet))];
}

// The Trip tab: the whole programme, folded by destination.
function tripView(sheet, offline) {
  return [h('div', { class: 'atl-head' }, h('small', {}, sheet.company || sheet.trip), h('h1', {}, 'Trip'), h('p', {}, `${sheet.days.length} days · ${sheet.trip}`)),
    h('div', { class: 'atl-body' }, offline, staleNotice(sheet), ...programmeView(sheet), updatedRow(sheet), creditsLink(sheet))];
}

// The bottom menu: Today, Trip, Passport. A small dot on Passport when a new stamp has arrived.
function tabBar(sheet) {
  const fresh = passportOf(sheet).some((d) => d.given && !isSeen(seenStamps(), d));
  const tab = (key, text) => h('button', { class: `atl-tab${view.tab === key ? ' on' : ''}`, type: 'button', 'aria-current': view.tab === key ? 'page' : null, onclick: () => { if (view.tab !== key) go({ tab: key }); else window.scrollTo({ top: 0, behavior: 'smooth' }); } },
    text, key === 'passport' && fresh ? h('i', { class: 'atl-new', 'aria-label': 'New stamp' }) : null);
  return h('nav', { class: 'atl-tabs', 'aria-label': 'Main menu' }, tab('today', 'Today'), tab('trip', 'Trip'), tab('passport', 'Passport'));
}

// The programme is folded by destination: tap Lisbon to open its days. Consecutive days in the same place form one group. Everything starts
// closed (the "Next up" card at the top already says what is coming); each group opens and closes freely, and what the guest opens stays open.
const openGroups = new Set();
function destinationGroups(sheet) {
  const groups = [];
  for (const day of sheet.days) {
    const last = groups[groups.length - 1];
    if (last && last.destination === day.destination) last.days.push(day);
    else groups.push({ destination: day.destination, days: [day], key: `${groups.length}|${day.destination}` });
  }
  return groups;
}
function dayRange(group) {
  const first = group.days[0]; const last = group.days[group.days.length - 1];
  return first.day === last.day ? `Day ${first.day}` : `Day ${first.day}–${last.day}`;
}

function programmeView(sheet) {
  const groups = destinationGroups(sheet);
  return groups.map((group) => {
    const open = openGroups.has(group.key);
    const photo = sheet.destinations?.find((d) => d.name === group.destination)?.photo;
    const head = h('button', { class: 'dest-head', type: 'button', 'aria-expanded': String(open) },
      photo ? picture(photo, 'dest-photo', '') : null,
      h('div', { class: 'dest-label' }, h('div', { class: 'dest-name' }, group.destination), h('div', { class: 'dest-sub' }, `${dayRange(group)} · ${dayDate(group.days[0].date)}${group.days.length > 1 ? ` – ${dayDate(group.days[group.days.length - 1].date)}` : ''}`)),
      h('span', { class: 'dest-chev' }, open ? '–' : '+'));
    head.addEventListener('click', () => { if (openGroups.has(group.key)) openGroups.delete(group.key); else openGroups.add(group.key); paint(); });
    const dining = (sheet.restaurants ?? []).filter((r) => r.destination === group.destination);
    const eat = open && dining.length ? h('button', { class: 'eat-row', type: 'button', onclick: () => go({ eat: group.destination }) }, h('span', {}, `Where to dine in ${group.destination}`), h('span', { class: 'eat-count' }, `${dining.length} restaurants ›`)) : null;
    return h('section', { class: `dest${open ? ' is-open' : ''}` }, head, eat,
      open ? group.days.map((day) => h('div', { class: `pass${day.date === todayAt(sheet, day.destination) ? ' today' : ''}`, id: `d-${day.date}` },
        h('div', { class: 'stub' }, h('i', {}, 'DAY'), String(day.day), day.date === todayAt(sheet, day.destination) ? h('span', { class: 'today-tag' }, 'TODAY') : null),
        h('div', { class: 'pass-body' }, h('div', { class: 'pass-date' }, dayDate(day.date)), day.parts.map((p) => partView(p, sheet))))) : null);
  });
}

// ---------- the passport ----------
const STAMPS_SEEN_KEY = 'tourdocs.guest.stamps';
const stampDate = (iso) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)).toUpperCase();
// A stamp is remembered by name AND first date, so two places with the same name (or a changed date) never share a stamp. (Older copies kept the name only: still honoured.)
const stampKey = (d) => `${d.name}|${d.firstDate}`;
const isSeen = (seen, d) => seen.includes(stampKey(d)) || seen.includes(d.name);
const seenStamps = () => { try { return JSON.parse(store.get(STAMPS_SEEN_KEY)) ?? []; } catch { return []; } };
// The stamps of the trip: given when the first day in a place begins THERE (its own time zone), whatever the phone's clock zone says.
const passportOf = (sheet) => passportState(sheet.destinations, simulatedDate ?? new Date());

function passportView(sheet, offline) {
  const state = passportOf(sheet);
  const seen = seenStamps();
  const tiles = state.map((d, i) => {
    const fresh = d.given && !isSeen(seen, d);
    const tile = h('div', { class: `stamp-tile${d.given ? '' : ' is-locked'}${fresh ? ' is-new' : ''}` });
    if (d.given) { tile.innerHTML = stampSvg(d, stampDate(d.firstDate), `p${i}`); } // drawn by passport.js from the destination's own name, not typed text
    else tile.append(h('div', { class: 'stamp-ghost' }, h('span', {}, '?')));
    return h('div', { class: 'stamp-cell' }, tile, h('div', { class: 'stamp-name' }, d.given ? d.name : `Opens ${stampDate(d.firstDate).slice(0, -5)}`), d.given ? h('div', { class: 'stamp-date' }, stampDate(d.firstDate)) : null);
  });
  if (!simulatedDate) { const all = state.filter((d) => d.given).map(stampKey); store.set(STAMPS_SEEN_KEY, JSON.stringify([...new Set([...seen, ...all])])); }
  return [
    h('div', { class: 'atl-head' }, h('small', {}, sheet.company || sheet.trip), h('h1', {}, 'Passport'), h('p', {}, `${state.filter((d) => d.given).length} of ${state.length} stamps`)),
    h('div', { class: 'atl-body' }, offline, h('div', { class: 'stamp-grid' }, tiles),
      h('p', { class: 'foot' }, 'A stamp arrives on the first day in each place, at the local time there.'), creditsLink(sheet)),
  ];
}

// ---------- asking for a change, and notifications ----------
// A guest can ask to switch to another tour of the same half-day. The request goes to the leader (who approves or declines it); the guest sees its
// state in "My requests". The request says what is wanted in words (day, half-day, place, tour names): no internal id.
async function callRpc(name, args) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const REQUESTS_KEY = 'tourdocs.guest.requests';
let myRequests = (() => { try { return JSON.parse(store.get(REQUESTS_KEY)) ?? []; } catch { return []; } })();
async function loadMyRequests() {
  const token = currentToken();
  if (!token || PREVIEW) return;
  try {
    const list = await callRpc('list_guest_requests', { p_token: token });
    if (!Array.isArray(list)) return;
    const changed = JSON.stringify(list.map((r) => [r.id, r.status])) !== JSON.stringify(myRequests.map((r) => [r.id, r.status]));
    myRequests = list; store.set(REQUESTS_KEY, JSON.stringify(list));
    if (changed && currentSheet && !currentSheet.ended && !view.rest && view.tour === undefined && !view.options) paint();
  } catch { /* offline: the kept list stays */ }
}

const REQUEST_ERRORS = { link: 'This link is no longer active.', request: 'This request could not be sent.', too_many: 'You already have 5 requests waiting. Please wait for an answer.' };
async function sendSwitchRequest(sheet, mineIndex, toIndex, note) {
  const mine = sheet.tours[mineIndex]; const to = sheet.tours[toIndex];
  const result = await callRpc('submit_guest_request', { p_token: currentToken(), p_payload: { day: mine.day, date: mine.date, half: mine.half, destination: mine.destination, from: mine.name, to: to.name, note } });
  if (!result.ok) throw new Error(REQUEST_ERRORS[result.error] ?? 'The request could not be sent.');
  await loadMyRequests();
}

// A small window over the page: the question, an optional word for the leader, Send / Cancel.
function modal(title, lines, buttons) {
  const overlay = h('div', { class: 'modal' }, h('div', { class: 'modal-box' }, h('h3', {}, title), ...lines, h('div', { class: 'modal-actions' }, ...buttons)));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  return overlay;
}
function askSwitch(sheet, mineIndex, toIndex) {
  const mine = sheet.tours[mineIndex]; const to = sheet.tours[toIndex];
  if (PREVIEW) { modal('Preview', [h('p', {}, 'In the real app, the guest can send this request to the leader. Nothing is sent from a preview.')], [h('button', { class: 'btn-link', type: 'button', onclick: (e) => e.target.closest('.modal').remove() }, 'OK')]); return; }
  const note = h('textarea', { class: 'note-input', rows: '2', maxlength: '200', placeholder: 'A word for your leader (optional)', 'aria-label': 'A word for your leader' });
  const message = h('p', { class: 'modal-error', hidden: '' });
  const send = h('button', { class: 'btn-link', type: 'button' }, 'Send the request');
  const overlay = modal('Ask to switch?', [
    h('p', {}, h('b', {}, 'Now: '), mine.name), h('p', {}, h('b', {}, 'Wanted: '), to.name),
    h('p', { class: 'muted' }, 'Your leader decides. You will be told here, and by notification if you turned them on.'), note, message,
  ], [send, h('button', { class: 'plain-link', type: 'button', onclick: () => overlay.remove() }, 'Cancel')]);
  send.addEventListener('click', async () => {
    send.disabled = true; send.textContent = 'Sending…';
    try { await sendSwitchRequest(sheet, mineIndex, toIndex, note.value.trim()); overlay.remove(); paint(); }
    catch (error) { message.hidden = false; message.textContent = /Failed to fetch|HTTP|NetworkError/i.test(String(error.message)) ? 'No connection. Please try again when you are online.' : error.message; send.disabled = false; send.textContent = 'Send the request'; }
  });
}

const REQUEST_STATUS = { pending: 'Waiting for your leader', approved: 'Approved', declined: 'Not possible', cancelled: 'Taken back', failed: 'Not possible' };
function myRequestsBlock() {
  const recent = myRequests.filter((r) => r.status === 'pending' || Date.now() - Date.parse(r.decided_at || r.created_at) < 3 * 86400000).slice(0, 5);
  if (recent.length === 0) return null;
  return h('div', { class: 'requests' }, h('div', { class: 'block-title' }, 'My requests'),
    recent.map((r) => h('div', { class: `request request--${r.status}` },
      h('div', { class: 'request-what' }, `Day ${r.payload.day} ${String(r.payload.half).toLowerCase()}: ${r.payload.to}`),
      h('div', { class: 'request-state' }, REQUEST_STATUS[r.status] ?? r.status, r.note ? ` · ${r.note}` : ''),
      r.status === 'pending' ? h('button', { class: 'link-btn', type: 'button', onclick: async () => { try { await callRpc('cancel_guest_request', { p_token: currentToken(), p_id: r.id }); await loadMyRequests(); paint(); } catch { /* offline */ } } }, 'Take it back') : null)));
}

// Notifications: one row under the "Updated" line. On an iPhone the app must be on the Home Screen first.
const PUSH_KEY = 'tourdocs.guest.push';
function notifyRow() {
  if (PREVIEW) return null;
  const capability = pushCapability();
  if (!capability.supported) return null;
  const on = store.get(PUSH_KEY) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const text = capability.needsInstall ? 'To get notifications, first add this app to your Home Screen (Share button, then Add to Home Screen).'
    : capability.denied ? 'Notifications are blocked: allow them in your phone\'s Settings.'
    : on ? 'Notifications are on: you will hear about changes to your programme.' : 'Get a notification when your programme changes or your request is answered.';
  const action = capability.needsInstall || capability.denied ? null
    : h('span', { class: 'notify-actions' }, on ? h('button', { class: 'link-btn', type: 'button', onclick: prefsModal }, 'Choose') : null, h('button', { class: 'link-btn', type: 'button', onclick: async (e) => {
      const button = e.target; button.disabled = true;
      try { if (on) await disablePush(); else await enablePush(); } catch (error) { button.textContent = String(error.message).slice(0, 80); return; }
      paint();
    } }, on ? 'Turn off' : '🔔 Turn on'));
  return h('div', { class: 'notify-row' }, h('span', { class: 'notify-text' }, text), action);
}
// What the guest wants to hear about (kept on the phone and sent to the server with the phone's time zone, so quiet hours follow the guest around the world).
const PREFS_KEY = 'tourdocs.guest.pushprefs';
const DEFAULT_PREFS = { changes: true, requests: true, reminders: true, announcements: true, quiet: true };
const loadPrefs = () => { try { return { ...DEFAULT_PREFS, ...JSON.parse(store.get(PREFS_KEY)) }; } catch { return { ...DEFAULT_PREFS }; } };
const phoneZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
async function savePrefs(prefs) {
  store.set(PREFS_KEY, JSON.stringify(prefs));
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await callRpc('set_guest_push_prefs', { p_token: currentToken(), p_endpoint: subscription.endpoint, p_prefs: prefs, p_tz: phoneZone() });
    store.set('tourdocs.guest.pushtz', phoneZone());
  }
}
// The guest has travelled to another time zone: tell the server, so "quiet at night" means THEIR night.
async function syncPushZone() {
  if (store.get(PUSH_KEY) !== '1' || store.get('tourdocs.guest.pushtz') === phoneZone()) return;
  try { await savePrefs(loadPrefs()); } catch { /* the next refresh tries again */ }
}
function prefsModal() {
  const prefs = loadPrefs();
  const rows = [
    ['changes', 'Changes to my programme', 'a tour cancelled or moved, a new time or meeting point, my dinner'],
    ['requests', 'Answers to my requests', 'when my leader answers a request to switch tours'],
    ['reminders', 'Reminders', 'for example the evening before a tour'],
    ['announcements', 'Messages from my leader', 'general news for the whole group'],
  ].map(([key, label, hint]) => {
    const box = h('input', { type: 'checkbox', 'aria-label': label }); box.checked = prefs[key] !== false;
    box.addEventListener('change', () => { prefs[key] = box.checked; savePrefs(prefs).catch(() => {}); });
    return h('label', { class: 'pref-row' }, box, h('span', {}, h('b', {}, label), h('small', {}, hint)));
  });
  const quiet = h('input', { type: 'checkbox', 'aria-label': 'Quiet at night' }); quiet.checked = prefs.quiet !== false;
  quiet.addEventListener('change', () => { prefs.quiet = quiet.checked; savePrefs(prefs).catch(() => {}); });
  const overlay = modal('What to be told about', [...rows,
    h('label', { class: 'pref-row' }, quiet, h('span', {}, h('b', {}, 'Quiet at night'), h('small', {}, 'Between 10 pm and 7 am where you are, notifications arrive without sound. Important messages from your leader always arrive with sound.')))],
  [h('button', { class: 'btn-link', type: 'button', onclick: () => overlay.remove() }, 'Done')]);
}

async function enablePush() {
  const key = await callRpc('get_push_public_key', {});
  if (!key) throw new Error('Notifications are not available yet.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
  const fields = subscriptionFields(subscription);
  const result = await callRpc('save_guest_push', { p_token: currentToken(), p_endpoint: fields.endpoint, p_p256dh: fields.p256dh, p_auth: fields.auth });
  if (!result.ok) throw new Error('Could not save the notification.');
  store.set(PUSH_KEY, '1');
  await savePrefs(loadPrefs()).catch(() => {}); // sends the choices and the time zone
}
async function disablePush() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) { await callRpc('delete_guest_push', { p_token: currentToken(), p_endpoint: subscription.endpoint }).catch(() => {}); await subscription.unsubscribe(); }
  store.remove(PUSH_KEY);
}

// ---------- the other options of one half-day ----------
// Shown from the "Other options" button under a tour the guest is booked on: the other tours offered at the same time, read only. Asking for a
// change comes later (it needs the team's answer); until then the guest is told to speak to their guide.
// A page with no big photo (other options, where to dine, credits): a round back button, a small label and a big title.
function plainHead(label, title) {
  return h('div', { class: 'atl-head atl-head--sub' },
    h('button', { class: 'atl-back atl-back--inline', type: 'button', 'aria-label': 'Back', onclick: () => history.back() }, '‹'),
    h('small', {}, label), h('h1', {}, title));
}

function optionsView(sheet, tourIndex, offline) {
  const mine = sheet.tours[tourIndex];
  const part = sheet.days.flatMap((d) => d.parts).find((p) => p.tour === tourIndex);
  const cards = (part?.alt ?? []).map((index) => {
    const tour = sheet.tours[index];
    const photo = tour.info?.photos?.[0];
    const card = h('div', { class: 'option-card atl-option', role: 'button', tabindex: '0' },
      photo ? picture(photo.url, 'thumb', '') : null,
      h('div', { class: 'option-text' },
        h('div', { class: 'what' }, tour.name),
        h('div', { class: 'line' }, [tour.time ? `Starts ${tour.time}` : null, tour.info?.duration].filter(Boolean).join(' · ')),
        h('div', { class: 'chips' }, tour.info?.difficulty ? chip(DIFFICULTY[tour.info.difficulty].label, `chip--${tour.info.difficulty}`) : null),
        h('button', { class: 'other-btn', type: 'button', onclick: (event) => { event.stopPropagation(); askSwitch(sheet, tourIndex, index); } }, 'Ask to switch')));
    card.addEventListener('click', () => openTour(index));
    return card;
  });
  return [
    plainHead(`${dayDate(mine.date)} · ${mine.half} · ${mine.destination}`, 'Other options'),
    h('div', { class: 'atl-body' },
      offline,
      h('div', { class: 'atl-note' }, h('small', {}, 'You are booked on'), h('b', {}, mine.name)),
      h('div', { class: 'atl-cards' }, ...cards),
      h('div', { class: 'atl-note' }, h('small', {}, 'Want to change?'), h('span', {}, 'Tap "Ask to switch" on the tour you prefer. Your leader decides and you are told here.')),
      myRequestsBlock()),
  ];
}

// ---------- restaurants (the dine-around) ----------
// Every restaurant is shown in the same order and the same style, whatever its own menu looks like: guests choose for the food.
function restaurantView(sheet, index, offline) {
  const r = sheet.restaurants[index];
  const card = r.card;
  const photos = card.photos ?? [];
  const gallery = photos.length
    ? h('div', { class: 'atl-gallery' }, photos.map((p) => h('figure', { class: 'atl-shot' }, picture(p.url, '', p.caption || r.name))))
    : null;
  const block = (title, body) => (body ? h('section', { class: 'atl-section' }, h('div', { class: 'atl-label' }, title), h('p', { class: 'atl-text' }, body)) : null);
  const money = (price) => (price ? `${card.currency ? `${card.currency} ` : ''}${price}` : null);
  const menu = card.sections.map((section) => h('div', { class: 'menu-section' },
    h('div', { class: 'menu-title' }, section.name),
    section.items.map((item) => h('div', { class: 'dish' },
      h('div', { class: 'dish-row' }, h('div', { class: 'dish-name' }, item.name), item.price ? h('div', { class: 'dish-price' }, money(item.price)) : null),
      item.description ? h('div', { class: 'dish-desc' }, item.description) : null,
      item.tags?.length ? h('div', { class: 'chips' }, item.tags.map((t) => chip(t, 'chip--tag'))) : null))));
  const others = sheet.restaurants.map((x, i) => ({ x, i })).filter(({ x, i }) => i !== index && x.destination === r.destination);
  return [
    h('div', { class: `atl-tourtop${gallery ? '' : ' atl-tourtop--plain'}` }, gallery, h('button', { class: 'atl-back', type: 'button', 'aria-label': 'Back', onclick: () => history.back() }, '‹')),
    h('div', { class: 'atl-tourhead' },
      h('span', { class: 'atl-pill' }, r.destination),
      h('h1', {}, r.name),
      h('div', { class: 'chips atl-chips' }, card.cuisine ? chip(card.cuisine, 'chip--time') : null, card.vibe ? chip(card.vibe, 'chip--place') : null)),
    h('div', { class: 'atl-body atl-body--tour' },
      offline,
      block('About', card.about), block('Inside', card.interior), block('Outside', card.outdoor),
      card.sections.length ? h('section', { class: 'atl-section atl-menu' }, h('div', { class: 'atl-label' }, 'Menu'), ...menu, h('p', { class: 'foot' }, 'Please tell your waiter about any allergy or dietary requirement before ordering. Dish tags are a guide, not a guarantee.')) : null,
      others.length ? h('section', { class: 'atl-section' }, h('div', { class: 'atl-label' }, 'Other restaurants here'),
        others.map(({ x, i }) => h('button', { class: 'eat-row', type: 'button', onclick: () => openRestaurant(i) }, h('span', {}, x.name), h('span', { class: 'eat-count' }, `${x.card.cuisine ?? ''} ›`)))) : null),
  ].filter(Boolean);
}

function eatView(sheet, destination, offline) {
  const list = sheet.restaurants.map((r, i) => ({ r, i })).filter(({ r }) => r.destination === destination);
  return [
    plainHead(destination, 'Where to dine'),
    h('div', { class: 'atl-body' }, offline, h('div', { class: 'atl-cards' },
      list.map(({ r, i }) => {
        const photo = r.card.photos?.[0];
        const card = h('div', { class: 'option-card atl-option', role: 'button', tabindex: '0' },
          photo ? picture(photo.url, 'thumb', '') : null,
          h('div', { class: 'option-text' }, h('div', { class: 'what' }, r.name), h('div', { class: 'line' }, [r.card.cuisine, r.card.vibe].filter(Boolean).join(' · '))));
        card.addEventListener('click', () => openRestaurant(i));
        return card;
      }))),
  ];
}

// ---------- photo credits ----------
// The photographs come from Wikimedia Commons under free licences that ask for the photographer to be named: this page does that.
function creditsLink(sheet) {
  const used = [...new Set([...(sheet.destinations ?? []).map((d) => d.photo), ...(sheet.tours ?? []).flatMap((t) => (t.info?.photos ?? []).map((p) => p.url)), ...(sheet.restaurants ?? []).flatMap((r) => (r.card.photos ?? []).map((p) => p.url))])].filter((u) => /^photos\//.test(u));
  if (!used.length) return null;
  return h('p', { class: 'foot' }, h('button', { class: 'link-btn', type: 'button', onclick: () => go({ credits: true }) }, 'Photo credits'));
}
function creditsView(sheet, offline) {
  const list = h('div', { class: 'atl-body' }, offline, h('p', { class: 'foot' }, 'Loading…'));
  fetch('photos/credits.json').then((r) => r.json()).then((all) => {
    const used = new Set([...(sheet.destinations ?? []).map((d) => d.photo), ...(sheet.tours ?? []).flatMap((t) => (t.info?.photos ?? []).map((p) => p.url)), ...(sheet.restaurants ?? []).flatMap((r) => (r.card.photos ?? []).map((p) => p.url))]);
    const rows = Object.entries(all).filter(([key]) => used.has(`photos/${key}.jpg`)).map(([key, c]) => h('div', { class: 'info-block' }, h('div', { class: 'block-title' }, key.replace(/^tours\//, '').replace(/-/g, ' ')), h('div', { class: 'block-text' }, `${c.author}, ${c.license}`, h('br'), h('a', { href: c.source, target: '_blank', rel: 'noopener' }, 'Wikimedia Commons'))));
    list.replaceChildren(offline ?? '', ...rows);
  }).catch(() => { list.replaceChildren(h('p', { class: 'foot' }, 'The credits could not be loaded right now.')); });
  return [plainHead(sheet.trip, 'Photo credits'), list];
}

// The activity level, written out in the body of the tour page (owner's request): the level in words, what it means, then the leader's own details
// (distance, climb, steps, heat, tight spaces...). Not hidden behind a bubble or an "i".
// One block at the end of a tour page: how demanding it is AND what a guest with reduced mobility needs to know (owner's request, 4 Oct 2026).
// The level in words, then the leader's own factual details (distance, steps, lifts, floors), so the guest can decide or come and talk to the leader.
function levelBlock(info) {
  const level = info?.difficulty ? DIFFICULTY[info.difficulty] : null;
  if (!level && !info?.accessibility && !info?.difficultyNote) return null;
  const facts = [info.difficultyNote, info.accessibility].filter(Boolean);
  return h('section', { class: `atl-section atl-level${level ? ` level--${info.difficulty}` : ''}` },
    h('div', { class: 'atl-label' }, level ? 'Activity level and accessibility' : 'Accessibility'),
    level ? h('div', { class: 'atl-level-name' }, h('i', { class: 'atl-level-dot' }), level.label) : null,
    level ? h('p', { class: 'atl-text' }, level.help) : null,
    ...facts.map((text) => h('p', { class: 'atl-text atl-fact' }, text)),
    h('p', { class: 'atl-ask' }, 'Not sure this is right for you? Talk to your tour leader before you choose.'));
}

// ---------- one tour ----------
// The page reads in this order: the photos, what happens (the story), good to know, then the level and accessibility together at the end.
function tourView(sheet, tour, offline) {
  const info = tour.info ?? {};
  const photos = info.photos ?? [];
  const gallery = photos.length
    ? h('div', { class: 'atl-gallery' }, photos.map((p) => h('figure', { class: 'atl-shot' }, picture(p.url, '', p.caption || tour.name))))
    : null;
  const section = (title, text, cls = '') => (text ? h('section', { class: `atl-section ${cls}`.trim() }, h('div', { class: 'atl-label' }, title), h('p', { class: `atl-text ${cls ? `${cls}-text` : ''}`.trim() }, text)) : null);
  return [
    h('div', { class: `atl-tourtop${gallery ? '' : ' atl-tourtop--plain'}` }, gallery, h('button', { class: 'atl-back', type: 'button', 'aria-label': 'Back', onclick: () => history.back() }, '‹')),
    h('div', { class: 'atl-tourhead' },
      h('span', { class: 'atl-pill' }, `${dayDate(tour.date)} · ${tour.half}`),
      h('h1', {}, tour.name),
      h('p', {}, tour.destination),
      // At a glance: when we leave, where we meet, how long.
      h('div', { class: 'chips atl-chips' },
        tour.time ? chip(`Leaves ${tour.time}`, 'chip--time') : null,
        tour.meeting ? chip(tour.meeting, 'chip--place') : null,
        info.duration ? chip(info.duration) : null)),
    h('div', { class: 'atl-body atl-body--tour' },
      offline,
      section('What happens', info.description, 'atl-story'),
      section('Good to know', info.bring),
      levelBlock(info)),
  ].filter(Boolean);
}

// ---------- which screen is shown ----------
// The tour page is a step in the phone's history, so the back gesture returns to the programme.
let view = { tab: 'today' }; // a tab (today, trip, passport), or { tour: index } etc. for one page inside
let currentSheet = null;
let currentOffline = false;

function go(next) { history.pushState({ view: next }, ''); view = next; paint(); window.scrollTo(0, 0); }
function openTour(index) { go({ tour: index }); }
function openOptions(index) { go({ options: index }); }
function openRestaurant(index) { if (index >= 0) go({ rest: index }); }
window.addEventListener('popstate', (event) => { view = event.state?.view ?? { tab: 'today' }; if (currentSheet) paint(); });

// The company colour is kept for small touches only (a stripe at the top): the rest of the look is fixed, so a light or unusual company colour
// can never make the app hard to read. Falls back to a calm green when the colour is missing or odd.
function applyAccent(accent) {
  const hex = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#1d5c57';
  document.documentElement.style.setProperty('--company', hex);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', '#ffffff');
}

// ---------- keeping the programme fresh ----------
// The app looks for news by itself every minute while it is open. The guest can also ask at once: the "Refresh" button, or pulling the page down.
// The "Updated" line says when the leader's phone last sent this programme, and when this phone last asked the server.
let lastChecked = null;
let refreshNote = null; // a short word shown for a moment after a manual refresh
let refreshing = false;
async function manualRefresh() {
  if (refreshing) return;
  refreshing = true; refreshNote = 'Refreshing…'; if (currentSheet) paint();
  const status = await refresh();
  refreshing = false;
  refreshNote = status === 'ok' || status === 'preview' ? 'Up to date' : 'No connection: showing the last programme received';
  if (currentSheet && !currentSheet.ended) paint();
  setTimeout(() => { refreshNote = null; if (currentSheet && !currentSheet.ended) paint(); }, 3000);
}
const clockOf = (d) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
function updatedRow(sheet) {
  const when = sheet.updatedAt ? `Updated ${updatedText(sheet.updatedAt)}` : '';
  const checked = lastChecked ? ` · checked ${clockOf(lastChecked)}` : '';
  return h('div', { class: 'updated-row' },
    h('span', { class: 'updated-text' }, refreshNote ?? `${when}${checked}`),
    h('button', { class: 'link-btn', type: 'button', onclick: manualRefresh, disabled: refreshing ? '' : null }, '↻ Refresh'));
}

// Pull the page down from the very top to refresh, like in any phone app: a small label follows the finger; letting go past the line refreshes.
(() => {
  const pull = h('div', { class: 'pull', 'aria-hidden': 'true' }, 'Pull to refresh');
  document.body.append(pull);
  let startY = null; let distance = 0;
  const THRESHOLD = 80;
  addEventListener('touchstart', (e) => { startY = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null; distance = 0; }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (startY === null) return;
    distance = Math.max(0, e.touches[0].clientY - startY);
    pull.style.transform = `translate(-50%, ${Math.min(distance, 110) - 44}px)`;
    pull.style.opacity = String(Math.min(1, distance / 50));
    pull.textContent = distance > THRESHOLD ? 'Release to refresh' : 'Pull to refresh';
    pull.classList.toggle('is-ready', distance > THRESHOLD);
  }, { passive: true });
  const end = () => {
    if (startY !== null && distance > THRESHOLD) manualRefresh();
    startY = null; distance = 0; pull.style.opacity = '0'; pull.style.transform = 'translate(-50%, -44px)';
  };
  addEventListener('touchend', end, { passive: true });
  addEventListener('touchcancel', end, { passive: true });
})();

function paint() {
  paintPage();
  // The wide-screen layout (iPad) puts the big photo of a tour or restaurant beside its text: say which kind of page this is.
  app.dataset.page = (view.tour !== undefined || view.rest !== undefined) && !view.options && !view.credits && !view.eat ? 'photo' : 'plain';
}
function paintPage() {
  const sheet = currentSheet;
  if (!sheet) return;
  applyAccent(sheet.accent);
  document.title = sheet.trip;
  const tour = view.tour !== undefined ? sheet.tours?.[view.tour] : null;
  if ((view.tour !== undefined && !tour) || (view.options !== undefined && !sheet.tours?.[view.options])) { view = { tab: 'today' }; }
  const offline = currentOffline ? h('div', { class: 'banner' }, `No internet right now. Showing what was last received (${updatedText(sheet.updatedAt)}).`) : null;
  if (view.credits) { app.replaceChildren(...creditsView(sheet, offline)); return; }
  if (view.rest !== undefined && !sheet.restaurants?.[view.rest]) view = { tab: 'today' };
  if (view.rest !== undefined) { app.replaceChildren(...restaurantView(sheet, view.rest, offline)); return; }
  if (view.eat !== undefined) { app.replaceChildren(...eatView(sheet, view.eat, offline)); return; }
  if (view.options !== undefined) {
    app.replaceChildren(...optionsView(sheet, view.options, offline));
    return;
  }
  if (tour) {
    app.replaceChildren(...tourView(sheet, tour, offline));
    return;
  }
  const tabs = { today: () => todayView(sheet, offline), trip: () => tripView(sheet, offline), passport: () => passportView(sheet, offline) };
  if (!tabs[view.tab]) view = { tab: 'today' };
  app.replaceChildren(...tabs[view.tab](), tabBar(sheet));
}

// The goodbye shown once the link has expired: the trip owner's own message (or the default one) and, if given, a link to the next trips.
const FAREWELL_DEFAULT = 'Thank you so much for traveling with us. We hope you got home with memories of a lifetime and cannot wait to be traveling with you again.';
function farewellView(sheet) {
  const f = sheet.farewell ?? {};
  const site = String(f.website ?? '').trim();
  const href = /^https?:\/\//i.test(site) ? site : `https://${site}`;
  const shown = site.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  document.title = sheet.trip;
  return [
    h('header', { class: 'hero' }, h('div', { class: 'hero-text' },
      sheet.company ? h('div', { class: 'company' }, sheet.company) : null,
      h('p', { class: 'sub' }, sheet.trip),
      h('h1', {}, 'Thank you'))),
    h('div', { class: 'content farewell' },
      h('p', { class: 'farewell-text' }, f.text || FAREWELL_DEFAULT),
      site ? h('p', { class: 'farewell-text' }, 'Find your next trip at') : null,
      site ? h('a', { class: 'btn-link', href, target: '_blank', rel: 'noopener' }, shown) : null),
  ];
}

// After the link's last day the programme is no longer shown and the kept copy is erased (the server has already forgotten it).
function expired(sheet) { return !simulatedDate && /^\d{4}-\d{2}-\d{2}$/.test(sheet.expiresOn ?? '') && localToday() > sheet.expiresOn; }

// While the trip is on, a sheet nobody has refreshed for two days may be out of date (the leader's phone sends the programme, and it has been quiet).
function staleNotice(sheet) {
  if (simulatedDate || !sheet.updatedAt) return null;
  const first = sheet.days[0]; const last = sheet.days[sheet.days.length - 1];
  if (!first || todayAt(sheet, first.destination) < first.date || todayAt(sheet, last.destination) > last.date) return null;
  if (Date.now() - Date.parse(sheet.updatedAt) < 48 * 3600000) return null;
  return h('div', { class: 'banner' }, 'This programme may be out of date. If something has changed, please ask your tour leader.');
}

function render(sheet, { offline = false } = {}) {
  if (sheet.ended || expired(sheet)) {
    // The programme is erased from this phone; only the farewell stays (small, no names, no days).
    const keep = { v: SUPPORTED_SHEET, trip: sheet.trip, company: sheet.company, accent: sheet.accent, first: '', updatedAt: sheet.updatedAt, days: [], destinations: [], tours: [], restaurants: [], options: false, expiresOn: sheet.expiresOn, ended: true, farewell: sheet.farewell };
    if (!simulatedDate) store.set(SHEET_KEY, JSON.stringify(keep));
    currentSheet = keep; currentOffline = false;
    app.replaceChildren(...farewellView(keep));
    return;
  }
  if (currentSheet && offline === currentOffline && JSON.stringify(sheet) === JSON.stringify(currentSheet) && app.children.length > 0 && !app.querySelector('.problem')) return; // nothing new: do not redraw (it would close an open panel)
  currentSheet = sheet;
  currentOffline = offline;
  paint();
  // Keep the pictures for offline use: asking for them once lets the service worker keep them. The tours the guest is booked on get all their
  // photos, their other options only the first one.
  const wanted = new Set();
  for (const part of sheet.days.flatMap((d) => d.parts)) {
    if (part.tour === undefined || part.tour < 0) continue;
    for (const p of sheet.tours?.[part.tour]?.info?.photos ?? []) wanted.add(p.url);
    // (the other options are NOT fetched ahead: their pictures are kept the first time the guest looks at them, so the phone's data is spared)
  }
  for (const r of sheet.restaurants ?? []) for (const p of r.card.photos ?? []) wanted.add(p.url);
  for (const d of sheet.destinations ?? []) if (d.photo) wanted.add(d.photo);
  fetch('photos/credits.json').catch(() => {});
  for (const url of [...wanted].slice(0, 120)) fetch(url).catch(() => {});
}

function showProblem(title, text) {
  currentSheet = null;
  app.replaceChildren(h('div', { class: 'problem' }, h('h1', {}, title), h('p', { class: 'muted' }, text)));
}

// No link on this phone yet (for instance an app just put on the Home Screen, which starts empty): the guest types the 4-digit one-time code the leader makes for this device, or pastes the link they were sent. The code is swapped for the long secret by the server (claim_guest_code).
function showNoLink() {
  currentSheet = null;
  const field = h('input', { class: 'paste-field', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Code, 4 digits', 'aria-label': 'Your code or link', autocapitalize: 'none', autocorrect: 'off' });
  const message = h('p', { class: 'muted' }, '');
  const keep = (token) => { store.set(TOKEN_KEY, token); store.remove(SHEET_KEY); window.location.hash = token; window.location.reload(); };
  const go = async () => {
    const typed = field.value.trim();
    const asLink = typed.split('#').pop().trim();
    if (/^[A-Za-z0-9_-]{16,64}$/.test(asLink)) { keep(asLink); return; }
    const digits = typed.replace(/\D/g, '');
    if (digits.length !== 4) { message.textContent = 'The code has 4 digits. Check the number your tour leader showed you.'; return; }
    message.textContent = 'Checking…';
    try {
      const token = await callRpc('claim_guest_code', { p_code: digits });
      if (token) keep(token); else message.textContent = 'This code does not work: it may have been used already or be older than 30 minutes. Ask your tour leader for a new one.';
    } catch { message.textContent = 'Could not check the code. Are you online? If it keeps failing, wait a few minutes.'; }
  };
  field.addEventListener('keydown', (event) => { if (event.key === 'Enter') go(); });
  app.replaceChildren(h('div', { class: 'problem' }, h('h1', {}, 'Your code'),
    h('p', { class: 'muted' }, 'Type the 4-digit code your tour leader gives you. You only do this once: after that, this app opens straight on your programme.'),
    field, h('button', { class: 'btn-link paste-go', type: 'button', onclick: go }, 'Open my programme'), message));
}

// ---------- running ----------
let scrolledToToday = false;
// Preview (owner, from the leader's app: Preview as Guest): the sheet was put on this phone by the leader's app, nothing is asked of the server and
// nothing is kept. A bar at the top leads back to the leader's app.
const PREVIEW = new URLSearchParams(window.location.search).has('preview');
function showPreview() {
  let sheet = null;
  try { sheet = JSON.parse(store.get('tourdocs.guest.preview')); } catch { sheet = null; }
  if (!sheet || sheet.v !== SUPPORTED_SHEET) { showProblem('No preview', 'Open the preview again from the leader\'s app: Settings, Preview as Guest.'); return; }
  simulatedDate = /^\d{4}-\d{2}-\d{2}$/.test(sheet.previewDate ?? '') ? sheet.previewDate : null;
  render(sheet);
  if (!document.querySelector('.preview-strip')) {
    const strip = h('a', { class: 'preview-strip', href: '../' }, `Preview as ${sheet.first}${simulatedDate ? ` · pretending it is ${simulatedDate}` : ''} · back to Tour Docs`);
    document.body.prepend(strip);
  }
}

async function refresh() {
  let status = 'none';
  if (PREVIEW) { showPreview(); return 'preview'; }
  const token = currentToken();
  if (!token) { showNoLink(); return 'none'; }
  const kept = (() => { try { return JSON.parse(store.get(SHEET_KEY)); } catch { return null; } })();
  if (kept && kept.v === SUPPORTED_SHEET && !app.querySelector('.pass, .dest')) render(kept, { offline: !navigator.onLine });
  const result = await fetchSheet(token);
  if (result.sheet) {
    lastChecked = new Date();
    status = 'ok';
    loadMyRequests();
    syncPushZone();
    const label = document.querySelector('.updated-text'); // the "checked" time moves on without redrawing the page
    if (label && !refreshNote && currentSheet?.updatedAt) label.textContent = `Updated ${updatedText(currentSheet.updatedAt)} · checked ${clockOf(lastChecked)}`;
    store.set(SHEET_KEY, JSON.stringify(result.sheet));
    render(result.sheet);
  } else if (result.off) {
    status = 'off';
    store.remove(SHEET_KEY);
    showProblem('This link is not active', 'Ask your tour leader for a new link.');
  } else if (result.tooNew) {
    status = 'tooNew';
    showProblem('Please update', 'Close this app and open it again with internet to get the latest version.');
  } else if (kept && kept.v === SUPPORTED_SHEET) {
    status = 'offline';
    render(kept, { offline: true });
  } else {
    status = 'offline';
    showProblem('No connection', 'Connect to the internet once to receive your programme. After that it works without.');
  }
  if (!scrolledToToday) {
    const todayDay = currentSheet?.days.find((d) => d.date === todayAt(currentSheet, d.destination));
    const today = todayDay ? document.getElementById(`d-${todayDay.date}`) : null;
    const group = today?.closest('.dest');
    if (group && group !== document.querySelector('.dest')) { group.scrollIntoView(); scrolledToToday = true; } // the first group is already at the top
  }
  return status;
}

refresh();
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_EVERY);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('online', refresh);
window.addEventListener('hashchange', () => { scrolledToToday = false; refresh(); });

// Offline: the service worker keeps the app's own files on the phone.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
