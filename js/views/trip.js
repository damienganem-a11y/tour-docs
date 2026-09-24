// Inside a trip. Two spaces, chosen with the switch at the top:
//   Use       the day-to-day screens (bottom tabs: By destination, By guest)
//   Settings  setup and control (owner only)
//
// The Settings screens are built one step at a time (see SPEC.md "Build order"); until then the
// menu shows which step each one arrives in.

import { h } from '../dom.js';
import { tripDates } from '../time.js';
import { pageHead, syncDot } from './chrome.js';
import { destinationPage } from './destination.js';
import { guestPage } from './guest.js';
import { journalPage } from './journal.js';
import { destinationsSettingsPage } from './settingsDestinations.js';
import { partiesSettingsPage } from './settingsParties.js';
import { guestsSettingsPage } from './settingsGuests.js';
import { exportsSettingsPage } from './settingsExports.js';
import { warningsSettingsPage } from './settingsWarnings.js';
import { backupSettingsPage } from './settingsBackup.js';
import { notice } from './move.js';

// The Settings menu. `step` is the build step where each one arrives; `page` is the screen once it exists.
const SETTINGS_MENU = [
  { label: 'Destinations', page: 'destinations' },
  { label: 'Travel parties', page: 'parties' },
  { label: 'Guests', page: 'guests' },
  { label: 'Journal', page: 'journal', ownerOnly: true },
  { label: 'Exports archive', page: 'exports' },
  { label: 'Warnings', page: 'warnings' },
  { label: 'Backup', page: 'backup' },
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

  // Each Settings screen beyond the menu is its own page.
  if (mode === 'settings' && page === 'journal') {
    return { node: h('div', { class: 'screen' }, journalPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'destinations') {
    return { node: h('div', { class: 'screen' }, destinationsSettingsPage(ctx, trip, first)) };
  }
  if (mode === 'settings' && page === 'parties') {
    return { node: h('div', { class: 'screen' }, partiesSettingsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'guests') {
    return { node: h('div', { class: 'screen' }, guestsSettingsPage(ctx, trip, first)) };
  }
  if (mode === 'settings' && page === 'exports') {
    return { node: h('div', { class: 'screen' }, exportsSettingsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'warnings') {
    return { node: h('div', { class: 'screen' }, warningsSettingsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'backup') {
    return { node: h('div', { class: 'screen' }, backupSettingsPage(ctx, trip)) };
  }

  const link = (target, label) =>
    h('a', { class: `switch-item${mode === target ? ' is-active' : ''}`, href: `#/trip/${trip.id}/${target}` }, label);
  const modeSwitch = h('nav', { class: 'switch switch--compact', 'aria-label': 'Use or Settings' }, link('use', 'Use'), link('settings', 'Settings'));

  // One slim row for both modes: back link, the Use/Settings switch (small — it is tapped rarely,
  // so it should not compete with the actual screen for room), the trip's own code (Use only), and
  // the sync light (Phase 2, step 2a) — compact here (dots only, no word) since this row is already
  // tight; the full light-plus-word version lives on the roomier Trips screen header.
  const topBar = h('div', { class: 'top-bar' },
    h('a', { class: 'back-link', href: '#/' }, '‹ All trips'),
    modeSwitch,
    mode === 'use' ? h('span', { class: 'muted' }, trip.ref) : null,
    syncDot(ctx, { compact: true }));

  // An archived trip stays fully viewable (views, journal, exports) but is read-only: no booking changes,
  // no roll call. The single change function already refuses those; this is just so it is seen at a glance.
  const readOnlyNotice = trip.archivedAt
    ? notice('This trip is archived: read-only. Un-archive it on the Trips screen to make changes again.')
    : null;

  // Settings: the full trip heading and the menu.
  if (mode === 'settings') {
    const head = pageHead({
      eyebrow: 'Trip',
      title: trip.name,
      subtitle: `${tripDates(trip.start, trip.days)} · ${trip.destinations.length} destinations · ${trip.guests.length} guests`,
    });
    return { node: h('div', { class: 'screen' }, topBar, head, readOnlyNotice, settingsMenu(trip)) };
  }

  // Use: the chosen page and the bottom tabs. (The Undo button is inside each page, next to its title.)
  const content = page === 'guest' ? guestPage(ctx, trip, first) : destinationPage(ctx, trip, first, second);
  const activePage = page === 'guest' ? 'guest' : 'destination';
  const tabs = h('nav', { class: 'bottom-tabs', 'aria-label': 'Use screens' },
    USE_TABS.map((t) =>
      h('a', { class: `bottom-tab${t.page === activePage ? ' is-active' : ''}`, href: `#/trip/${trip.id}/use/${t.page}` }, t.label)));

  return { node: h('div', { class: 'screen' }, topBar, readOnlyNotice, content, tabs) };
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
