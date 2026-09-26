// Start-up and navigation.
//
// The app has a handful of screens ("views"). The address after the # in the URL says which one
// to show:
//     #/                              the Trips screen
//     #/trip/<id>/use/destination[/<destinationId>[/<slotId>]]   Use, Touring
//     #/trip/<id>/use/dining[/<destinationId>[/<slotId>[/<restaurantId>[/<seating>]]]]   Use, Dining
//       (restaurantId present: the "By table" grid for that restaurant, step 2b; absent: the overview)
//     #/trip/<id>/use/guest[/<guestId>]                          Use, By guest (a list, or one guest)
//     #/trip/<id>/settings                                       Settings
//     #/trip/<id>/rollcall/<activityId>                          the roll call of one activity
// Using the address means the iPhone's back gesture works as you would expect.
//
// Each view is a function that returns { node }: the screen content.

import { h } from './dom.js';
import {
  dbAll, dbDelete, dbGet, dbPut, saveTripAndJournal, withStores,
  getPushedChangeCount, bumpPushedChangeCount,
} from './db.js';
import { newId } from './ids.js';
import { makeOwner } from './users.js';
import { closeSheet, showToast } from './ui.js';
import { signOut as authSignOut } from './auth.js';
import {
  pushTrip, pushJournalEntries, pullTripList, pullTrip, pullJournalEntries, deleteTripRemote, decideSync,
} from './sync.js';
import { enqueue } from './changes.js';
import { PASSCODE_CONFIG } from './passcode-config.js';
import { gateAvailable, checkPasscode, isUnlocked, rememberUnlock } from './gate.js';
import * as biometrics from './biometrics.js';
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

// Pushes a trip (and, once accepted, its journal entries) and records how far this push actually
// got confirmed (Phase 2, step 2b) — the watermark pullSync uses to tell "server is just ahead, safe
// to auto-pull" apart from "this phone has its own unconfirmed changes, don't overwrite them". Only
// bumped on accepted:true: a rejected push means the server already had this changeCount or newer
// from elsewhere, so THIS push never actually landed and nothing here should be trusted as pushed.
async function pushAndTrack(trip, entries = []) {
  const { accepted } = await pushTrip(trip);
  if (!accepted) return;
  if (entries.length > 0) await pushJournalEntries(trip.id, entries);
  await bumpPushedChangeCount(trip.id, trip.changeCount ?? 0);
}

