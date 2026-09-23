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
import { dbAll, dbDelete, dbGet, dbPut, saveTripAndJournal, withStores } from './db.js';
import { newId } from './ids.js';
import { makeOwner } from './users.js';
import { closeSheet } from './ui.js';
import { signOut as authSignOut } from './auth.js';
import { pushTrip, pushJournalEntries, pullTripList } from './sync.js';
import { PASSCODE_CONFIG } from './passcode-config.js';
import { gateAvailable, checkPasscode, isUnlocked, rememberUnlock } from './gate.js';
import { passcodeView } from './views/passcode.js';
import { welcomeView } from './views/welcome.js';
import { tripsView } from './views/trips.js';
import { tripView } from './views/trip.js';
import { rollCallView } from './views/rollcall.js';

// What the app knows right now: who the owner is, every trip on this phone (by id), and the
// journal entries and saved export versions of each trip (by trip id; also stored on the phone,
// this is a copy in memory). `locked` is true while the access code has not been entered (see gate.js).
const state = { owner: undefined, trips: new Map(), journal: new Map(), exports: new Map(), locked: false };

// The small sync light shown on the Trips screen and inside a trip (see chrome.js's syncDot):
//   'offline'  no internet right now (navigator.onLine)
//   'pending'  online, but at least one push to Supabase has not finished/been confirmed yet
//   'synced'   online, nothing waiting
// pendingPushes counts pushes currently in flight; trackPush wraps every push call site (addTrip,
// duplicateTrip, commit, the boot-time backfill) so the light always reflects reality, and redraws
// the screen the moment it changes — the owner asked for it to update live, not just on navigation.
let pendingPushes = 0;
function trackPush(promise) {
  pendingPushes++;
  // Render right away so "pending" (orange) shows the instant a push starts, not only when the
  // owner happens to navigate while one is in flight — the light must update on its own, not just
  // as a side effect of some other redraw.
  if (state.owner) render({ keepScroll: true });
  // .finally() returns its OWN promise, separate from the one below that callers .catch() — and
  // .finally() re-throws after running its callback, so without this .catch() here too, a failed
  // push (e.g. offline) becomes an unhandled rejection even though the caller's .catch() runs fine.
  promise.finally(() => {
    pendingPushes--;
    if (state.owner) render({ keepScroll: true }); // reactive: clears back to "synced" without waiting for a navigation
  }).catch(() => {});
  return promise;
}
function syncStatus() {
  if (!navigator.onLine) return 'offline';
  return pendingPushes > 0 ? 'pending' : 'synced';
}

