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

// The info bar under the header: where the guest is in the trip. During the trip: day x of n, the place, today's date. Before: when it starts.
// After: that it is over. (Each day is judged in its own destination's time zone.)
function tripBar(sheet) {
  const days = sheet.days;
  const first = days[0]; const last = days[days.length - 1];
  const cell = (label, value) => h('div', {}, h('small', {}, label), h('b', {}, value));
  if (!first) return null;
  // Each day is compared with "today" in its own destination's time zone.
  const isToday = (d) => d.date === todayAt(sheet, d.destination);
  const here = days.find(isToday);
  if (here) return h('div', { class: 'bar' }, cell('Day', `${here.day} of ${last.day}`), cell('Now in', here.destination), cell('Today', dayDate(here.date)));
  const before = todayAt(sheet, first.destination) < first.date;
  if (before) return h('div', { class: 'bar' }, cell('Starts', dayDate(first.date)), cell('Days', String(last.day)), cell('First stop', first.destination));
  if (todayAt(sheet, last.destination) > last.date) return h('div', { class: 'bar' }, cell('Trip', 'Complete'), cell('Days', String(last.day)), cell('Last stop', last.destination));
  const passed = days.filter((d) => d.date < todayAt(sheet, d.destination)).pop() ?? first; // a travel day with no programme line
  return h('div', { class: 'bar' }, cell('Day', `${passed.day} of ${last.day}`), cell('Now in', passed.destination), cell('Today', dayDate(todayAt(sheet, passed.destination))));
}

// The "Next up" card, shown in the header of the programme.
function nextCard(sheet) {
  const next = nextUp(sheet);
  if (!next) return null;
  const what = next.part.kind === 'dinner' ? `Dinner at ${next.part.restaurant}` : next.part.name;
  const detail = next.part.kind === 'dinner' ? `Table for ${next.part.seating}` : [next.part.time ? `Starts ${next.part.time}` : null, next.part.meeting ? `Meet: ${next.part.meeting}` : null].filter(Boolean).join(' · ');
  return h('div', { class: 'next' }, h('div', { class: 'next-label' }, `Next up · ${dayDate(next.day.date)} · ${next.part.half}`), h('div', { class: 'next-what' }, what), detail ? h('div', { class: 'next-line' }, detail) : null);
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

function passportRow(sheet) {
  const state = passportOf(sheet);
  if (state.length === 0) return null;
  const given = state.filter((d) => d.given).length;
  const fresh = state.filter((d) => d.given && !isSeen(seenStamps(), d)).length;
  const row = h('button', { class: 'passport-row', type: 'button' },
    h('span', { class: 'passport-ic' }, '◎'),
    h('span', { class: 'passport-text' }, h('span', { class: 'passport-title' }, 'My passport'), h('span', { class: 'passport-sub' }, `${given} of ${state.length} stamps`)),
    fresh > 0 ? h('span', { class: 'passport-new' }, 'NEW') : null,
    h('span', { class: 'dest-chev' }, '›'));
  row.addEventListener('click', () => go({ passport: true }));
  return row;
}

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
    h('div', { class: 'tour-top tour-top--plain' }, h('button', { class: 'back', type: 'button', onclick: () => history.back() }, '‹ Back'),
      h('div', { class: 'options-head' }, h('div', { class: 'options-label' }, sheet.trip), h('h2', {}, 'My passport'))),
    h('div', { class: 'content content--tour' }, offline, h('div', { class: 'stamp-grid' }, tiles),
      h('p', { class: 'foot' }, 'A stamp arrives on the first day in each place, at the local time there.')),
  ];
}

// ---------- the other options of one half-day ----------
// Shown from the "Other options" button under a tour the guest is booked on: the other tours offered at the same time, read only. Asking for a
// change comes later (it needs the team's answer); until then the guest is told to speak to their guide.
function optionsView(sheet, tourIndex, offline) {
  const mine = sheet.tours[tourIndex];
  const part = sheet.days.flatMap((d) => d.parts).find((p) => p.tour === tourIndex);
  const cards = (part?.alt ?? []).map((index) => {
    const tour = sheet.tours[index];
    const photo = tour.info?.photos?.[0];
    const card = h('div', { class: 'option-card', role: 'button', tabindex: '0' },
      photo ? picture(photo.url, 'thumb', '') : null,
      h('div', { class: 'option-text' },
        h('div', { class: 'what' }, tour.name),
        h('div', { class: 'line' }, [tour.time ? `Starts ${tour.time}` : null, tour.info?.duration].filter(Boolean).join(' · ')),
        h('div', { class: 'chips' }, tour.info?.difficulty ? chip(DIFFICULTY[tour.info.difficulty].label, `chip--${tour.info.difficulty}`) : null)));
    card.addEventListener('click', () => openTour(index));
    return card;
  });
  return [
    h('div', { class: 'tour-top tour-top--plain' }, h('button', { class: 'back', type: 'button', onclick: () => history.back() }, '‹ Back'),
      h('div', { class: 'options-head' }, h('div', { class: 'options-label' }, `${dayDate(mine.date)} · ${mine.half} · ${mine.destination}`), h('h2', {}, 'Other options'))),
    h('div', { class: 'content content--tour' },
      offline,
      h('div', { class: 'info-block' }, h('div', { class: 'block-title' }, 'You are booked on'), h('div', { class: 'block-text' }, mine.name)),
      ...cards,
      h('div', { class: 'info-block' }, h('div', { class: 'block-title' }, 'Want to change?'), h('div', { class: 'block-text' }, 'Please speak to your guide. Soon you will be able to ask for a change here.'))),
  ];
}

