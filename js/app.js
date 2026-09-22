// Start-up and navigation.
//
// The app has a handful of screens ("views"). The address after the # in the URL says which one
// to show:
//     #/                              the Trips screen
//     #/trip/<id>/use/destination[/<destinationId>[/<slotId>]]   Use, By destination
//     #/trip/<id>/use/guest[/<guestId>]                          Use, By guest (a list, or one guest)
//     #/trip/<id>/settings                                       Settings
//     #/trip/<id>/rollcall/<activityId>                          the roll call of one activity
// Using the address means the iPhone's back gesture works as you would expect.
//
// Each view is a function that returns { node }: the screen content.

import { h } from './dom.js';
import { dbAll, dbGet, dbPut, saveTripAndJournal } from './db.js';
import { newId } from './ids.js';
import { makeOwner } from './users.js';
import { closeSheet } from './ui.js';
import { PASSCODE_CONFIG } from './passcode-config.js';
import { gateAvailable, checkPasscode, isUnlocked, rememberUnlock } from './gate.js';
import { passcodeView } from './views/passcode.js';
import { welcomeView } from './views/welcome.js';
import { tripsView } from './views/trips.js';
import { tripView } from './views/trip.js';
import { rollCallView } from './views/rollcall.js';

// What the app knows right now: who the owner is, every trip on this phone (by id), and the
// journal entries of each trip (by trip id; also stored on the phone, this is a copy in memory).
// `locked` is true while the access code has not been entered (see gate.js).
const state = { owner: undefined, trips: new Map(), journal: new Map(), locked: false };

// The list of screens. The first one whose pattern matches the address is used.
const routes = [
  { pattern: /^#\/trip\/([^/]+)\/rollcall\/([^/]+)$/, view: rollCallView },
  { pattern: /^#\/trip\/([^/]+)\/(use|settings)(?:\/([a-z]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/, view: tripView },
  { pattern: /^#\/?$/, view: tripsView },
];

// Things every view is allowed to use.
const ctx = {
  get owner() { return state.owner; },
  get trips() { return [...state.trips.values()]; },
  trip: (id) => state.trips.get(id),
  journal: (tripId) => state.journal.get(tripId) ?? [],
  go(hash) { location.hash = hash; },

  // Check the access code. If it is right, the phone remembers it for 30 days and the app opens.
  async tryUnlock(code) {
    if (!(await checkPasscode(code, PASSCODE_CONFIG))) return false;
    rememberUnlock();
    state.locked = false;
    render();
    return true;
  },

  // Save the owner's name (asked once, on first launch) and show the app.
  async saveOwner(name) {
    const owner = makeOwner(newId(), name);
    await dbPut('settings', owner, 'owner');
    state.owner = owner;
    location.hash = '#/';
    render();
  },

  // Save a newly loaded trip on the phone.
  async addTrip(trip) {
    await dbPut('trips', trip);
    state.trips.set(trip.id, trip);
  },

  // Used by changes.js: save a changed trip together with its journal entries, then use the new trip.
  async commit(trip, entries) {
    await saveTripAndJournal(trip, entries);
    state.trips.set(trip.id, trip);
    state.journal.set(trip.id, [...ctx.journal(trip.id), ...entries]);
  },

  // Redraw the current screen without jumping back to the top.
  refresh() { render({ keepScroll: true }); },
};

function render({ keepScroll = false } = {}) {
  const app = document.getElementById('app');
  closeSheet(); // a pick-list left open would be pointing at an old screen

  // Locked: nothing else is shown until the access code is entered.
  if (state.locked) {
    app.replaceChildren(passcodeView(ctx).node);
    return;
  }

  // First launch: ask for the owner's name before anything else.
  if (!state.owner) {
    app.replaceChildren(welcomeView(ctx).node);
    return;
  }

  const route = routes.find((r) => r.pattern.test(location.hash));
  if (!route) {
    location.replace('#/'); // unknown address: go home (this triggers render again)
    return;
  }

  const scrollY = window.scrollY; // remembered so refresh() can put the page back where it was
  const params = (location.hash.match(route.pattern) || []).slice(1).map((p) => p && decodeURIComponent(p));
  app.replaceChildren(route.view(ctx, ...params).node);
  window.scrollTo(0, keepScroll ? scrollY : 0);
}

// index.html shows a boot splash (the app's name, with its own little animation) the instant the page
// opens, before this script has even run, so the phone never shows a blank screen while it starts.
// It is replaced by the real screen the moment start() below is ready — no artificial wait.

async function start() {
  try {
    state.owner = await dbGet('settings', 'owner');
    for (const trip of await dbAll('trips')) state.trips.set(trip.id, trip);
    for (const entry of await dbAll('journal')) {
      state.journal.set(entry.tripId, [...(state.journal.get(entry.tripId) ?? []), entry]);
    }
    // Ask the browser not to clear our saved data when the phone is short on space.
    navigator.storage?.persist?.();
  } catch (error) {
    document.getElementById('app').append(
      h('div', { class: 'screen' }, h('div', { class: 'message' }, `This browser cannot save data on the device (${error.message}).`))
    );
    return;
  }
  // The access code is only asked for when one is set AND this page can check it (see gate.js).
  state.locked = Boolean(PASSCODE_CONFIG) && gateAvailable() && !isUnlocked();
  registerOffline(); // starts straight away, offline setup does not touch the screen

  window.addEventListener('hashchange', () => render());
  render();
}

// Makes the app work without internet: the service worker (sw.js) keeps a copy of the app's files.
function registerOffline() {
  if (!('serviceWorker' in navigator)) return; // for example a plain http page: offline needs https
  navigator.serviceWorker.register('./sw.js').catch(() => {}); // if this fails the app still works online
}

start();
