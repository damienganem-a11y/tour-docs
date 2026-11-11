// Inside a trip. Two spaces, chosen with the switch at the top:
//   Use       the day-to-day screens (bottom tabs: Today, Tours, Guests, More)
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
import { todayPage, myJobItems } from './today.js';
import { jobDotCount } from '../teamJobs.js';
import { programSettingsPage } from './settingsProgram.js';
import { notificationsPage, appearancePage } from './settingsPhone.js';
import { avatarButton, openAccountSheet } from './accountSheet.js';
import { partyPage } from './party.js';
import { openFullScreen, openSheet, closeSheet } from '../ui.js';
import { teamLabel } from '../rules.js';
import { journalPage } from './journal.js';
import { touringSettingsPage } from './settingsTouring.js';
import { diningSettingsPage } from './settingsDining.js';
import { partiesSettingsPage } from './settingsParties.js';
import { guestsSettingsPage } from './settingsGuests.js';
import { exportsSettingsPage } from './settingsExports.js';
import { warningsSettingsPage } from './settingsWarnings.js';
import { sendSheet } from './sendSheet.js';
import { messagesPage } from './messages.js';
import { helpButton } from './help.js';
import { openPractice } from './practice.js';
import { inboxCount } from '../inbox.js';
import { checkSettingsPage } from './settingsCheck.js';
import { backupSettingsPage } from './settingsBackup.js';
import { brandSettingsPage } from './settingsBrand.js';
import { groupsSettingsPage } from './settingsGroups.js';
import { togetherSettingsPage } from './settingsTogether.js';
import { contactsSettingsPage } from './settingsContacts.js';
import { displaysSettingsPage } from './settingsDisplays.js';
import { exploreListPage, exploreDestinationPage } from './settingsExplore.js';
import { teamSettingsPage } from './settingsTeam.js';
import { guestLinksSettingsPage } from './settingsGuestLinks.js';
import { guestAppSettingsPage } from './settingsGuestApp.js';
import { albumSettingsPage } from './settingsAlbum.js';
import { guestMessagesSettingsPage } from './settingsGuestMessages.js';
import { scheduledSettingsPage } from './settingsScheduled.js';
import { requestsSettingsPage } from './settingsRequests.js';
import { notice } from './move.js';
import { inboxList, attentionCount } from '../chat.js';
import { openPreviewSheet } from './preview.js';
import { icon } from './icons.js';

// The Settings menu, in four groups so it reads at a glance. `hint` is the one line under each name. `page` is the screen it opens.
const SETTINGS_SECTIONS = [
  { key: 'setup', icon: 'setup', title: 'Trip set-up', blurb: 'Tours, maps, dining and guests', items: [
    { label: 'Touring', page: 'touring', hint: 'Destinations, tours, times, meeting points, guest information' },
    { label: 'Explore maps', page: 'explore', hint: 'The guests\' map of each stop: where the ship is, your restaurants and sights, works offline' },
    { label: 'Dining', page: 'dining', hint: 'Restaurants, seatings and tables' },
    { label: 'Guests', page: 'guests', hint: 'Names, travel parties, groups, who left the trip' },
  ] },
  { key: 'access', icon: 'people', title: 'People and access', blurb: 'Team, requests and guest links', items: [
    { label: 'Team', page: 'team', ownerOnly: true, hint: 'Colleagues, their role, test access' },
    { label: 'Requests', page: 'requests', hint: 'Changes asked for by the team' },
    { label: 'Guest links', page: 'guestlinks', ownerOnly: true, hint: 'A personal link and QR code for each guest' },
    { label: 'Reception & screens', page: 'displays', ownerOnly: true, hint: 'Live tour lists for the reception desk and the lounge TV' },
    { label: 'Local team', page: 'localteam', hint: 'Guides and drivers of the local agency, tour by tour: call, WhatsApp, reconfirm' },
    { label: 'Our Album', page: 'album', hint: 'Guests\' photo circle: add photos, favourites, who has downloaded' },
    { label: 'Guest app', page: 'guestapp', ownerOnly: true, hint: 'Notifications, messages to guests, other options, message after the trip' },
  ] },
  { key: 'documents', icon: 'documents', title: 'Documents and look', blurb: 'Exports, brand and the rest', items: [
    { label: 'Documents', page: 'exports', hint: 'Create lists, cards and sheets, and find every one already made' },
    { label: 'Company look', page: 'brand', hint: 'Company name, logo and colour on documents and in the guest app' },
    { label: 'Advanced', page: 'section/advanced', hint: 'Warnings, journal, backup, preview' },
  ] },
  { key: 'phone', icon: 'cog', title: 'This phone', blurb: 'Check, notifications and look', items: [
    { label: 'Check this phone', page: 'check', hint: 'What works on this device and what does not' },
    { label: 'Notifications', page: 'notifications', hint: 'Turn them on, send a test' },
    { label: 'Text size and look', page: 'appearance', hint: 'Larger letters, light or dark' },
  ] },
  // Not a tile of its own: reached from "Advanced".
  { key: 'advanced', icon: 'control', title: 'Advanced', blurb: 'Warnings, journal and backup', hidden: true, items: [
    { label: 'Warnings', page: 'warnings', hint: 'Anything that needs your attention' },
    { label: 'Journal', page: 'journal', ownerOnly: true, hint: 'Every change, with who and when' },
    { label: 'Backup', page: 'backup', hint: 'Save or restore the whole trip' },
    { label: 'Preview as…', preview: true, ownerOnly: true, hint: 'See what a view-only person, a colleague or a guest sees' },
  ] },
];