// ---------- restaurants (the dine-around) ----------
// Every restaurant is shown in the same order and the same style, whatever its own menu looks like: guests choose for the food.
function restaurantView(sheet, index, offline) {
  const r = sheet.restaurants[index];
  const card = r.card;
  const photos = card.photos ?? [];
  const gallery = photos.length
    ? h('div', { class: 'gallery' }, photos.map((p) => h('figure', { class: 'shot' }, picture(p.url, '', p.caption || r.name), p.caption ? h('figcaption', {}, p.caption) : null)))
    : h('div', { class: 'gallery gallery--none' });
  const block = (title, body) => (body ? h('div', { class: 'info-block' }, h('div', { class: 'block-title' }, title), h('div', { class: 'block-text' }, body)) : null);
  const money = (price) => (price ? `${card.currency ? `${card.currency} ` : ''}${price}` : null);
  const menu = card.sections.map((section) => h('div', { class: 'menu-section' },
    h('div', { class: 'menu-title' }, section.name),
    section.items.map((item) => h('div', { class: 'dish' },
      h('div', { class: 'dish-row' }, h('div', { class: 'dish-name' }, item.name), item.price ? h('div', { class: 'dish-price' }, money(item.price)) : null),
      item.description ? h('div', { class: 'dish-desc' }, item.description) : null,
      item.tags?.length ? h('div', { class: 'chips' }, item.tags.map((t) => chip(t, 'chip--tag'))) : null))));
  const others = sheet.restaurants.map((x, i) => ({ x, i })).filter(({ x, i }) => i !== index && x.destination === r.destination);
  return [
    h('div', { class: 'tour-top' }, h('button', { class: 'back', type: 'button', onclick: () => history.back() }, '‹ Back'), gallery),
    h('div', { class: 'content content--tour' },
      offline,
      h('div', { class: 'line' }, r.destination),
      h('h2', { class: 'tour-title' }, r.name),
      h('div', { class: 'chips big' }, card.cuisine ? chip(card.cuisine) : null, card.vibe ? chip(card.vibe, 'chip--place') : null),
      block('About', card.about), block('Inside', card.interior), block('Outside', card.outdoor),
      card.sections.length ? h('div', { class: 'info-block' }, h('div', { class: 'block-title' }, 'Menu'), ...menu, h('p', { class: 'foot' }, 'Please tell your waiter about any allergy or dietary requirement before ordering. Dish tags are a guide, not a guarantee.')) : null,
      others.length ? h('div', { class: 'info-block' }, h('div', { class: 'block-title' }, 'Other restaurants here'),
        others.map(({ x, i }) => h('button', { class: 'eat-row', type: 'button', onclick: () => openRestaurant(i) }, h('span', {}, x.name), h('span', { class: 'eat-count' }, `${x.card.cuisine ?? ''} ›`)))) : null),
  ].filter(Boolean);
}

