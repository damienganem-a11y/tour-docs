// Guests > "Allergies & diets" (v0.153.0, owner's request of 11 Nov 2026: "we handle a lot"). Every guest with an allergy or a dietary need, with their
// face, so they can be found in a restaurant or at a buffet. Filters: the need (Nuts, Gluten, Vegan...), and where they are today (a tour, a restaurant).
// A need written as dangerous (anaphylaxis, EpiPen, severe) comes first, in red. This page only READS: the needs are written in Settings > Guests,
// or on a guest's page. Nothing here goes into an export or the journal.

import { h } from '../dom.js';
import { displayNames, guestPlace, plain, partyLabel } from '../rules.js';
import { pageHead } from './chrome.js';
import { dietaryList } from '../dietary.js';
import { face } from './faceUi.js';
import { putIn } from '../put.js';

let tagFilter = null;   // kept while the app is open
let whereFilter = 'all';

// Today's half-days (each in its own place's time zone); with none today, none (the "where" filter is then hidden).
function slotsOfToday(trip, now = new Date()) {
  return trip.slots.filter((s) => {
    const zone = trip.destinations.find((d) => d.id === s.destinationId)?.timeZone ?? 'UTC';
    return s.date && s.date === new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  });
}

// Where each guest is today: [{ key, label, ids:Set }], one per tour and per restaurant of today.
function placesOfToday(trip) {
  const places = new Map();
  for (const slot of slotsOfToday(trip)) {
    for (const g of trip.guests.filter((x) => !x.leftAt)) {
      const p = guestPlace(trip, g, slot);
      const key = p.kind === 'activity' ? `a:${p.activity.id}` : p.kind === 'dinner' ? `d:${p.booking.id}` : null;
      if (!key) continue;
      const label = p.kind === 'activity' ? `${slot.half}: ${p.activity.name}` : `Dinner: ${p.restaurant.name}${p.booking.seating ? `, ${p.booking.seating}` : ''}`;
      if (!places.has(key)) places.set(key, { key, label, ids: new Set() });
      places.get(key).ids.add(g.id);
    }
  }
  return [...places.values()];
}

export function allergiesPage(ctx, trip) {
  const names = displayNames(trip.guests);
  const { rows, counts, other } = dietaryList(trip.guests, (g) => names.get(g.id));
  const places = placesOfToday(trip);
  if (!places.some((p) => p.key === whereFilter)) whereFilter = 'all';
  if (tagFilter && tagFilter !== 'Other' && !counts.some(([t]) => t === tagFilter)) tagFilter = null;

  const listBox = h('div', { class: 'diet-list' });
  const countLine = h('p', { class: 'muted count-line' });
  const search = h('input', { class: 'text-input', type: 'search', placeholder: 'Search a name or a word (e.g. sesame)', 'aria-label': 'Search', autocomplete: 'off' });

  function draw() {
    const words = plain(search.value).split(/\s+/).filter(Boolean);
    const here = places.find((p) => p.key === whereFilter);
    const shown = rows.filter((r) => (!tagFilter || (tagFilter === 'Other' ? r.tags.length === 0 : r.tags.includes(tagFilter)))
      && (!here || here.ids.has(r.guest.id))
      && words.every((w) => plain(`${r.guest.first} ${r.guest.last} ${r.text}`).includes(w)));
    countLine.textContent = rows.length === 0 ? '' : `${shown.length} guest${shown.length === 1 ? '' : 's'}${here ? ` · ${here.label}` : ''}`;
    putIn(listBox, ...(rows.length === 0
      ? [h('p', { class: 'empty' }, 'No guest has an allergy or a dietary need written down. They are written in Settings › Guests, on each guest.')]
      : shown.length === 0 ? [h('p', { class: 'empty' }, 'Nobody matches.')]
      : shown.map((r) => h('a', { class: `diet-row${r.severe ? ' diet-row--severe' : ''}`, href: `#/trip/${trip.id}/use/guest/${r.guest.id}` },
          face(r.guest, 64),
          h('span', { class: 'diet-main' },
            h('span', { class: 'diet-name' }, names.get(r.guest.id), r.guest.seat ? h('small', {}, ` · Seat ${r.guest.seat}`) : null),
            r.severe ? h('span', { class: 'diet-severe' }, 'Severe') : null,
            h('span', { class: 'diet-text' }, r.text),
            h('span', { class: 'diet-party' }, partyLabel(trip, r.guest, names)))))));
  }
  search.addEventListener('input', draw);

  const chip = (label, value, n) => h('button', { class: `strip-item${tagFilter === value ? ' is-active' : ''}`, type: 'button', 'aria-pressed': String(tagFilter === value),
    onclick: () => { tagFilter = tagFilter === value ? null : value; ctx.refresh(); } }, n === undefined ? label : `${label} · ${n}`);

  draw();
  return h('div', {},
    pageHead({ back: { href: `#/trip/${trip.id}/use/guest`, label: 'Guests' }, title: 'Allergies & diets', subtitle: rows.length ? `${rows.length} guest${rows.length === 1 ? '' : 's'} with a need. Tap one to see their trip.` : null }),
    rows.length ? h('nav', { class: 'strip strip--small', 'aria-label': 'Which need' }, chip('All', null), counts.map(([tag, n]) => chip(tag, tag, n)), other ? chip('Other', 'Other', other) : null) : null,
    places.length ? h('select', { class: 'text-input', 'aria-label': 'Where today', onchange: (e) => { whereFilter = e.target.value; ctx.refresh(); } },
      h('option', { value: 'all', selected: whereFilter === 'all' ? '' : null }, 'Everyone on the trip'),
      places.map((p) => h('option', { value: p.key, selected: whereFilter === p.key ? '' : null }, `Today · ${p.label}`))) : null,
    rows.length > 6 ? search : null,
    countLine, listBox,
    h('p', { class: 'muted footer-note' }, 'Private: never in the journal, never in a list you send (except a restaurant sheet, when you tick it). Erased when the trip is archived.'));
}
