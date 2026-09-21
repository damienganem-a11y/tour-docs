// Inside a trip. Two spaces, chosen with the switch at the top:
//   Use       the day-to-day screens (bottom tabs: By destination, By guest)
//   Settings  setup and control (owner only)
//
// The Settings screens are built one step at a time (see SPEC.md "Build order"); until then the
// menu shows which step each one arrives in.

import { h } from '../dom.js';
import { tripDates } from '../time.js';
import { pageHead } from './chrome.js';
import { destinationPage } from './destination.js';
import { guestPage } from './guest.js';

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
  { page: 'destination', label: 'By destination' },
  { page: 'guest', label: 'By guest' },
];

// Routes:  #/trip/<id>/use/destination/<destinationId>/<slotId>
//          #/trip/<id>/use/guest/<guestId>
//          #/trip/<id>/settings
// `first` and `second` are the parts after the page name (they may be missing).
export function tripView(ctx, tripId, mode, page = 'destination', first, second) {
  const trip = ctx.trip(tripId);
  if (!trip) {
    return {
      node: h('div', { class: 'screen' },
        pageHead({ back: { href: '#/', label: 'All trips' }, title: 'Trip not found' }),
        h('p', { class: 'empty' }, 'This trip is not on this phone.')),
    };
  }

  const link = (target, label) =>
    h('a', { class: `switch-item${mode === target ? ' is-active' : ''}`, href: `#/trip/${trip.id}/${target}` }, label);
  const modeSwitch = h('nav', { class: 'switch', 'aria-label': 'Use or Settings' }, link('use', 'Use'), link('settings', 'Settings'));

  // Settings: the full trip heading and the menu.
  if (mode === 'settings') {
    const head = pageHead({
      back: { href: '#/', label: 'All trips' },
      eyebrow: 'Trip',
      title: trip.name,
      subtitle: `${tripDates(trip.start, trip.days)} · ${trip.destinations.length} destinations · ${trip.guests.length} guests`,
    });
    return { node: h('div', { class: 'screen' }, head, modeSwitch, settingsMenu()) };
  }

  // Use: a slim bar on top (the phone screen is small), then the chosen page and the bottom tabs.
  const topBar = h('div', { class: 'top-bar' },
    h('a', { class: 'back-link', href: '#/' }, '‹ All trips'),
    h('span', { class: 'muted' }, trip.ref));
  const content = page === 'guest' ? guestPage(ctx, trip, first) : destinationPage(ctx, trip, first, second);
  const activePage = page === 'guest' ? 'guest' : 'destination';
  const tabs = h('nav', { class: 'bottom-tabs', 'aria-label': 'Use screens' },
    USE_TABS.map((t) =>
      h('a', { class: `bottom-tab${t.page === activePage ? ' is-active' : ''}`, href: `#/trip/${trip.id}/use/${t.page}` }, t.label)));

  return { node: h('div', { class: 'screen' }, topBar, modeSwitch, content, tabs) };
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
