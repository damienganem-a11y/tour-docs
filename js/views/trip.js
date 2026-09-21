// Inside a trip. Two spaces, chosen with the switch at the top:
//   Use       the day-to-day screens (bottom tabs: By destination, By guest)
//   Settings  setup and control (owner only)
//
// The screens themselves are built one step at a time (see SPEC.md "Build order"). Until then
// each one shows a short note, plus, for Use, a summary of what was loaded from the file.

import { h } from '../dom.js';
import { tripDates } from '../time.js';
import { pageHead } from './chrome.js';

// The Settings menu. `step` is the build step where each one arrives.
const SETTINGS_MENU = [
  { label: 'Destinations', step: 7 },
  { label: 'Travel parties', step: 7 },
  { label: 'Guests', step: 7 },
  { label: 'Journal', step: 4, ownerOnly: true },
  { label: 'Exports archive', step: 8 },
  { label: 'Backup', step: 9 },
];

const USE_TABS = [
  { page: 'destination', label: 'By destination', step: 2 },
  { page: 'guest', label: 'By guest', step: 2 },
];

// Route: #/trip/<id>/use/<page>  or  #/trip/<id>/settings
export function tripView(ctx, tripId, mode, page = 'destination') {
  const trip = ctx.trip(tripId);
  if (!trip) {
    return {
      node: h('div', { class: 'screen' },
        pageHead({ back: { href: '#/', label: 'All trips' }, title: 'Trip not found' }),
        h('p', { class: 'empty' }, 'This trip is not on this phone.')),
    };
  }

  const head = pageHead({
    back: { href: '#/', label: 'All trips' },
    eyebrow: 'Trip',
    title: trip.name,
    subtitle: `${tripDates(trip.start, trip.days)} · ${trip.destinations.length} destinations · ${trip.guests.length} guests`,
  });

  const link = (target, label) =>
    h('a', { class: `switch-item${mode === target ? ' is-active' : ''}`, href: `#/trip/${trip.id}/${target}` }, label);
  const modeSwitch = h('nav', { class: 'switch', 'aria-label': 'Use or Settings' }, link('use', 'Use'), link('settings', 'Settings'));

  const parts = [head, modeSwitch];

  if (mode === 'settings') {
    parts.push(settingsMenu());
  } else {
    const active = USE_TABS.find((t) => t.page === page) ?? USE_TABS[0];
    parts.push(
      h('div', { class: 'card' },
        h('h2', {}, active.label),
        h('p', { class: 'muted' }, `This screen is built in step ${active.step}. The trip itself is loaded and saved on this phone.`)
      ),
      loadedSummary(trip),
      h('nav', { class: 'bottom-tabs', 'aria-label': 'Use screens' },
        USE_TABS.map((t) =>
          h('a', { class: `bottom-tab${t === active ? ' is-active' : ''}`, href: `#/trip/${trip.id}/use/${t.page}` }, t.label)))
    );
  }

  return { node: h('div', { class: 'screen' }, parts) };
}

function settingsMenu() {
  return h('div', { class: 'menu' },
    SETTINGS_MENU.map((item) =>
      h('div', { class: 'menu-row is-soon' },
        h('span', {}, item.label),
        h('span', { class: 'menu-side' },
          item.ownerOnly ? h('span', { class: 'muted' }, 'Owner only') : null,
          h('span', { class: 'pill' }, `Step ${item.step}`)))));
}

// What was read from the file: a quick check that everything arrived. Removed once the real screens exist.
function loadedSummary(trip) {
  const cells = Object.values(trip.bookings).flatMap((row) => Object.values(row));
  const count = (kind) => cells.filter((c) => c.kind === kind).length;

  return h('div', { class: 'card' },
    h('h2', {}, 'Loaded from the file'),
    h('p', { class: 'muted' },
      `${trip.guests.length} guests · ${trip.parties.length} travel parties · ${trip.slots.length} half-days · ${trip.activities.length} activities`),
    h('p', { class: 'muted' },
      `${count('activity')} bookings on activities · ${count('leisure')} at leisure · ${count('unknown')} unknown activity`),
    h('div', { class: 'card-sub' }, 'Destinations and their time zones'),
    trip.destinations.map((d) => h('div', { class: 'line' }, h('span', {}, d.name), h('span', { class: 'muted' }, d.timeZone)))
  );
}
