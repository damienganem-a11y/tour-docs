// Start-up and navigation.
//
// The app has a handful of screens ("views"). The address after the # in the URL says which one
// to show:
//     #/                              the Trips screen
//     #/trip/<id>/use/destination[/<destinationId>[/<slotId>]]   Use, By destination
//     #/trip/<id>/use/guest[/<guestId>]                          Use, By guest (a list, or one guest)
//     #/trip/<id>/settings                                       Settings
// Using the address means the iPhone's back gesture works as you would expect.
//
// Each view is a function that returns { node }: the screen content.

import { h } from './dom.js';
import { dbAll, dbGet, dbPut } from './db.js';
import { newId } from './ids.js';
import { makeOwner } from './users.js';
import { closeSheet } from './ui.js';
import { welcomeView } from './views/welcome.js';
import { tripsView } from './views/trips.js';
import { tripView } from './views/trip.js';

// What the app knows right now: who the owner is, and every trip on this phone (by id).
const state = { owner: undefined, trips: new Map() };

// The list of screens. The first one whose pattern matches the address is used.
const routes = [
  { pattern: /^#\/trip\/([^/]+)\/(use|settings)(?:\/([a-z]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/, view: tripView },
  { pattern: /^#\/?$/, view: tripsView },
];

// Things every view is allowed to use.
const ctx = {
  get owner() { return state.owner; },
  get trips() { return [...state.trips.values()]; },
  trip: (id) => state.trips.get(id),
  go(hash) { location.hash = hash; },

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
};

function render() {
  const app = document.getElementById('app');
  closeSheet(); // a pick-list left open would be pointing at an old screen

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

  const params = (location.hash.match(route.pattern) || []).slice(1).map((p) => p && decodeURIComponent(p));
  app.replaceChildren(route.view(ctx, ...params).node);
  window.scrollTo(0, 0);
}

async function start() {
  try {
    state.owner = await dbGet('settings', 'owner');
    for (const trip of await dbAll('trips')) state.trips.set(trip.id, trip);
    // Ask the browser not to clear our saved data when the phone is short on space.
    navigator.storage?.persist?.();
  } catch (error) {
    document.getElementById('app').append(
      h('div', { class: 'screen' }, h('div', { class: 'message' }, `This browser cannot save data on the device (${error.message}).`))
    );
    return;
  }
  window.addEventListener('hashchange', render);
  render();
}

start();
