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
import { journalPage } from './journal.js';

// The Settings menu. `step` is the build step where each one arrives; `page` is the screen once it exists.
const SETTINGS_MENU = [
  { label: 'Destinations', step: 7 },
  { label: 'Travel parties', step: 7 },
  { label: 'Guests', step: 7 },
  { label: 'Journal', page: 'journal', ownerOnly: true },
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
//          #/trip/<id>/settings/journal
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

  // Settings > Journal is a screen of its own.
  if (mode === 'settings' && page === 'journal') {
    return { node: h('div', { class: 'screen' }, journalPage(ctx, trip)) };
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
    return { node: h('div', { class: 'screen' }, head, modeSwitch, settingsMenu(trip)) };
  }

  // Use: a slim bar on top (the phone screen is small), then the chosen page and the bottom tabs.
  // (The Undo button is inside each page, next to its title.)
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

function settingsMenu(trip) {
  return h('div', { class: 'menu' },
    SETTINGS_MENU.map((item) => {
      // A screen that exists is a link; one that does not exist yet says in which step it arrives.
      if (item.page) {
        return h('a', { class: 'menu-row', href: `#/trip/${trip.id}/settings/${item.page}` },
          h('span', {}, item.label),
          h('span', { class: 'menu-side' }, item.ownerOnly ? h('span', { class: 'muted' }, 'Owner only') : null, h('span', { class: 'row-chev' }, '›')));
      }
      return h('div', { class: 'menu-row is-soon' },
        h('span', {}, item.label),
        h('span', { class: 'menu-side' }, h('span', { class: 'pill' }, `Step ${item.step}`)));
    }));
}