// The list of screens. The first one whose pattern matches the address is used.
const routes = [
  { pattern: /^#\/trip\/([^/]+)\/rollcall\/([^/]+)$/, view: rollCallView },
  { pattern: /^#\/trip\/([^/]+)\/(use|settings)(?:\/([a-z]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/, view: tripView },
  { pattern: /^#\/?$/, view: tripsView },
];

// Things every view is allowed to use.
const ctx = {
  get owner() { return state.owner; },
  get syncStatus() { return syncStatus(); },
  get trips() { return [...state.trips.values()]; },
  trip: (id) => state.trips.get(id),
  journal: (tripId) => state.journal.get(tripId) ?? [],
  exportsFor: (tripId) => state.exports.get(tripId) ?? [],
  go(hash) { location.hash = hash; },

  // Check the access code. If it is right, the phone remembers it for 30 days and the app opens.
  async tryUnlock(code) {
    if (!(await checkPasscode(code, PASSCODE_CONFIG))) return false;
    rememberUnlock();
    state.locked = false;
    render();
    return true;
  },

  // Save the signed-in owner (asked once, on first launch — see welcome.js) and show the app.
  // id comes from the Supabase account, not a locally generated one (see auth.js).
  async saveOwner(name, id) {
    const owner = makeOwner(id, name);
    await dbPut('settings', owner, 'owner');
    state.owner = owner;
    location.hash = '#/';
    render();
  },

  // Used by trips.js: "Sign out" (mainly for testing sign-in again; also useful if the phone
  // changes hands). Clears the local sign-in, which is the real gate for offline use — the
  // Supabase call is best-effort and not awaited, so this never blocks on the network.
  async signOut() {
    await dbDelete('settings', 'owner');
    authSignOut();
    location.hash = '#/';
    location.reload(); // also clears welcome.js's own leftover state from any earlier attempt
  },

  // Save a newly loaded trip on the phone. Also pushed to Supabase (Phase 2, step 2a: a safety-net
  // backup; pulling it onto another device is step 2b) — best-effort, not awaited: the local save
  // above is what matters, and already happened by the time this runs.
  async addTrip(trip) {
    await dbPut('trips', trip);
    state.trips.set(trip.id, trip);
    trackPush(pushTrip(trip)).catch(() => {});
  },

  // Used by trips.js: "Duplicate trip" (step 9). A brand new trip (its own id, not tied to the
  // original by anything but its content), keeping destinations, activities and settings, but with
  // guests, travel parties, bookings and roll calls all starting empty. Like addTrip, this is a fresh
  // trip being created, so it does not go through the single change function or the journal.
  async duplicateTrip(trip, name = `${trip.name} (copy)`) {
    const copy = {
      ...structuredClone(trip),
      id: newId(),
      name,
      loadedAt: new Date().toISOString(),
      changeCount: 0,
      archivedAt: null,
      deletedAt: null,
      parties: [],
      guests: [],
      bookings: {},
      rollCalls: [],
    };
    await dbPut('trips', copy);
    state.trips.set(copy.id, copy);
    trackPush(pushTrip(copy)).catch(() => {});
    return copy;
  },

  // Used by backup.js: restores a trip and its whole journal from a backup file (Settings >
  // Backup), replacing whatever this phone already has for that trip id (if anything).
  async restoreBackup(trip, journalEntries) {
    const staleKeys = await withStores(['journal'], 'readonly', (s) => s.journal.index('tripId').getAllKeys(trip.id));
    await withStores(['trips', 'journal'], 'readwrite', (s) => {
      s.trips.put(trip);
      for (const key of staleKeys) s.journal.delete(key);
      for (const entry of journalEntries) s.journal.put(entry);
    });
    state.trips.set(trip.id, trip);
    state.journal.set(trip.id, journalEntries);
  },

  // Used by changes.js: save a changed trip together with its journal entries, then use the new trip.
  // Also pushed to Supabase (Phase 2, step 2a) — fire-and-forget: this promise resolves as soon as
  // the LOCAL save above completes, same as before this step, so a slow or absent connection never
  // makes changes.js's own change queue wait on the network (offline-first stays intact).
  async commit(trip, entries) {
    await saveTripAndJournal(trip, entries);
    state.trips.set(trip.id, trip);
    state.journal.set(trip.id, [...ctx.journal(trip.id), ...entries]);
    trackPush(pushTrip(trip).then(({ accepted }) => { if (accepted) return pushJournalEntries(trip.id, entries); })).catch(() => {});
  },

  // Used by export.js: keep a PDF that was just built, so it can be found again in the Exports archive.
  async saveExport(tripId, record) {
    await dbPut('exports', record);
    state.exports.set(tripId, [...ctx.exportsFor(tripId), record]);
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
    for (const record of await dbAll('exports')) {
      state.exports.set(record.tripId, [...(state.exports.get(record.tripId) ?? []), record]);
    }
    await purgeExpiredTrips();
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
  // The sync light (see syncStatus above) reacts to the phone's own connectivity changes, not just
  // to navigating: going through a tunnel or landing after a flight updates it right away.
  window.addEventListener('online', () => { if (state.owner) render({ keepScroll: true }); });
  window.addEventListener('offline', () => { if (state.owner) render({ keepScroll: true }); });
  render();

  // Phase 2, step 2a: a trip loaded before this step shipped has nothing on the server yet (it
  // only gets pushed by its NEXT change). Runs after render(), in the background, so it never
  // delays the offline boot paint; safe to add now because nothing pulls yet (step 2b).
  if (state.owner) trackPush(backfillPush()).catch(() => {});
}

async function backfillPush() {
  let remote;
  try { remote = await pullTripList(); } catch { return; } // offline, or not reachable yet: try again next boot
  const remoteById = new Map(remote.map((r) => [r.id, r.change_count]));
  for (const trip of state.trips.values()) {
    const serverCount = remoteById.get(trip.id);
    if (serverCount === undefined || serverCount < (trip.changeCount ?? 0)) {
      try { await pushTrip(trip); } catch { /* try again next boot */ }
    }
  }
}

// A deleted trip (Trips screen, step 9) is erased for good, together with its journal and exports,
// 30 days after it was deleted, automatically, the next time the app opens.
const PURGE_AFTER_DAYS = 30;

async function purgeExpiredTrips() {
  const cutoff = Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const expired = [...state.trips.values()].filter((t) => t.deletedAt && new Date(t.deletedAt).getTime() < cutoff);

  for (const trip of expired) {
    const journalKeys = await withStores(['journal'], 'readonly', (s) => s.journal.index('tripId').getAllKeys(trip.id));
    const exportKeys = await withStores(['exports'], 'readonly', (s) => s.exports.index('tripId').getAllKeys(trip.id));
    await withStores(['trips', 'journal', 'exports'], 'readwrite', (s) => {
      s.trips.delete(trip.id);
      for (const key of journalKeys) s.journal.delete(key);
      for (const key of exportKeys) s.exports.delete(key);
    });
    state.trips.delete(trip.id);
    state.journal.delete(trip.id);
    state.exports.delete(trip.id);
  }
}

// Makes the app work without internet: the service worker (sw.js) keeps a copy of the app's files.
function registerOffline() {
  if (!('serviceWorker' in navigator)) return; // for example a plain http page: offline needs https
  navigator.serviceWorker.register('./sw.js').catch(() => {}); // if this fails the app still works online
}

start();