function eatView(sheet, destination, offline) {
  const list = sheet.restaurants.map((r, i) => ({ r, i })).filter(({ r }) => r.destination === destination);
  return [
    h('div', { class: 'tour-top tour-top--plain' }, h('button', { class: 'back', type: 'button', onclick: () => history.back() }, '‹ Back'),
      h('div', { class: 'options-head' }, h('div', { class: 'options-label' }, destination), h('h2', {}, 'Where to dine'))),
    h('div', { class: 'content content--tour' }, offline,
      list.map(({ r, i }) => {
        const photo = r.card.photos?.[0];
        const card = h('div', { class: 'option-card', role: 'button', tabindex: '0' },
          photo ? picture(photo.url, 'thumb', '') : null,
          h('div', { class: 'option-text' }, h('div', { class: 'what' }, r.name), h('div', { class: 'line' }, [r.card.cuisine, r.card.vibe].filter(Boolean).join(' · '))));
        card.addEventListener('click', () => openRestaurant(i));
        return card;
      })),
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
  const list = h('div', { class: 'content content--tour' }, offline, h('p', { class: 'foot' }, 'Loading…'));
  fetch('photos/credits.json').then((r) => r.json()).then((all) => {
    const used = new Set([...(sheet.destinations ?? []).map((d) => d.photo), ...(sheet.tours ?? []).flatMap((t) => (t.info?.photos ?? []).map((p) => p.url)), ...(sheet.restaurants ?? []).flatMap((r) => (r.card.photos ?? []).map((p) => p.url))]);
    const rows = Object.entries(all).filter(([key]) => used.has(`photos/${key}.jpg`)).map(([key, c]) => h('div', { class: 'info-block' }, h('div', { class: 'block-title' }, key.replace(/-/g, ' ')), h('div', { class: 'block-text' }, `${c.author}, ${c.license}`, h('br'), h('a', { href: c.source, target: '_blank', rel: 'noopener' }, 'Wikimedia Commons'))));
    list.replaceChildren(offline ?? '', ...rows);
  }).catch(() => { list.replaceChildren(h('p', { class: 'foot' }, 'The credits could not be loaded right now.')); });
  return [h('div', { class: 'tour-top tour-top--plain' }, h('button', { class: 'back', type: 'button', onclick: () => history.back() }, '‹ Back'), h('div', { class: 'options-head' }, h('div', { class: 'options-label' }, sheet.trip), h('h2', {}, 'Photo credits'))), list];
}

// The activity level, written out in the body of the tour page (owner's request): the level in words, what it means, then the leader's own details
// (distance, climb, steps, heat, tight spaces...). Not hidden behind a bubble or an "i".
function levelBlock(info) {
  if (!info?.difficulty) return null;
  const level = DIFFICULTY[info.difficulty];
  return h('div', { class: `info-block info-block--level level--${info.difficulty}` },
    h('div', { class: 'block-title' }, 'Activity level'),
    h('div', { class: 'level-name' }, level.label),
    h('div', { class: 'block-text' }, level.help),
    info.difficultyNote ? h('div', { class: 'block-text level-note' }, info.difficultyNote) : null);
}

// ---------- one tour ----------
function tourView(sheet, tour, offline) {
  const info = tour.info ?? {};
  const photos = info.photos ?? [];
  const gallery = photos.length
    ? h('div', { class: 'gallery' }, photos.map((p) => h('figure', { class: 'shot' }, picture(p.url, '', p.caption || tour.name), p.caption ? h('figcaption', {}, p.caption) : null)))
    : h('div', { class: 'gallery gallery--none' });
  const section = (title, text) => (text ? h('div', { class: 'info-block' }, h('div', { class: 'block-title' }, title), h('div', { class: 'block-text' }, text)) : null);
  return [
    h('div', { class: 'tour-top' }, h('button', { class: 'back', type: 'button', onclick: () => history.back() }, '‹ Back'), gallery),
    h('div', { class: 'content content--tour' },
      offline,
      h('div', { class: 'line' }, `${dayDate(tour.date)} · ${tour.half} · ${tour.destination}`),
      h('h2', { class: 'tour-title' }, tour.name),
      // At a glance (owner's request): when we leave, where we meet, how long, how demanding: small bubbles under the title.
      h('div', { class: 'chips big' },
        tour.time ? chip(`Leaves ${tour.time}`, 'chip--time') : null,
        tour.meeting ? chip(tour.meeting, 'chip--place') : null,
        info.duration ? chip(info.duration) : null),
      levelBlock(info),
      section('What happens', info.description),
      section('Good to know', info.bring),
      info.accessibility ? h('div', { class: 'info-block info-block--access' }, h('div', { class: 'block-title' }, 'Accessibility'), h('div', { class: 'block-text' }, info.accessibility)) : null),
  ].filter(Boolean);
}

// ---------- which screen is shown ----------
// The tour page is a step in the phone's history, so the back gesture returns to the programme.
let view = { tab: 'programme' }; // the programme, or { tour: index } for one tour's page
let currentSheet = null;
let currentOffline = false;

function go(next) { history.pushState({ view: next }, ''); view = next; paint(); window.scrollTo(0, 0); }
function openTour(index) { go({ tour: index }); }
function openOptions(index) { go({ options: index }); }
function openRestaurant(index) { if (index >= 0) go({ rest: index }); }
window.addEventListener('popstate', (event) => { view = event.state?.view ?? { tab: 'programme' }; if (currentSheet) paint(); });

// The company colour is kept for small touches only (a stripe at the top): the rest of the look is fixed, so a light or unusual company colour
// can never make the app hard to read. Falls back to a calm green when the colour is missing or odd.
function applyAccent(accent) {
  const hex = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#1d5c57';
  document.documentElement.style.setProperty('--company', hex);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', '#000000');
}

function paint() {
  const sheet = currentSheet;
  if (!sheet) return;
  applyAccent(sheet.accent);
  document.title = sheet.trip;
  const tour = view.tour !== undefined ? sheet.tours?.[view.tour] : null;
  if ((view.tour !== undefined && !tour) || (view.options !== undefined && !sheet.tours?.[view.options])) { view = { tab: 'programme' }; }
  const offline = currentOffline ? h('div', { class: 'banner' }, `No internet right now. Showing what was last received (${updatedText(sheet.updatedAt)}).`) : null;
  if (view.passport) {
    app.replaceChildren(...passportView(sheet, offline));
    return;
  }
  if (view.credits) { app.replaceChildren(...creditsView(sheet, offline)); return; }
  if (view.rest !== undefined && !sheet.restaurants?.[view.rest]) view = { tab: 'programme' };
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
  const next = nextUp(sheet);
  // The picture behind the header: the place where the guest is (or goes next); failing that, the next tour's picture, then the first destination's.
  const placeOf = (name) => sheet.destinations?.find((d) => d.name === name);
  const art = (next && placeOf(next.day.destination)?.photo ? { url: placeOf(next.day.destination).photo } : null)
    ?? (next && next.part.kind === 'activity' && next.part.tour >= 0 ? sheet.tours?.[next.part.tour]?.info?.photos?.[0] : null)
    ?? (sheet.destinations?.[0]?.photo ? { url: sheet.destinations[0].photo } : null);
  const hero = h('header', { class: `hero${art ? ' hero--art' : ''}` },
    art ? picture(art.url, 'hero-art', '') : null,
    h('div', { class: 'hero-text' },
      sheet.company ? h('div', { class: 'company' }, sheet.company) : null,
      h('p', { class: 'sub' }, 'Hello ', h('b', {}, sheet.first), ','),
      h('h1', {}, sheet.trip)));
  app.replaceChildren(hero, tripBar(sheet), h('div', { class: 'content' }, nextCard(sheet), passportRow(sheet), installHint(), offline, staleNotice(sheet), ...programmeView(sheet), h('p', { class: 'foot' }, `Updated ${updatedText(sheet.updatedAt)}`), creditsLink(sheet)));
}

// After the link's last day the programme is no longer shown and the kept copy is erased (the server has already forgotten it).
function expired(sheet) { return !simulatedDate && /^\d{4}-\d{2}-\d{2}$/.test(sheet.expiresOn ?? '') && localToday() > sheet.expiresOn; }

// While the trip is on, a sheet nobody has refreshed for two days may be out of date (the leader's phone sends the programme, and it has been quiet).
function staleNotice(sheet) {
  if (simulatedDate || !sheet.updatedAt) return null;
  const first = sheet.days[0]; const last = sheet.days[sheet.days.length - 1];
  if (!first || todayAt(sheet, first.destination) < first.date || todayAt(sheet, last.destination) > last.date) return null;
  if (Date.now() - Date.parse(sheet.updatedAt) < 48 * 3600000) return null;
  return h('div', { class: 'banner' }, `This programme was last updated on ${updatedText(sheet.updatedAt)}. If something may have changed, please ask your tour leader.`);
}

function render(sheet, { offline = false } = {}) {
  if (expired(sheet)) { store.remove(SHEET_KEY); showProblem('This trip is over', 'Your link has expired. Thank you for travelling with us.'); return; }
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
    for (const i of part.alt ?? []) { const first = sheet.tours?.[i]?.info?.photos?.[0]; if (first) wanted.add(first.url); }
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
  if (PREVIEW) { showPreview(); return; }
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
    const todayDay = currentSheet?.days.find((d) => d.date === todayAt(currentSheet, d.destination));
    const today = todayDay ? document.getElementById(`d-${todayDay.date}`) : null;
    const group = today?.closest('.dest');
    if (group && group !== document.querySelector('.dest')) { group.scrollIntoView(); scrolledToToday = true; } // the first group is already at the top
  }
}

refresh();
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_EVERY);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('online', refresh);
window.addEventListener('hashchange', () => { scrolledToToday = false; refresh(); });

// Offline: the service worker keeps the app's own files on the phone.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