// The list of screens. The first one whose pattern matches the address is used.
const routes = [
  { pattern: /^#\/trip\/([^/]+)\/rollcall\/([^/]+)$/, view: rollCallView },
  { pattern: /^#\/trip\/([^/]+)\/(use|settings)(?:\/([a-z]+))?(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/, view: tripView },
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

  // Face ID / Touch ID (biometrics.js): an optional, faster way past the same gate as tryUnlock above.
  get biometricAvailable() { return Boolean(window.PublicKeyCredential) && Boolean(PASSCODE_CONFIG) && gateAvailable(); },
  get biometricOn() { return biometrics.biometricRegistered(); },
  async enableBiometric() { await biometrics.enableBiometric(); render(); },
  disableBiometric() { biometrics.disableBiometric(); render(); },
  async unlockWithBiometric() {
    if (!(await biometrics.tryBiometricUnlock())) return false;
    state.locked = false;
    render();
    return true;
  },

  // Save the owner (asked once, on first launch — see welcome.js) and show the app. id is normally
  // the real Supabase account id, once signed in — but welcome.js also offers a "skip sign-in" local
  // path (a fresh, locally generated id, no Supabase account at all) for whenever sign-in itself is
  // the thing standing between the owner and using the app (26 Sep 2026: iPhone's Safari and an
  // installed Home Screen icon do not always share storage, so a magic link finished in Safari can
  // leave the icon stuck asking forever). Either way this saves the SAME local record; the only real
  // difference is that Phase 2's online backup push (sync.js) has nothing to authenticate as without
  // a real account, and silently does nothing — exactly like being offline already does.
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
    trackPush(pushAndTrack(trip)).catch(() => {});
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
      dinnerBookings: [],
      rollCalls: [],
    };
    await dbPut('trips', copy);
    state.trips.set(copy.id, copy);
    trackPush(pushAndTrack(copy)).catch(() => {});
    return copy;
  },

  // Used by backup.js: restores a trip and its whole journal from a backup file (Settings >
  // Backup), replacing whatever this phone already has for that trip id (if anything).
  async restoreBackup(trip, journalEntries) {
    migrateTrip(trip); // a backup made before a later step shipped (see migrateTrip below)
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
    trackPush(pushAndTrack(trip, entries)).catch(() => {});
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

// A trip saved before a later step shipped is missing whatever that step added. Applied to every
// trip loaded from IndexedDB or a backup file, before it is used.
//   Phase 3 step 1: `restaurants` may not exist yet.
//   Phase 3 step 2a: `dinnerBookings` may not exist yet; a Strict-mode restaurant saved before this
//     step stored `tableSizes` (plain numbers) instead of `tables` (each with a stable id, needed so
//     a booking can say exactly which table it occupies) — converted here, fresh ids all round since
//     nothing could reference a table before this step existed.
//   Phase 3 step 2b: `joinable` was removed (24 Sep 2026, the owner's call) — a stray leftover on a
//     restaurant saved before this step is simply dropped; nothing ever reads it again.
function migrateTrip(trip) {
  trip.restaurants ??= [];
  trip.dinnerBookings ??= [];
  for (const r of trip.restaurants) {
    if (r.mode === 'strict' && !r.tables && r.tableSizes) {
      r.tables = r.tableSizes.map((size) => ({ id: newId(), size }));
      delete r.tableSizes;
    }
    delete r.joinable;
  }
  return trip;
}

// index.html shows a boot splash (the app's name, with its own little animation) the instant the page
// opens, before this script has even run, so the phone never shows a blank screen while it starts.
// It is replaced by the real screen the moment start() below is ready — no artificial wait.

async function start() {
  try {
    state.owner = await dbGet('settings', 'owner');
    for (const trip of await dbAll('trips')) { migrateTrip(trip); state.trips.set(trip.id, trip); }
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
    // replaceChildren, not append: the boot splash above is full-height, so simply adding this
    // underneath it left the error invisible without scrolling — looking exactly like a hang.
    document.getElementById('app').replaceChildren(
      h('div', { class: 'screen' }, h('div', { class: 'message' }, `This browser cannot save data on the device (${error.message}).`))
    );
    return;
  }
  // The access code is only asked for when one is set AND this page can check it (see gate.js).
  // With Face ID/Touch ID turned on (biometrics.js), the app locks itself on every reopen instead of
  // just remembering the code for 30 days — the biometric prompt makes that no burden.
  state.locked = Boolean(PASSCODE_CONFIG) && gateAvailable() && (biometrics.biometricLockOn() || !isUnlocked());
  registerOffline(); // starts straight away, offline setup does not touch the screen

  window.addEventListener('hashchange', () => render());
  // The sync light (see syncStatus above) reacts to the phone's own connectivity changes, not just
  // to navigating: going through a tunnel or landing after a flight updates it right away. Coming
  // back online is also when this phone should catch up with any other phone on the same account
  // (Phase 2, step 2b) — not just re-render.
  window.addEventListener('online', () => {
    if (!state.owner) return;
    render({ keepScroll: true });
    trackPush(pullSync()).catch(() => {});
  });
  window.addEventListener('offline', () => { if (state.owner) render({ keepScroll: true }); });
  render();

  // Phase 2: push this phone's own pending work first (step 2a's backfill), then pull whatever
  // changed on another phone signed into the same account (step 2b). Runs after render(), in the
  // background, so neither ever delays the offline boot paint.
  if (state.owner) trackPush(backfillPush().then(() => pullSync())).catch(() => {});
}

// Catches this phone up with the server in both directions: pushes anything of its own the server
// doesn't have yet (a trip edited while offline, or a dropped pushJournalEntries call from an
// earlier, non-atomic push), then pulls anything another phone on the same account pushed that this
// phone doesn't have. Only push_trip/journal_entries reads/writes — no schema assumptions beyond
// what the owner's own Supabase project confirmed (26 Sep 2026).
async function backfillPush() {
  let remote;
  try { remote = await pullTripList(); } catch { return; } // offline, or not reachable yet: try again next boot
  const remoteById = new Map(remote.map((r) => [r.id, r.change_count]));
  for (const trip of state.trips.values()) {
    const serverCount = remoteById.get(trip.id);
    try {
      if (serverCount === undefined || serverCount < (trip.changeCount ?? 0)) {
        await pushAndTrack(trip, ctx.journal(trip.id));
      } else {
        // The trip row is already caught up server-side, but pushTrip and pushJournalEntries are not
        // atomic — a commit whose journal push was dropped (app closed, connection lost mid-way) is
        // never retried by anything else, so check for that gap here.
        const pushed = await getPushedChangeCount(trip.id);
        if ((pushed ?? -1) < (trip.changeCount ?? 0)) {
          await pushJournalEntries(trip.id, ctx.journal(trip.id));
          await bumpPushedChangeCount(trip.id, trip.changeCount ?? 0);
        }
      }
    } catch { /* try again next boot */ }
  }
}

let pullInFlight = null; // single-flight guard: a flapping connection must never run two pulls at once

// Phase 2, step 2b: pulls down whatever another phone signed into the same account has pushed that
// this phone doesn't have yet. Per-trip decision via decideSync (sync.js): only ever replaces a
// trip's local copy when this phone has nothing of its own still unconfirmed to lose; a genuine
// two-sided conflict is left alone (documented limitation, SPEC.md).
function pullSync() {
  if (!pullInFlight) pullInFlight = doPullSync().finally(() => { pullInFlight = null; });
  return pullInFlight;
}

async function doPullSync() {
  let remote;
  try { remote = await pullTripList(); } catch { return; } // offline, or not reachable yet: try again later
  for (const row of remote) {
    try { await pullOneTrip(row.id, row.change_count); } catch { /* try again next time */ }
  }
}

async function pullOneTrip(tripId, serverChangeCount) {
  const local = state.trips.get(tripId);
  const decision = local
    ? decideSync({ localChangeCount: local.changeCount ?? 0, pushedChangeCount: await getPushedChangeCount(tripId), serverChangeCount })
    : 'pull'; // no local copy at all: a genuinely new trip for this phone, nothing to lose

  if (decision === 'conflict') return; // both sides diverged; no automatic resolution built yet (SPEC.md)
  if (decision === 'in-sync') {
    // This phone already matches the server. That equality is proof enough to record the watermark
    // right here, without waiting for this phone's own next push to confirm it independently.
    const pushed = await getPushedChangeCount(tripId);
    if ((local.changeCount ?? 0) === serverChangeCount && (pushed ?? -1) < (local.changeCount ?? 0)) {
      await bumpPushedChangeCount(tripId, local.changeCount ?? 0);
    }
    return;
  }

  // decision === 'pull': go through the SAME queue local changes use, so a boot-time pull and a tap
  // already in flight can never write this trip's IndexedDB record out of order.
  await enqueue(async () => {
    // Re-read fresh, right before writing: by the time this closure's turn in the queue comes up, a
    // local edit or an earlier pull tick may already have changed what "local" means.
    const freshLocal = state.trips.get(tripId);
    if (freshLocal) {
      const freshDecision = decideSync({
        localChangeCount: freshLocal.changeCount ?? 0,
        pushedChangeCount: await getPushedChangeCount(tripId),
        serverChangeCount,
      });
      if (freshDecision !== 'pull') return;
    }

    const remoteTrip = await pullTrip(tripId);
    if (!remoteTrip) return; // deleted on the server since the list was fetched
    const trip = migrateTrip(remoteTrip.data);
    const afterSeq = freshLocal ? Math.max(0, ...ctx.journal(tripId).map((e) => e.seq ?? 0)) : 0;
    const newEntries = await pullJournalEntries(tripId, afterSeq);
    const priorEntries = freshLocal ? ctx.journal(tripId) : [];

    await saveTripAndJournal(trip, newEntries); // only the NEW entries need writing; earlier ones are already stored
    state.trips.set(tripId, trip);
    state.journal.set(tripId, [...priorEntries, ...newEntries]);
    await bumpPushedChangeCount(tripId, trip.changeCount ?? 0);

    if (freshLocal && newEntries.length > 0 && location.hash.startsWith(`#/trip/${tripId}/`)) {
      showToast('Updated from your other phone');
    }
    render({ keepScroll: true });
  });
}

// A deleted trip (Trips screen, step 9) is erased for good, together with its journal and exports,
// 30 days after it was deleted, automatically, the next time the app opens. Also erased on the
// Supabase backend (owner's decision, 26 Sep 2026) — otherwise another phone on the account would
// pull a "permanently deleted" trip right back from the dead the next time it syncs.
const PURGE_AFTER_DAYS = 30;

async function purgeExpiredTrips() {
  const cutoff = Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const expired = [...state.trips.values()].filter((t) => t.deletedAt && new Date(t.deletedAt).getTime() < cutoff);

  for (const trip of expired) {
    const journalKeys = await withStores(['journal'], 'readonly', (s) => s.journal.index('tripId').getAllKeys(trip.id));
    const exportKeys = await withStores(['exports'], 'readonly', (s) => s.exports.index('tripId').getAllKeys(trip.id));
    await withStores(['trips', 'journal', 'exports', 'syncState'], 'readwrite', (s) => {
      s.trips.delete(trip.id);
      for (const key of journalKeys) s.journal.delete(key);
      for (const key of exportKeys) s.exports.delete(key);
      s.syncState.delete(trip.id);
    });
    state.trips.delete(trip.id);
    state.journal.delete(trip.id);
    state.exports.delete(trip.id);
    // Best-effort, not awaited: the local erasure above is what matters and already happened. If
    // this fails (offline, no real account), the trip is already gone from state.trips so nothing
    // retries it — the same phone would need to see it appear again (e.g. via a pull) to purge it a
    // second time. Acceptable: the owner's own promise is "gone from this phone for good"; a stray
    // server-side row with no local trace left is a smaller loose end than the resurrection bug this
    // fixes.
    deleteTripRemote(trip.id).catch(() => {});
  }
}

// Makes the app work without internet: the service worker (sw.js) keeps a copy of the app's files.
function registerOffline() {
  if (!('serviceWorker' in navigator)) return; // for example a plain http page: offline needs https
  navigator.serviceWorker.register('./sw.js').catch(() => {}); // if this fails the app still works online
}

start();