// Four tabs: Today, Tours (Touring and Dining, with a switch at the top), Guests, Messages. Each has a picture AND a word (v0.151.0, owner's
// decision of 10 Nov 2026: Messages is a tab for everyone; what used to be the "More" tab is behind "Menu" at the top right).
const USE_TABS = [
  { tab: 'today', pages: ['today'], label: 'Today', icon: 'today', href: (id) => `#/trip/${id}/use/today` },
  { tab: 'tours', pages: ['destination', 'dining'], label: 'Tours', icon: 'tours', href: (id) => `#/trip/${id}/use/destination` },
  { tab: 'guest', pages: ['guest', 'party'], label: 'Guests', icon: 'guests', href: (id) => `#/trip/${id}/use/guest` },
  { tab: 'messages', pages: ['messages'], label: 'Messages', icon: 'messages', href: (id) => `#/trip/${id}/use/messages` },
];

// How many things wait for this person in Messages: guests' conversations to answer, and everything the inbox counts (requests, a free seat, team messages not read).
function messagesWaiting(ctx, trip) {
  return inboxCount(ctx.inboxFor(trip.id));
}

// Routes:  #/trip/<id>/use/destination/<destinationId>/<slotId>
//          #/trip/<id>/use/dining/<destinationId>/<slotId>/<restaurantId>/<seating>   By table (step 2b)
//          #/trip/<id>/use/guest/<guestId>
//          #/trip/<id>/settings
//          #/trip/<id>/settings/journal
// `first` and `second` are the parts after the page name (they may be missing); Dining alone also
// takes `third`/`fourth` (a restaurant and seating, for its "By table" grid).
// The bottom tabs, on the use screens AND on the settings screens (where none is active): the same four choices everywhere.
function tabsNav(ctx, trip, activeTab) {
  const waiting = messagesWaiting(ctx, trip);
  return h('nav', { class: 'bottom-tabs', 'aria-label': 'Main menu' },
    USE_TABS.map((t) =>
      h('a', { class: `bottom-tab${t.tab === activeTab ? ' is-active' : ''}`, href: t.href(trip.id), 'aria-current': t.tab === activeTab ? 'page' : null },
        h('span', { class: 'bottom-tab-icon' }, icon(t.icon),
          // The red dot on Today: job items waiting for this person (owner's report of 5 Nov 2026). The red number on Messages: what waits for an answer.
          t.tab === 'today' && jobDotCount(myJobItems(ctx, trip)) > 0 ? h('span', { class: 'tab-dot', 'aria-label': `${jobDotCount(myJobItems(ctx, trip))} job items waiting` }) : null,
          t.tab === 'messages' && waiting > 0 ? h('span', { class: 'tab-count', 'aria-label': `${waiting} waiting` }, String(waiting > 9 ? '9+' : waiting)) : null),
        h('span', { class: 'bottom-tab-label' }, t.label))));
}

