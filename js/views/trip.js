// Inside a trip. Two spaces, chosen with the switch at the top:
//   Use       the day-to-day screens (bottom tabs: Touring, Dining, By guest)
//   Settings  setup and control (owner only)
//
// Touring and Dining are two clearly separate places to work in (owner's call, 24 Sep 2026): not
// every destination has dine-around, so folding restaurants into "By destination" would mean
// clutter on most destinations. Touring keeps the old "By destination" internal route name
// (`destination`) and behavior — only its label changed; Dining is new (dining.js).
//
// The Settings screens are built one step at a time (see SPEC.md "Build order"); until then the
// menu shows which step each one arrives in.

import { h } from '../dom.js';
import { tripDates } from '../time.js';
import { pageHead, syncDot } from './chrome.js';
import { destinationPage } from './destination.js';
import { diningPage } from './dining.js';
import { guestPage } from './guest.js';
import { journalPage } from './journal.js';
import { touringSettingsPage } from './settingsTouring.js';
import { diningSettingsPage } from './settingsDining.js';
import { partiesSettingsPage } from './settingsParties.js';
import { guestsSettingsPage } from './settingsGuests.js';
import { exportsSettingsPage } from './settingsExports.js';
import { warningsSettingsPage } from './settingsWarnings.js';
import { backupSettingsPage } from './settingsBackup.js';
import { brandSettingsPage } from './settingsBrand.js';
import { groupsSettingsPage } from './settingsGroups.js';
import { teamSettingsPage } from './settingsTeam.js';
import { guestLinksSettingsPage } from './settingsGuestLinks.js';
import { guestAppSettingsPage } from './settingsGuestApp.js';
import { requestsSettingsPage } from './settingsRequests.js';
import { notice } from './move.js';
import { openPreviewSheet } from './preview.js';
import { icon } from './icons.js';

// The Settings menu, in four groups so it reads at a glance. `hint` is the one line under each name. `page` is the screen it opens.
const SETTINGS_SECTIONS = [
  { key: 'setup', icon: 'setup', title: 'Trip set-up', blurb: 'Tours, dining, guests and groups', items: [
    { label: 'Touring', page: 'touring', hint: 'Destinations, tours, times, meeting points, guest information' },
    { label: 'Dining', page: 'dining', hint: 'Restaurants, seatings and tables' },
    { label: 'Guests', page: 'guests', hint: 'Names, travel parties, who left the trip' },
    { label: 'Travel parties', page: 'parties', hint: 'Who travels together' },
    { label: 'Groups', page: 'groups', hint: 'Bus groups, boats, guided tours' },
  ] },
  { key: 'access', icon: 'people', title: 'People and access', blurb: 'Team, requests and guest links', items: [
    { label: 'Team', page: 'team', ownerOnly: true, hint: 'Colleagues, their role, test access' },
    { label: 'Requests', page: 'requests', hint: 'Changes asked for by the team' },
    { label: 'Guest links', page: 'guestlinks', ownerOnly: true, hint: 'A personal link and QR code for each guest' },
    { label: 'Guest app', page: 'guestapp', ownerOnly: true, hint: 'Notifications, messages to guests, other options, message after the trip' },
  ] },
  { key: 'documents', icon: 'documents', title: 'Documents and look', blurb: 'Exports and brand', items: [
    { label: 'Documents', page: 'exports', hint: 'Create lists, cards and sheets, and find every one already made' },
    { label: 'Company look', page: 'brand', hint: 'Company name, logo and colour on documents and in the guest app' },
  ] },
  { key: 'control', icon: 'control', title: 'Control', blurb: 'Warnings, journal and backup', items: [
    { label: 'Warnings', page: 'warnings', hint: 'Anything that needs your attention' },
    { label: 'Journal', page: 'journal', ownerOnly: true, hint: 'Every change, with who and when' },
    { label: 'Backup', page: 'backup', hint: 'Save or restore the whole trip' },
    { label: 'Preview as…', preview: true, ownerOnly: true, hint: 'See what a view-only person, a colleague or a guest sees' },
  ] },
];