// "Menu" at the top right: everything that is not daily work. Words, not pictures (v0.151.0).
function openTripMenu(ctx, trip) {
  const role = ctx.roleFor(trip.id);
  const row = (title, hint, run) => h('button', { class: 'menu-row', type: 'button', onclick: () => { closeSheet(); run(); } },
    h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, title), hint ? h('span', { class: 'menu-hint' }, hint) : null),
    h('span', { class: 'menu-side' }, h('span', { class: 'row-chev' }, '›')));
  openSheet({
    eyebrow: trip.ref || 'Trip', title: 'Menu', cancelLabel: 'Close',
    body: h('div', { class: 'menu' },
      role === 'viewer' ? null : row('Send a list or a sheet', 'Guest lists, reservation sheets, as PDF or Excel', () => sendSheet(ctx, trip)),
      role === 'viewer' ? null : row('Settings', ctx.simpleFor(trip.id) ? 'Documents, requests, this phone' : 'Set-up, team, documents, this phone', () => ctx.go(`#/trip/${trip.id}/settings`)),
      row('Change trip', 'Back to the list of your trips', () => ctx.go('#/')),
      row('This phone and my account', 'Notifications, Face ID, sign out', () => openAccountSheet(ctx))),
  });
}

export function tripView(ctx, tripId, mode, page, first, second, third, fourth) {
  // The two older addresses of the messages (links in notifications still use them) open the Messages tab.
  if (mode === 'settings' && (page === 'messages' || page === 'guestmessages')) { first = page === 'messages' ? 'team' : 'guests'; mode = 'use'; page = 'messages'; }
  const result = tripViewInner(ctx, tripId, mode, page, first, second, third, fourth);
  const trip = ctx.trip(tripId);
  if (mode === 'settings' && trip && ctx.roleFor(trip.id) !== 'viewer' && result.node) result.node.append(tabsNav(ctx, trip, null));
  return result;
}