const USE_TABS = [
  { page: 'destination', label: 'Touring' },
  { page: 'dining', label: 'Dining' },
  { page: 'guest', label: 'By guest' },
];

// Routes:  #/trip/<id>/use/destination/<destinationId>/<slotId>
//          #/trip/<id>/use/dining/<destinationId>/<slotId>/<restaurantId>/<seating>   By table (step 2b)
//          #/trip/<id>/use/guest/<guestId>
//          #/trip/<id>/settings
//          #/trip/<id>/settings/journal
// `first` and `second` are the parts after the page name (they may be missing); Dining alone also
// takes `third`/`fourth` (a restaurant and seating, for its "By table" grid).
export function tripView(ctx, tripId, mode, page = 'destination', first, second, third, fourth) {
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
  if (mode === 'settings' && page === 'touring') {
    return { node: h('div', { class: 'screen' }, touringSettingsPage(ctx, trip, first)) };
  }
  if (mode === 'settings' && page === 'dining') {
    return { node: h('div', { class: 'screen' }, diningSettingsPage(ctx, trip)) };
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
  if (mode === 'settings' && page === 'groups') {
    return { node: h('div', { class: 'screen' }, groupsSettingsPage(ctx, trip, first)) };
  }
  if (mode === 'settings' && page === 'brand') {
    return { node: h('div', { class: 'screen' }, brandSettingsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'requests') {
    return { node: h('div', { class: 'screen' }, requestsSettingsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'team') {
    return { node: h('div', { class: 'screen' }, teamSettingsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'section') {
    return { node: h('div', { class: 'screen' }, settingsSection(ctx, trip, first)) };
  }
  if (mode === 'settings' && page === 'guestapp') {
    return { node: h('div', { class: 'screen' }, guestAppSettingsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'guestlinks') {
    return { node: h('div', { class: 'screen' }, guestLinksSettingsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'backup') {
    return { node: h('div', { class: 'screen' }, backupSettingsPage(ctx, trip)) };
  }

  // One slim row, for both modes. Use: the trip's name (so you know where you are) and, on the left a cog that opens Settings (easier with one thumb, owner's request 4 Oct 2026), on the right the sync light.
  // Settings: a way back to the trip. Changing trip lives in Settings (owner's request, 3 Oct 2026): once in a trip, you stay in it.
  const topBar = mode === 'settings'
    ? h('div', { class: 'top-bar' },
        h('a', { class: 'cog cog--home', href: `#/trip/${trip.id}/use`, 'aria-label': 'Back to the trip' }, icon('setup')),
        h('span', { class: 'top-trip' }, 'Settings'),
        h('span', { class: 'top-side' }, syncDot(ctx, { compact: true })))
    : h('div', { class: 'top-bar' },
        h('a', { class: 'cog', href: `#/trip/${trip.id}/settings`, 'aria-label': 'Settings' }, icon('cog')),
        h('span', { class: 'top-trip' }, trip.ref || trip.name),
        h('span', { class: 'top-side' }, syncDot(ctx, { compact: true })));

  // An archived trip stays fully viewable (views, journal, exports) but is read-only: no booking changes,
  // no roll call. The single change function already refuses those; this is just so it is seen at a glance.
  const readOnlyNotice = trip.archivedAt
    ? notice('This trip is archived: read-only. Un-archive it on the Trips screen to make changes again.')
    : ctx.roleFor(trip.id) === 'viewer'
      ? notice('You can look at this trip, but only its owner can change it.')
      : ctx.roleFor(trip.id) === 'team'
        ? notice('You are on the team: the changes you make are sent to the owner as requests, and applied there.')
        : null;

  // Settings: the full trip heading and the menu.
  if (mode === 'settings') {
    const head = pageHead({
      eyebrow: 'Trip',
      title: trip.name,
      subtitle: `${tripDates(trip.start, trip.days)} · ${trip.destinations.length} destinations · ${trip.guests.length} guests`,
    });
    return { node: h('div', { class: 'screen' }, topBar, head, readOnlyNotice, settingsMenu(ctx, trip)) };
  }

  // Use: the chosen page and the bottom tabs. (The Undo button is inside each page, next to its title.)
  const content = page === 'guest' ? guestPage(ctx, trip, first)
    : page === 'dining' ? diningPage(ctx, trip, first, second, third, fourth)
    : destinationPage(ctx, trip, first, second);
  const activePage = page === 'guest' ? 'guest' : page === 'dining' ? 'dining' : 'destination';
  const tabs = h('nav', { class: 'bottom-tabs', 'aria-label': 'Use screens' },
    USE_TABS.map((t) =>
      h('a', { class: `bottom-tab${t.page === activePage ? ' is-active' : ''}`, href: `#/trip/${trip.id}/use/${t.page}` }, t.label)));

  return { node: h('div', { class: 'screen' }, topBar, readOnlyNotice, content, tabs) };
}

// Which Settings entries this person may open (owner-only ones are hidden from everybody else).
function visibleItems(ctx, trip, section) {
  const role = ctx.roleFor(trip.id);
  const visible = (item) => (item.preview ? role === 'owner' : (item.page === 'team' || item.page === 'guestlinks' || item.page === 'guestapp') ? role === 'owner' : item.page === 'requests' ? role !== 'viewer' : true);
  return section.items.filter(visible);
}

// The Settings home: four big tiles (a picture and a word each); a tap opens that group's list.
function settingsMenu(ctx, trip) {
  const role = ctx.roleFor(trip.id);
  return h('div', {},
    h('div', { class: 'tiles' }, SETTINGS_SECTIONS.map((section) => {
      const items = visibleItems(ctx, trip, section);
      if (items.length === 0) return null;
      const waitingGuests = section.key === 'access' && role === 'owner' ? ctx.guestRequestsFor(trip.id).filter((r) => r.status === 'pending').length : 0;
      return h('a', { class: `tile tile--${section.key}`, href: `#/trip/${trip.id}/settings/section/${section.key}` },
        waitingGuests > 0 ? h('span', { class: 'tile-badge', 'aria-label': `${waitingGuests} guest requests waiting` }, String(waitingGuests)) : null,
        h('span', { class: 'tile-icon' }, icon(section.icon)),
        h('span', { class: 'tile-title' }, section.title),
        h('span', { class: 'tile-blurb' }, section.blurb));
    })),
    h('a', { class: 'btn btn--plain change-trip', href: '#/' }, 'Change trip'),
    null);
}

// One group of Settings: its entries as a list, with a way back to the four tiles.
function settingsSection(ctx, trip, key) {
  const section = SETTINGS_SECTIONS.find((x) => x.key === key) ?? SETTINGS_SECTIONS[0];
  return h('div', {},
    pageHead({ back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' }, eyebrow: 'Settings', title: section.title, subtitle: section.blurb }),
    h('div', { class: 'menu' }, visibleItems(ctx, trip, section).map((item) =>
      h(item.preview ? 'button' : 'a', item.preview ? { class: 'menu-row', type: 'button', onclick: () => openPreviewSheet(ctx, trip) } : { class: 'menu-row', href: `#/trip/${trip.id}/settings/${item.page}` },
        h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, item.label), item.hint ? h('span', { class: 'menu-hint' }, item.hint) : null),
        h('span', { class: 'menu-side' }, item.ownerOnly ? h('span', { class: 'muted' }, 'Owner only') : null,
          item.page === 'requests' && ctx.roleFor(trip.id) === 'owner' && ctx.guestRequestsFor(trip.id).some((r) => r.status === 'pending') ? h('span', { class: 'tile-badge tile-badge--row' }, String(ctx.guestRequestsFor(trip.id).filter((r) => r.status === 'pending').length)) : null,
          h('span', { class: 'row-chev' }, '›'))))));
}