function tripViewInner(ctx, tripId, mode, page = 'today', first, second, third, fourth) {
  const trip = ctx.trip(tripId);
  if (!trip) {
    return {
      node: h('div', { class: 'screen' },
        pageHead({ back: { href: '#/', label: 'All trips' }, title: 'Trip not found' }),
        h('p', { class: 'empty' }, 'This trip is not on this phone.')),
    };
  }

  // Each Settings screen beyond the menu is its own page.
  // An Expert has no access to any setting (not even by typing the address).
  if (mode === 'settings' && ctx.roleFor(trip.id) === 'viewer') {
    return { node: h('div', { class: 'screen' }, notice('Experts have no settings: you can look at the tours, the days, the times and who is where.'), h('a', { class: 'btn', href: `#/trip/${trip.id}/use` }, 'Back to the trip')) };
  }
  if (mode === 'settings' && page === 'journal') {
    return { node: h('div', { class: 'screen' }, journalPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'touring') {
    return { node: h('div', { class: 'screen' }, touringSettingsPage(ctx, trip, first)) };
  }
  if (mode === 'settings' && page === 'notifications') {
    return { node: h('div', { class: 'screen' }, notificationsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'appearance') {
    return { node: h('div', { class: 'screen' }, appearancePage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'program') {
    return { node: h('div', { class: 'screen' }, programSettingsPage(ctx, trip, first, second)) };
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
  if (mode === 'settings' && page === 'explore') {
    return { node: h('div', { class: 'screen' }, first ? exploreDestinationPage(ctx, trip, first) : exploreListPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'displays') {
    return { node: h('div', { class: 'screen' }, displaysSettingsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'localteam') {
    return { node: h('div', { class: 'screen' }, contactsSettingsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'together') {
    return { node: h('div', { class: 'screen' }, togetherSettingsPage(ctx, trip)) };
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
  if (mode === 'settings' && page === 'check') {
    return { node: h('div', { class: 'screen' }, checkSettingsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'scheduled') {
    return { node: h('div', { class: 'screen' }, scheduledSettingsPage(ctx, trip)) };
  }
  if (mode === 'settings' && page === 'album') {
    return { node: h('div', { class: 'screen' }, albumSettingsPage(ctx, trip)) };
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

  // One slim row, for both modes (v0.151.0: words, no row of small pictures). Use: the trip's name, then "Saved" (the sync light, one word), "Help" and "Menu".
  // Settings: a way back to the trip. Changing trip lives in Menu (owner's request, 3 Oct 2026): once in a trip, you stay in it.
  const usePage = page === 'guest' || page === 'party' ? 'guests' : page === 'dining' ? 'dining' : page === 'destination' ? 'tours' : page === 'messages' ? 'messages' : 'today';
  const topBar = mode === 'settings'
    ? h('div', { class: 'top-bar' },
        h('a', { class: 'cog cog--home', href: `#/trip/${trip.id}/use`, 'aria-label': 'Back to the trip' }, icon('setup')),
        h('span', { class: 'top-trip' }, 'Settings'),
        h('span', { class: 'top-side' }, syncDot(ctx, { compact: true }), avatarButton(ctx, [{ title: 'Change trip', hint: 'Back to the list of your trips', run: () => ctx.go('#/') }])))
    : h('div', { class: 'top-bar' },
        // The company's logo (Settings > Company look) next to the trip's code, when there is one.
        h('span', { class: 'top-trip' }, trip.branding?.logo ? h('img', { class: 'top-logo', src: trip.branding.logo.data, alt: '' }) : null, trip.ref || trip.name),
        h('span', { class: 'top-side' }, syncDot(ctx, { compact: true }), helpButton(usePage),
          h('button', { class: 'top-btn', type: 'button', 'aria-haspopup': 'dialog', onclick: () => openTripMenu(ctx, trip) }, icon('menu'), h('span', {}, 'Menu'))));

  // An archived trip stays fully viewable (views, journal, exports) but is read-only: no booking changes,
  // no roll call. The single change function already refuses those; this is just so it is seen at a glance.
  const readOnlyNotice = trip.archivedAt ? notice('This trip is archived: read-only. Un-archive it on the Trips screen to make changes again.') : null;
  if (mode === 'use') scheduleRoleNotice(ctx, trip);

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
  const activePage = page === 'guest' ? 'guest' : page === 'party' ? 'party' : page === 'dining' ? 'dining' : page === 'destination' ? 'destination' : page === 'messages' ? 'messages' : 'today';
  const content = activePage === 'guest' ? guestPage(ctx, trip, first)
    : activePage === 'party' ? partyPage(ctx, trip, first)
    : activePage === 'dining' ? diningPage(ctx, trip, first, second, third, fourth)
    : activePage === 'destination' ? destinationPage(ctx, trip, first, second)
    : activePage === 'messages' ? messagesPage(ctx, trip, first)
    : todayPage(ctx, trip);
  // Touring and Dining share the Tours tab: a small switch at the top moves between them.
  const toursSwitch = activePage === 'destination' || activePage === 'dining'
    ? h('div', { class: 'switch', role: 'group', 'aria-label': 'Tours or dining' },
        [['destination', 'Touring'], ['dining', 'Dining']].map(([p, label]) =>
          h('a', { class: `switch-item${p === activePage ? ' is-active' : ''}`, href: `#/trip/${trip.id}/use/${p}` }, label)))
    : null;
  const tabs = tabsNav(ctx, trip, USE_TABS.find((t) => t.pages.includes(activePage))?.tab);

  return { node: h('div', { class: 'screen' }, topBar, readOnlyNotice, toursSwitch, content, tabs) };
}

// Which Settings entries this person may open (owner-only ones are hidden from everybody else).
function visibleItems(ctx, trip, section) {
  const role = ctx.roleFor(trip.id);
  const visible = (item) => (item.preview ? role === 'owner' : (item.page === 'team' || item.page === 'guestlinks' || item.page === 'guestapp' || item.page === 'scheduled') ? role === 'owner' : item.page === 'requests' || item.page === 'album' || item.page === 'guestmessages' ? role !== 'viewer' : true);
  // The simple version (the owner decides per person, Settings > Team) keeps only Requests, Documents, Warnings and the This phone list (and the Advanced list that holds Warnings).
  const simpleKeeps = ['requests', 'exports', 'warnings', 'check', 'notifications', 'appearance', 'section/advanced'];
  const simpleHides = (item) => ctx.simpleFor(trip.id) && !simpleKeeps.includes(item.page);
  return section.items.filter((item) => visible(item) && !simpleHides(item));
}

// The Settings home: one line per group (a picture, a name, what is inside); a tap opens that group's list. (Big tiles until v0.150: a list reads
// faster and looks calmer.)
function settingsMenu(ctx, trip) {
  const role = ctx.roleFor(trip.id);
  return h('div', { class: 'menu menu--sections' }, SETTINGS_SECTIONS.filter((section) => !section.hidden).map((section) => {
    const items = visibleItems(ctx, trip, section);
    if (items.length === 0) return null;
    const waitingGuests = section.key === 'access' && role === 'owner' ? ctx.guestRequestsFor(trip.id).filter((r) => r.status === 'pending').length : 0;
    return h('a', { class: `menu-row tile--${section.key}`, href: `#/trip/${trip.id}/settings/section/${section.key}` },
      h('span', { class: 'tile-icon' }, icon(section.icon)),
      h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, section.title), h('span', { class: 'menu-hint' }, section.blurb)),
      h('span', { class: 'menu-side' },
        waitingGuests > 0 ? h('span', { class: 'tile-badge tile-badge--row', 'aria-label': `${waitingGuests} guest requests waiting` }, String(waitingGuests)) : null,
        h('span', { class: 'row-chev' }, '›')));
  }));
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
          item.page === 'guestmessages' && attentionCount(inboxList(ctx.guestMessagesFor(trip.id), ctx.guestThreadsFor(trip.id), new Map())) > 0 ? h('span', { class: 'tile-badge tile-badge--row' }, String(attentionCount(inboxList(ctx.guestMessagesFor(trip.id), ctx.guestThreadsFor(trip.id), new Map())))) : null,
          item.page === 'requests' && ctx.roleFor(trip.id) === 'owner' && ctx.guestRequestsFor(trip.id).some((r) => r.status === 'pending') ? h('span', { class: 'tile-badge tile-badge--row' }, String(ctx.guestRequestsFor(trip.id).filter((r) => r.status === 'pending').length)) : null,
          h('span', { class: 'row-chev' }, '›'))))));
}

// What a colleague can do, said ONCE as a page that must be read (owner's request, 21 Oct 2026), the first time they open the trip in this role; the bar at the top of
// every screen is gone. It comes back only if their role changes.
function scheduleRoleNotice(ctx, trip) {
  const role = ctx.roleFor(trip.id);
  if (ctx.previewRole || document.querySelector('.fullscreen') || role === 'owner' || ctx.roleNoticeSeen(trip.id) === role) return;
  const team = teamLabel(trip);
  const text = {
    viewer: 'You are an Expert on this trip: you can look at everything (the tours, the days, the times, who is where, allergies and diets), but nothing can be changed.',
    team: `You are ${team}: your changes are applied at once and every device sees them. A forced move waits for the owner's OK. Offline, or if the owner wants to approve first, your change is sent as a request.`,
    advance: 'You are Advance: in your own destination you have the owner\'s authority and your changes are applied at once. Anything elsewhere is sent to the owner as a request.',
  }[role];
  if (!text) return;
  setTimeout(() => {
    if (document.querySelector('.fullscreen') || ctx.roleNoticeSeen(trip.id) === role) return;
    openFullScreen({
      eyebrow: trip.name, title: role === 'viewer' ? 'Welcome, Expert' : role === 'advance' ? 'Welcome, Advance' : `Welcome, ${team}`,
      body: [
        // The app in three steps (v0.151.0), then what this role can do. The same three lines are behind "Help" on every page.
        h('ol', { class: 'help-steps' },
          h('li', {}, h('b', {}, 'Today'), ' shows the next tour and what is waiting for you.'),
          h('li', {}, h('b', {}, 'Tours'), role === 'viewer' ? ' shows who is on each tour, day by day.' : ' shows who is on each tour. Open a tour to start its roll call.'),
          h('li', {}, h('b', {}, 'Messages'), role === 'viewer' ? ' is the chat with your colleagues.' : ' holds the conversations with guests and with your colleagues.')),
        h('p', {}, text),
        h('p', { class: 'muted' }, 'Lost? Tap "Help" at the top of any page. A mistake? Tap "Undo" right after.'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { await ctx.markRoleNoticeSeen(trip.id, role); closeSheet(); } }, 'Start'),
        role === 'viewer' ? null : h('button', { class: 'btn btn--plain', type: 'button', onclick: async () => { await ctx.markRoleNoticeSeen(trip.id, role); closeSheet(); openPractice(); } }, 'First, try a practice roll call'),
      ],
    });
  }, 300);
}
