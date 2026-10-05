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
import { guestSheetRows } from './guestSheet.js';
import { defaultBranding, brandingFromLook, tripAccent } from './loader.js';
import { makeOwner } from './users.js';
import { closeSheet, showToast, onSheetClosed } from './ui.js';
import { signOut as authSignOut, hasLiveSession } from './auth.js';
import {
  pushTrip, pushJournalEntries, pushGuestSheets, pullTripList, pullTrip, pullJournalEntries, deleteTripRemote, decideSync,
  syncProbe, diagnoseSync, plainSyncError, watchServerChanges,
  pullGuestRequests, answerGuestRequest, getPushPublicKey, saveOwnerPush, removeOwnerPush, notifyGuests, notifyMe, guestPushOverview, makeGuestCode, listScheduled, scheduleMessage, cancelScheduled, replaceAutoMessages, schedulerStatus,
  pullMyAccess, listMembers, teamSignInToken, roleOf, sendRequestRemote, pullRequests, claimRequest, finishRequest, reopenRequest, pullDocumentList, pullDocumentFile, pushDocument, deleteDocumentRemote, decideDocument, documentMeta, base64ToBlob,
} from './sync.js';
import { enqueue, applyChange } from './changes.js';
import { resolveGuestRequest, guestRequestChange, guestAnswerText } from './guestRequests.js';
import { notificationsFor, notifySettings } from './notifyRules.js';
import { plannedAutoMessages } from './scheduledMessages.js';
import { urlBase64ToUint8Array, subscriptionFields, pushCapability } from './pushUtil.js';
import { PASSCODE_CONFIG } from './passcode-config.js';
import { gateAvailable, checkPasscode, isUnlocked, rememberUnlock } from './gate.js';
import * as biometrics from './biometrics.js';
import { enablePullToRefresh } from './pullRefresh.js';
import { sameDocument } from './export.js';
import { dietaryErasureDue, dietaryExpiry } from './rules.js';
import { passcodeView } from './views/passcode.js';
import { previewBar } from './views/preview.js';
import { welcomeView } from './views/welcome.js';
import { tripsView } from './views/trips.js';
import { tripView } from './views/trip.js';
import { rollCallView } from './views/rollcall.js';

// What the app knows right now: who the owner is, every trip on this phone (by id), and the
// journal entries and saved export versions of each trip (by trip id; also stored on the phone,
// this is a copy in memory). `locked` is true while the access code has not been entered (see gate.js).
const state = { owner: undefined, trips: new Map(), journal: new Map(), exports: new Map(), locked: false };
// The person's role on each trip that is shared with them: 'owner', 'team' or 'viewer' (SPEC.md, Team). A trip that is not in
// this list is the person's own (a local trip, or one created here), so they are its owner. Kept on the device so it works offline.
const tripRoles = new Map();
const tripScopes = new Map(); // tripId -> the one destination a Team colleague is tied to (absent = the whole trip)

// Owner only: "Preview as View only / Team" (views/preview.js). While it is on, every screen is drawn as that role would see it, and nothing
// can be changed or sent. Kept per browser tab (sessionStorage), so closing the app always ends it.
let previewRole = (() => { try { const r = sessionStorage.getItem('tourdocs.preview'); return r === 'viewer' || r === 'team' ? r : null; } catch { return null; } })();
// Requests (SPEC.md, Team step B): what the server last said about them, and the ones made here that are not sent yet (kept on the device).
let requestRows = [];
// Requests from GUESTS (their app's "Ask to switch to this tour"): what the server last said. Never applied by themselves: the owner decides.
let guestRequestRows = [];
let outbox = [];
// Does this browser hold a live online login? true / false, or null while unknown (not checked yet, or
// offline so it cannot be checked). Only `false` changes what the sync light says (see syncStatus).
let hasSession = null;
let biometricAsking = null;      // the Face ID request in progress, if any (see unlockWithBiometric)
let autoBiometricAsked = false;  // has the lock screen already popped Face ID up by itself this time?
// The company look every new trip starts with (Trips > My company), or null: kept on this device only.
let companyLook = null;
let companyLookAsked = false; // the load-time prompt is shown once per device, whether it was saved or skipped

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
  if (state.owner) renderQuiet();
  // .finally() returns its OWN promise, separate from the one below that callers .catch() — and
  // .finally() re-throws after running its callback, so without this .catch() here too, a failed
  // push (e.g. offline) becomes an unhandled rejection even though the caller's .catch() runs fine.
  promise.finally(() => {
    pendingPushes--;
    if (state.owner) renderQuiet(); // reactive: clears back to "synced" without waiting for a navigation
  }).catch(() => {});
  return promise;
}
function syncStatus() {
  if (!navigator.onLine) return 'offline';
  if (hasSession === false) return 'nologin'; // online, but nothing can sync: must not read as "Online"
  return pendingPushes > 0 ? 'pending' : 'synced';
}

// Checks once whether this browser holds a live online login, then redraws the light. Never blocks.
async function checkSession() {
  const result = await hasLiveSession();
  if (result === null || result === hasSession) return;
  hasSession = result;
  if (state.owner) renderQuiet();
}

// Pushes a trip (and, once accepted, its journal entries) and records how far this push actually
// got confirmed (Phase 2, step 2b) — the watermark pullSync uses to tell "server is just ahead, safe
// to auto-pull" apart from "this phone has its own unconfirmed changes, don't overwrite them". Only
// bumped on accepted:true: a rejected push means the server already had this changeCount or newer
// from elsewhere, so THIS push never actually landed and nothing here should be trusted as pushed.
async function pushAndTrack(trip, entries = []) {
  if (ctx.roleFor(trip.id) !== 'owner') return; // a trip shared WITH this person is only ever read from the server
  try {
    const { accepted } = await pushTrip(trip);
    if (accepted) {
      if (entries.length > 0) await pushJournalEntries(trip.id, entries);
      await bumpPushedChangeCount(trip.id, trip.changeCount ?? 0);
    }
    if (accepted || trip.guestLinks) await sendGuestSheets(trip); // never throws: see below
    noteSyncOk();
  } catch (error) {
    noteSyncProblem(error);
    throw error;
  }
}

// The guests' personal sheets (Phase 5, the guest app): after a trip reaches the server, each guest who has a link gets their
// up-to-date sheet there. Only sheets that really changed are sent (compared with what this session last sent). A failure never
// breaks the trip's own sync: it is kept in guestSheetInfo, which Settings > Guest links shows.
const guestSheetInfo = { lastOkAt: null, error: null, sent: new Map(), heartbeatAt: new Map() };
const HEARTBEAT_MS = 6 * 3600000; // resend every sheet at least this often while the leader's phone is open, so guests can tell a fresh programme from a forgotten one
async function sendGuestSheets(trip, { force = false } = {}) {
  if (!trip.guestLinks) return;
  try {
    const now = new Date().toISOString();
    const rows = guestSheetRows(trip, '');
    const before = guestSheetInfo.sent.get(trip.id) ?? new Map();
    const signature = (row) => JSON.stringify(row);
    // Only the sheets that changed since this session last sent them (all of them after a forced send or on the first send).
    const beat = Date.now() - (guestSheetInfo.heartbeatAt.get(trip.id) ?? 0) > HEARTBEAT_MS; // time to refresh the "last updated" moment of all sheets
    const changed = rows.filter((row) => force || beat || before.get(row.token) !== signature(row));
    if (changed.length === 0 && before.size === rows.length) return; // nothing new, no link removed
    for (const row of changed) if (row.sheet) row.sheet.updatedAt = now;
    await pushGuestSheets(trip.id, changed, rows.map((r) => r.token));
    guestSheetInfo.sent.set(trip.id, new Map(rows.map((r) => [r.token, signature(r)])));
    if (beat || force) guestSheetInfo.heartbeatAt.set(trip.id, Date.now());
    guestSheetInfo.lastOkAt = now;
    guestSheetInfo.error = null;
  } catch (error) {
    guestSheetInfo.error = plainSyncError(error?.message);
  }
}

// What the "Sync details" sheet (behind the sync light) reports as the last success and last problem.
// Kept in memory only: it describes this session, and the sheet also asks the server live.
const syncInfo = { lastOkAt: null, lastError: null };
function noteSyncOk() { syncInfo.lastOkAt = new Date().toISOString(); syncInfo.lastError = null; }
function noteSyncProblem(error) { syncInfo.lastError = plainSyncError(error?.message); }

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
  // Links this phone's existing owner (name and trips untouched) to a real online account, once a code
  // has been verified (views/onlineSignIn.js), then pushes what this phone has and pulls what it lacks.
  async linkOnlineAccount(id) {
    const owner = makeOwner(id, state.owner.name);
    await dbPut('settings', owner, 'owner');
    state.owner = owner;
    hasSession = true;
    render({ keepScroll: true });
    trackPush(backfillPush().then(() => pullSync())).catch(() => {});
  },
  // For the sheet behind the sync light: asks the server live and explains what is going on.
  async syncDetails() {
    let probe = null, probeError = null;
    if (navigator.onLine) {
      try { probe = await syncProbe(); } catch (error) { probeError = error?.message ?? 'unreachable'; }
    }
    const result = diagnoseSync({ online: navigator.onLine, probe, probeError, localCount: state.trips.size, ...syncInfo });
    return result;
  },
  get trips() { return [...state.trips.values()]; },
  get companyLook() { return companyLook; },
  get companyLookAsked() { return companyLookAsked; },
  async markCompanyLookAsked() {
    companyLookAsked = true;
    await dbPut('settings', true, 'companyLookAsked');
  },
  async saveCompanyLook(look) {
    await dbPut('settings', look, 'companyLook');
    companyLook = look;
    render({ keepScroll: true });
  },
  trip: (id) => state.trips.get(id),
  journal: (tripId) => state.journal.get(tripId) ?? [],
  documentsInfo: () => documentsInfo,
  // The role on this trip, and the person with that role: what the one change function checks (a viewer cannot change anything).
  roleFor: (tripId) => previewRole ?? tripRoles.get(tripId) ?? 'owner',
  scopeFor: (tripId) => (previewRole ? null : tripScopes.get(tripId) ?? null),
  get previewRole() { return previewRole; },
  setPreview(role) {
    previewRole = role === 'viewer' || role === 'team' ? role : null;
    try { if (previewRole) sessionStorage.setItem('tourdocs.preview', previewRole); else sessionStorage.removeItem('tourdocs.preview'); } catch { /* works without */ }
    render();
    if (!previewRole) backfillPush().catch(() => {}); // a change made in a Team preview is sent to the server now that this device is the owner again
  },
  // Settings > Guest links: how the last sending of the guests' sheets went, and a way to send them again right now.
  guestSheetStatus: () => ({ lastOkAt: guestSheetInfo.lastOkAt, error: guestSheetInfo.error }),
  async resendGuestSheets(tripId) {
    const trip = state.trips.get(tripId);
    if (trip) await sendGuestSheets(trip, { force: true });
    return ctx.guestSheetStatus();
  },
  userFor: (tripId) => ({ ...state.owner, role: ctx.roleFor(tripId), scope: ctx.scopeFor(tripId) }),
  // Requests: a Team colleague asks, the owner's device applies (sendRequest is called by the one change function).
  requestsFor: (tripId) => requestRows.filter((r) => r.trip_id === tripId),
  guestRequestsFor: (tripId) => guestRequestRows.filter((r) => r.trip_id === tripId),
  // The owner says yes to a guest's request. mode: 'move' (needs a free place), 'waitlist' (joins the waiting list), 'force' (over capacity).
  // Returns { ok } or { ok: false, error, full? }: `full` tells the screen to offer the waiting list or going over capacity.
  async approveGuestRequest(id, mode = 'move') {
    await loadGuestRequests();
    const row = guestRequestRows.find((r) => r.id === id);
    const trip = row && state.trips.get(row.trip_id);
    if (!row || !trip || row.status !== 'pending') return { ok: false, error: 'This request is not waiting any more (the guest may have taken it back).' };
    const resolved = resolveGuestRequest(trip, row);
    if (!resolved.ok) return resolved;
    const result = await applyChange(ctx, trip.id, guestRequestChange(resolved, mode), { request: { id: row.id, at: row.created_at }, source: 'guest request' });
    if (!result.ok) return { ok: false, error: result.error, full: /full|over capacity|capacity/i.test(result.error ?? '') };
    await answerGuestRequest(row.id, 'approved', mode === 'waitlist' ? 'Waiting list' : mode === 'force' ? 'Over capacity' : null).catch(() => {});
    sendAnswer(row, row.note, mode === 'waitlist' ? 'waitlist' : 'approved');
    await loadGuestRequests();
    render({ keepScroll: true });
    return { ok: true };
  },
  async declineGuestRequest(id, note = '') {
    const row = guestRequestRows.find((r) => r.id === id);
    if (!row) return { ok: false, error: 'Unknown request.' };
    const reason = String(note ?? '').trim().slice(0, 200) || null;
    const recorded = await answerGuestRequest(id, 'declined', reason).catch(() => false);
    if (recorded) sendAnswer({ ...row, note: reason }, reason, 'declined');
    await loadGuestRequests();
    render({ keepScroll: true });
    return { ok: true };
  },
  async refreshGuestRequests() { await loadGuestRequests(); render({ keepScroll: true }); },
  // Notifications on THIS phone (owner): "a guest sent a request" arrives as a notification. Needs the app on the Home Screen (iPhone) and the
  // one-time setup of supabase/PUSH_SETUP.md. pushState() says what to show; enablePush() asks the phone and tells the server.
  async pushState() {
    const capability = pushCapability();
    if (!capability.supported) return { state: 'unsupported' };
    if (capability.needsInstall) return { state: 'install' };
    if (capability.denied) return { state: 'denied' };
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      return { state: existing && Notification.permission === 'granted' ? 'on' : 'off' };
    } catch { return { state: 'off' }; }
  },
  async enablePush() {
    const key = await getPushPublicKey();
    if (!key) return { ok: false, error: 'Notifications are not set up on the server yet (see supabase/PUSH_SETUP.md).' };
    if ((await Notification.requestPermission()) !== 'granted') return { ok: false, error: 'The phone did not allow notifications.' };
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await saveOwnerPush(subscriptionFields(subscription));
    return { ok: true };
  },
  async disablePush() {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) { await removeOwnerPush(subscription.endpoint).catch(() => {}); await subscription.unsubscribe(); }
    return { ok: true };
  },
  async testPush() { return notifyMe({ title: 'Tour Docs', body: 'Notifications work on this phone.' }); },
  // A short message to the guests of a trip who said "notify me" in their app (Settings > Guest links). Returns { sent }.
  async notifyAllGuests(tripId, title, body, important = false) { return notifyGuests(tripId, undefined, { title, body, url: './', category: 'announcement', priority: important ? 'important' : 'info' }); },
  guestPushOverview: (tripId) => guestPushOverview(tripId),
  makeGuestCode: (tripId, guestId) => makeGuestCode(tripId, guestId),
  teamSignInToken: (tripId, email) => teamSignInToken(tripId, email),
  listScheduled: (tripId) => listScheduled(tripId),
  scheduleMessage: async (tripId, row) => { await scheduleMessage(tripId, row); },
  cancelScheduled: (id) => cancelScheduled(id),
  schedulerStatus: () => schedulerStatus(),
  refreshAutoMessages: (tripId) => syncAutoMessages(tripId),
  outboxFor: (tripId) => outbox.filter((r) => r.tripId === tripId),
  async sendRequest(tripId, changes) {
    outbox.push({ id: newId(), tripId, requesterName: state.owner.name, changes, requestedAt: new Date().toISOString() });
    await dbPut('settings', outbox, 'outbox');
    flushOutbox().catch(() => {});
  },
  async declineRequest(id, note = null) { await finishRequest(id, 'declined', note || null); await processRequests(); render({ keepScroll: true }); },
  askAgain: (tripId, changes) => applyChange(ctx, tripId, changes),
  approveForcedRequest: (id) => decideForcedRequest(id, 'approve'),
  waitlistForcedRequest: (id) => decideForcedRequest(id, 'waitlist'),
  declineForcedRequest: (id, note) => decideForcedRequest(id, 'decline', note),
  needsOwnerDecision: (row) => needsOwnerDecision(row),
  async retryRequest(id) { await reopenRequest(id); await processRequests(); render({ keepScroll: true }); },
  exportsFor: (tripId) => (state.exports.get(tripId) ?? []).filter((r) => !r.deletedAt), // a document deleted here waits, hidden, until the server has been told
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
  // Only ONE Face ID window at a time, and the automatic one only once per opening of the app: the lock screen is
  // redrawn whenever anything in the background updates (syncing, refreshing), and each redraw used to ask again
  // (owner saw four windows in a row, 1 Oct 2026). The button on the screen can always ask again by hand.
  unlockWithBiometric() {
    biometricAsking ??= biometrics.tryBiometricUnlock().then((ok) => {
      biometricAsking = null;
      if (!ok) return false;
      state.locked = false;
      render();
      return true;
    });
    return biometricAsking;
  },
  takeAutoBiometricTurn() { // true the first time only
    const first = !autoBiometricAsked;
    autoBiometricAsked = true;
    return first;
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
    if (companyLook) trip.branding = brandingFromLook(companyLook, trip.branding?.cardNote ?? ''); // a new trip starts with the company look
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
      guestLinks: {}, // a copy never inherits the originals' personal links (each link belongs to one trip's guest)
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
    notifyAfterChange(trip, entries);
    syncAutoMessagesSoon(trip.id);
  },

  // Used by export.js: keep a PDF that was just built, so it can be found again in the Exports archive.
  // Making the same document again (same title, same kind of file) replaces the current one: the new copy becomes the
  // current document and the previous one moves to Archived, keeping its version number (owner's request, 1 Oct 2026).
  // Every change is stamped (updatedAt) and marked `dirty` until it has been sent to the server (see syncDocuments).
  async saveExport(tripId, record) {
    const now = new Date().toISOString();
    const replaced = sameDocument(ctx.exportsFor(tripId), record);
    const stamped = { ...record, updatedAt: now, dirty: true };
    for (const old of replaced) await putExport({ ...old, archivedAt: now, updatedAt: now, dirty: true });
    await putExport(stamped);
    syncDocumentsSoon();
  },

  // Archive housekeeping (Settings > Documents): rename a version, move it to Archived and back, delete it for good.
  async updateExport(tripId, recordId, changes) {
    const old = ctx.exportsFor(tripId).find((r) => r.id === recordId);
    if (!old) return;
    await putExport({ ...old, ...changes, updatedAt: new Date().toISOString(), dirty: true });
    syncDocumentsSoon();
  },
  async deleteExport(tripId, recordId) {
    const old = ctx.exportsFor(tripId).find((r) => r.id === recordId);
    if (!old) return;
    // Kept as a small hidden note (no file) until the server has been told, so another device never brings it back.
    await putExport({ id: old.id, tripId, title: old.title, format: old.format, deletedAt: new Date().toISOString(), dirty: true });
    syncDocumentsSoon();
  },

  // Redraw the current screen without jumping back to the top.
  refresh() { render({ keepScroll: true }); },
};

// A redraw that nobody asked for (the sync light changing, the connection coming back...) must never close a sheet the person is using: it waits
// until the sheet is closed. (Seen by the owner: a QR code appeared for half a second and vanished, because a background sync redrew the screen.)
let renderWaiting = false;
function renderQuiet() {
  if (document.body.classList.contains('sheet-open')) { renderWaiting = true; return; }
  render({ keepScroll: true });
}
onSheetClosed(() => { if (renderWaiting) { renderWaiting = false; render({ keepScroll: true }); } });

function render({ keepScroll = false } = {}) {
  const app = document.getElementById('app');
  renderWaiting = false;
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

  // Inside a trip the app wears the company's colour; the Trips list and everything outside a trip stay neutral (neutral).
  applyLook(ctx.trip(location.hash.match(/^#\/trip\/([^/]+)/)?.[1]));

  const scrollY = window.scrollY; // remembered so refresh() can put the page back where it was
  const params = (location.hash.match(route.pattern) || []).slice(1).map((p) => p && decodeURIComponent(p));
  app.replaceChildren(...[previewBar(ctx), route.view(ctx, ...params).node].filter(Boolean));
  window.scrollTo(0, keepScroll ? scrollY : 0);
}

// The colour of the company, used where the neutral look uses yellow (buttons, the active tab, tags). The text on top of it is black or white,
// whichever reads better, so any company colour stays readable. A trip with no company name wears Tour Docs orange.
function applyLook(trip) {
  const root = document.documentElement.style;
  // Outside a trip (the Trips list): neutral, near-black with white text. Inside a trip: the trip's colour (company colour, else orange).
  const accent = trip ? tripAccent(trip.branding) : '#1a1a1a';
  document.documentElement.removeAttribute('data-dark-company');
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
  root.setProperty('--yellow', accent);
  const light = (r * 299 + g * 587 + b * 114) / 1000;
  root.setProperty('--on-yellow', light > 150 ? '#000' : '#fff');
  if (light < 70) document.documentElement.setAttribute('data-dark-company', ''); // a very dark colour needs an outline on the black menu
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
  trip.splits ??= []; // groups (1 Oct 2026): a trip saved before then has none
  trip.branding ??= defaultBranding(); // confirmation cards (30 Sep 2026): a trip saved before then has none
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
    companyLook = (await dbGet('settings', 'companyLook')) ?? null;
    companyLookAsked = Boolean(await dbGet('settings', 'companyLookAsked'));
    for (const [id, role] of Object.entries((await dbGet('settings', 'tripRoles')) ?? {})) tripRoles.set(id, role);
    for (const [id, scope] of Object.entries((await dbGet('settings', 'tripScopes')) ?? {})) tripScopes.set(id, scope);
    outbox = (await dbGet('settings', 'outbox')) ?? [];
    for (const trip of await dbAll('trips')) { migrateTrip(trip); state.trips.set(trip.id, trip); }
    for (const entry of await dbAll('journal')) {
      state.journal.set(entry.tripId, [...(state.journal.get(entry.tripId) ?? []), entry]);
    }
    for (const record of await dbAll('exports')) {
      state.exports.set(record.tripId, [...(state.exports.get(record.tripId) ?? []), record]);
    }
    await purgeExpiredTrips();
    // (the erasing of allergy information runs below, once the screen is up)
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
    renderQuiet();
    trackPush(pullSync()).catch(() => {});
  });
  window.addEventListener('offline', () => { if (state.owner) renderQuiet(); });
  setInterval(() => refreshFromServer(), REFRESH_EVERY_MS);
  enablePullToRefresh(refreshByHand);
  setInterval(enforceDietaryExpiry, 60000); // erasing allergy information after the last dinner works offline too
  document.addEventListener('visibilitychange', () => refreshFromServer({ force: true }));
  window.addEventListener('focus', () => refreshFromServer({ force: true }));
  render();
  enforceDietaryExpiry();

  // Phase 2: push this phone's own pending work first (step 2a's backfill), then pull whatever
  // changed on another phone signed into the same account (step 2b). Runs after render(), in the
  // background, so neither ever delays the offline boot paint.
  if (state.owner) {
    checkSession();
    trackPush(backfillPush().then(() => pullSync())).catch(() => {});
  }
}

// Catches this phone up with the server in both directions: pushes anything of its own the server
// doesn't have yet (a trip edited while offline, or a dropped pushJournalEntries call from an
// earlier, non-atomic push), then pulls anything another phone on the same account pushed that this
// phone doesn't have. Only push_trip/journal_entries reads/writes — no schema assumptions beyond
// what the owner's own Supabase project confirmed (26 Sep 2026).
async function backfillPush() {
  let remote;
  try { remote = await pullTripList(); } catch (error) { noteSyncProblem(error); return; } // offline, or not reachable yet: try again next boot
  const remoteById = new Map(remote.map((r) => [r.id, r.change_count]));
  for (const trip of state.trips.values()) {
    if (ctx.roleFor(trip.id) !== 'owner') continue; // shared with this person: nothing of theirs to send
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
        await sendGuestSheets(trip); // once per boot, for the guests' links
      }
    } catch (error) { noteSyncProblem(error); /* try again next boot */ }
  }
}

// ---------- Requests from colleagues ----------
// A Team colleague's change waits in the outbox on their device until it has been sent (works offline), then the OWNER'S device claims it,
// applies it through the one change function (the journal says who asked, and when), and records the outcome.
let flushing = false;
async function flushOutbox() {
  if (flushing || outbox.length === 0 || hasSession === false || !navigator.onLine) return;
  flushing = true;
  try {
    for (const request of [...outbox]) {
      try {
        await sendRequestRemote(request);
        outbox = outbox.filter((r) => r.id !== request.id);
        await dbPut('settings', outbox, 'outbox');
      } catch { break; /* the next round tries again */ }
    }
  } finally { flushing = false; }
}

// Fetches the guests' requests (a missing table, before the database update, or no internet simply leaves the list as it was).
async function loadGuestRequests() {
  if (!state.owner || hasSession === false || !navigator.onLine) return;
  try {
    const before = JSON.stringify(guestRequestRows.map((r) => [r.id, r.status]));
    guestRequestRows = await pullGuestRequests();
    // a new request, or an answer given elsewhere: redraw the screens that show them (not while a sheet is open)
    if (before !== JSON.stringify(guestRequestRows.map((r) => [r.id, r.status])) && !document.body.classList.contains('sheet-open') && /\/settings/.test(location.hash)) renderQuiet();
  } catch { /* the next round tries again */ }
}

// The guest is told their request was answered (if the owner left that kind of notification on).
function sendAnswer(row, note, outcome) {
  const trip = state.trips.get(row.trip_id);
  if (trip && notifySettings(trip).answer === false) return;
  notifyGuests(row.trip_id, [row.guest_id], { ...guestAnswerText({ ...row, note }, outcome), category: 'requests', priority: 'info' }).catch(() => {});
}

// After a change that matters to guests who turned notifications on, tell them (the owner chooses the kinds, Settings > Guest links; all on by default).
// Best effort: a problem here never blocks the change.
function notifyAfterChange(trip, entries) {
  if (ctx.roleFor(trip.id) !== 'owner') return;
  for (const n of notificationsFor(trip, entries)) {
    notifyGuests(trip.id, n.guestIds, { title: n.title, body: n.body, url: './', category: n.category, priority: 'info' }).catch(() => {});
  }
}

// The automatic reminders and the leader's alerts (scheduledMessages.js) are renewed on the server whenever the trip changes, when the app opens and
// when the phone is back online: the server then sends them at the right moment, even if this phone is shut. Best effort and quiet: a problem here
// never blocks anything (the next change or start tries again). Only the owner's phone does this, and only for a trip that is not archived.
const autoSent = new Map(); // tripId -> what was last sent, so nothing is sent twice for nothing
const autoTimers = new Map();
async function syncAutoMessages(tripId) {
  const trip = state.trips.get(tripId);
  if (!trip || !state.owner || hasSession === false || !navigator.onLine || ctx.roleFor(tripId) !== 'owner') return;
  const rows = plannedAutoMessages(trip);
  const signature = JSON.stringify(rows);
  if (autoSent.get(tripId) === signature) return;
  try { await replaceAutoMessages(tripId, rows); autoSent.set(tripId, signature); } catch { /* the next change tries again */ }
}
function syncAutoMessagesSoon(tripId) {
  clearTimeout(autoTimers.get(tripId));
  autoTimers.set(tripId, setTimeout(() => syncAutoMessages(tripId), 4000));
}

// The destination a colleague is tied to, asked from the server's member list (the owner's device is the one that applies requests, so it decides).
// If the list cannot be read, the request is NOT applied this round (it stays waiting): it never falls back to "the whole trip".
async function scopeOfRequester(row) {
  const members = await listMembers(row.trip_id);
  const member = members.find((m) => String(m.email).toLowerCase() === String(row.requester_email ?? '').toLowerCase());
  return member?.destination_id ?? null;
}

// A request that asks to force a move into a full tour is never applied by itself: it waits for the owner's decision.
const needsOwnerDecision = (row) => Array.isArray(row.changes) && row.changes.some((c) => c?.force === true);

// The owner's three answers to such a request: approve (the move is made, forced, journaled with the colleague's reason and the owner's name),
// put the guest on the tour's waiting list instead, or decline with a word for the colleague.
async function decideForcedRequest(id, how, note = null) {
  const row = requestRows.find((r) => r.id === id);
  if (!row || !['pending', 'failed'].includes(row.status) || ctx.roleFor(row.trip_id) !== 'owner') return;
  if (how === 'decline') { await finishRequest(id, 'declined', note || null); await processRequests(); render({ keepScroll: true }); return; }
  if (row.status === 'failed') await reopenRequest(id); // a request that "no longer fits" (the tour filled up) can still be forced or put on the waiting list by the owner
  if (!(await claimRequest(id))) return;
  const as = { id: row.requested_by, name: row.requester_name || row.requester_email || 'A colleague', role: 'team', scope: await scopeOfRequester(row) };
  const intoTour = (c) => c?.type === 'move' && c.to?.kind === 'activity';
  const changes = how === 'waitlist'
    ? row.changes.map((c) => (intoTour(c) ? { type: 'move', guestId: c.guestId, slotId: c.slotId, to: { kind: 'waitlist', activityId: c.to.activityId } } : c))
    : row.changes.map((c) => (intoTour(c) ? { ...c, force: true } : c));
  let result;
  try { result = await applyChange(ctx, row.trip_id, changes, { as, request: { id: row.id, at: row.requested_at }, forceApproved: how === 'approve' ? { by: state.owner.name } : undefined }); }
  catch { result = { ok: false, error: 'It could not be applied.' }; }
  await finishRequest(id, result.ok ? 'applied' : 'failed', result.ok ? null : result.error);
  await processRequests(); render({ keepScroll: true });
}

let processing = false;
async function processRequests() {
  if (processing || !state.owner || hasSession === false || !navigator.onLine) return;
  processing = true;
  try {
    requestRows = await pullRequests();
    for (const row of requestRows) {
      // only the owner's own devices apply requests, and only for trips they have; oldest first, so the earlier request wins
      if (row.status !== 'pending' || ctx.roleFor(row.trip_id) !== 'owner' || !state.trips.has(row.trip_id)) continue;
      if (needsOwnerDecision(row)) continue; // a colleague asked to FORCE a move: only the owner decides (Settings > Requests)
      if (!(await claimRequest(row.id))) continue; // another of the owner's devices has it
      const as = { id: row.requested_by, name: row.requester_name || row.requester_email || 'A colleague', role: 'team', scope: await scopeOfRequester(row) };
      let result;
      try { result = await applyChange(ctx, row.trip_id, row.changes, { as, request: { id: row.id, at: row.requested_at } }); }
      catch { result = { ok: false, error: 'It could not be applied.' }; }
      await finishRequest(row.id, result.ok ? 'applied' : 'failed', result.ok ? null : result.error);
    }
    requestRows = await pullRequests();
  } catch { /* the next round tries again */ }
  processing = false;
  if (/\/settings\/requests/.test(location.hash) && !document.body.classList.contains('sheet-open')) render({ keepScroll: true });
}

// ---------- Allergies and dietary needs are erased after the trip's last dinner (owner's rule) ----------
// Checked when the app opens, whenever it comes to the front, and after each pull from the server. Erases the text on every guest of
// the trip (through the one change function, so it syncs to the other devices), and deletes the "with dietary" documents of that trip
// (on every device, through the shared documents). Files already shared with, or backed up by, someone else are outside the app.
let erasing = false;
async function enforceDietaryExpiry() {
  if (erasing || !state.owner) return;
  erasing = true;
  try {
    const now = new Date();
    for (const trip of [...state.trips.values()]) {
      if (ctx.roleFor(trip.id) !== 'owner') continue; // the owner's devices erase, and it reaches this one through the sync
      const expiry = dietaryExpiry(trip);
      if (expiry === null || now.toISOString() < expiry) continue;
      if (dietaryErasureDue(trip, now)) await applyChange(ctx, trip.id, { type: 'erase-dietary' });
      for (const record of ctx.exportsFor(trip.id)) {
        if (/, with dietary$/.test(record.title)) await ctx.deleteExport(trip.id, record.id);
      }
    }
  } catch { /* the next check tries again */ }
  erasing = false;
}

// ---------- Documents shared between devices (Settings > Documents) ----------
// Saves one document on this device (database and screen state).
async function putExport(record) {
  await dbPut('exports', record);
  const list = state.exports.get(record.tripId) ?? [];
  state.exports.set(record.tripId, list.some((r) => r.id === record.id) ? list.map((r) => (r.id === record.id ? record : r)) : [...list, record]);
}

// Brings this device and the server level for documents, both ways, files included, so every document can be opened without
// internet. One at a time. A problem on one document never stops the others; the next round tries again.
let documentsInFlight = null;
let documentsAgain = false;
let documentsTimer = null;
const documentsInfo = { lastOkAt: null, waiting: 0 }; // for the line on the Documents page
function syncDocumentsSoon() { // after a local change: a moment later, once, whatever the number of changes
  clearTimeout(documentsTimer);
  documentsTimer = setTimeout(() => { syncDocuments().catch(() => {}); }, 300);
}
async function syncDocuments() {
  if (!state.owner || hasSession === false || !navigator.onLine) return;
  if (documentsInFlight) { documentsAgain = true; return documentsInFlight; }
  documentsInFlight = doSyncDocuments().finally(() => {
    documentsInFlight = null;
    if (documentsAgain) { documentsAgain = false; syncDocumentsSoon(); }
  });
  return documentsInFlight;
}
async function doSyncDocuments() {
  let rows;
  try { rows = await pullDocumentList(); } catch { return; } // offline or not reachable: the next round tries again
  const serverById = new Map(rows.map((row) => [row.id, row]));
  const everyLocal = [...state.exports.values()].flat(); // includes documents deleted here and waiting to be deleted on the server
  const localById = new Map(everyLocal.map((r) => [r.id, r]));
  let problems = 0;
  let changedScreen = false;

  for (const local of everyLocal) {
    const server = serverById.get(local.id);
    try {
      const decision = decideDocument(local, server?.data);
      const mine = ctx.roleFor(local.tripId) === 'owner'; // on a shared trip a person's own documents stay on their device
      if (!mine && ['upload', 'push', 'delete-remote'].includes(decision)) { if (decision === 'delete-remote') await removeExport(local); continue; }
      if (decision === 'upload') { await pushDocument(local, { withFile: true }); await markDocumentSent(local); }
      else if (decision === 'push') { await pushDocument(local, { withFile: false }); await markDocumentSent(local); }
      else if (decision === 'adopt') { await putExport({ ...server.data, blob: local.blob, dirty: false, syncedAt: new Date().toISOString() }); changedScreen = true; }
      else if (decision === 'delete-remote') { await deleteDocumentRemote(local.id); await removeExport(local); }
      else if (decision === 'delete-local') { await removeExport(local); changedScreen = true; }
    } catch { problems += 1; }
  }
  for (const server of rows) {
    if (localById.has(server.id)) continue;
    try { // a document this device does not have yet: fetched now, so it is there when there is no internet
      const text = await pullDocumentFile(server.id);
      if (text === null) continue;
      const meta = server.data;
      await putExport({ ...meta, blob: base64ToBlob(text, meta.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf'), dirty: false, syncedAt: new Date().toISOString() });
      changedScreen = true;
    } catch { problems += 1; }
  }
  if (problems === 0) documentsInfo.lastOkAt = new Date().toISOString();
  if (changedScreen && !document.body.classList.contains('sheet-open') && /\/settings\/exports/.test(location.hash)) render({ keepScroll: true });
}
// The server now has this version of the document. If it was changed again while it was being sent, it stays waiting to be sent.
async function markDocumentSent(sent) {
  const fresh = (state.exports.get(sent.tripId) ?? []).find((r) => r.id === sent.id) ?? sent;
  await putExport({ ...fresh, syncedAt: new Date().toISOString(), dirty: fresh.updatedAt !== sent.updatedAt });
}
async function removeExport(record) {
  await dbDelete('exports', record.id);
  state.exports.set(record.tripId, (state.exports.get(record.tripId) ?? []).filter((r) => r.id !== record.id));
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

// Works out, from the server's list, the role of the signed-in person on every trip they can see (their own, and those they were
// invited to), and remembers it on the device. Never blocks the pull: if it cannot be asked, the roles already known stay.
async function learnRoles(remote) {
  try {
    const { userId, invitations, scopes } = await pullMyAccess();
    if (!userId) return;
    for (const row of remote) {
      tripRoles.set(row.id, roleOf(row.owner_id, userId, invitations.get(row.id)));
      if (scopes.has(row.id)) tripScopes.set(row.id, scopes.get(row.id)); else tripScopes.delete(row.id);
    }
    await dbPut('settings', Object.fromEntries(tripRoles), 'tripRoles');
    await dbPut('settings', Object.fromEntries(tripScopes), 'tripScopes');
  } catch { /* keep what is known */ }
}

async function doPullSync() {
  let remote;
  try { remote = await pullTripList(); } catch (error) { noteSyncProblem(error); return; } // offline, or not reachable yet: try again later
  await learnRoles(remote);
  let failed = false;
  for (const row of remote) {
    try { await pullOneTrip(row.id, row.change_count); } catch (error) { failed = true; noteSyncProblem(error); /* try again next time */ }
  }
  if (!failed) noteSyncOk();
  await syncDocuments().catch(() => {}); // documents too: the file lands on this phone as soon as it exists
}

async function pullOneTrip(tripId, serverChangeCount) {
  const local = state.trips.get(tripId);
  const shared = ctx.roleFor(tripId) !== 'owner'; // this person cannot change it, so it can never be ahead of the server
  const decision = shared && local
    ? ((local.changeCount ?? 0) < serverChangeCount ? 'pull' : 'in-sync')
    : local
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
    // A refresh that happens on its own must never wipe a sheet the owner is filling in: if one is open,
    // the new data is already in place and simply shows at the next redraw.
    if (!document.body.classList.contains('sheet-open')) render({ keepScroll: true });
  });
}

// Keeps this phone up to date with the owner's other devices without anyone asking (owner's request,
// 1 Oct 2026). Two ways, both quiet (no sync-light flicker, nothing redrawn unless a trip actually changed):
//   - Live: the server tells this phone the moment another device changes a trip (watchServerChanges).
//   - Checking: every 5 seconds while the app is on screen, and the moment it comes back to the front. Once the live
//     connection is up this only happens once a minute, as a safety net; if the live connection is not up (not set up
//     on the server yet, or a bad connection), the 5-second checks carry on, so nothing depends on it.
// One refresh at a time.
const REFRESH_EVERY_MS = 5000;
const SAFETY_REFRESH_MS = 60000;
let refreshing = false;
let liveUp = false;        // is the live connection to the server working right now?
let liveStarting = false;
let lastRefreshAt = 0;
async function refreshFromServer({ force = false } = {}) {
  if (refreshing || !state.owner || hasSession === false || !navigator.onLine || document.visibilityState !== 'visible') return;
  if (!force && liveUp && Date.now() - lastRefreshAt < SAFETY_REFRESH_MS) return; // the live connection is doing the work
  refreshing = true;
  lastRefreshAt = Date.now();
  try { await backfillPush(); await pullSync(); await flushOutbox(); await processRequests(); await loadGuestRequests(); for (const id of [...state.trips.keys()]) await syncAutoMessages(id); } catch { /* the next refresh tries again */ }
  refreshing = false;
  startLive(); // (re)connects the live signal if it is not up yet; does nothing when it already is
}

// Pulling the screen down (pullRefresh.js): refresh right now, and always say what happened.
async function refreshByHand() {
  if (!state.owner) return;
  if (!navigator.onLine) { showToast('Offline: nothing to refresh.', true); return; }
  if (hasSession === false) { showToast('Not signed in online: open the sync light for details.', true); return; }
  await refreshFromServer({ force: true });
  showToast('Up to date');
}

let liveTimer = null;
async function startLive() {
  if (liveStarting || liveChannel || !state.owner || hasSession !== true) return;
  liveStarting = true;
  try {
    liveChannel = await watchServerChanges(
      () => { // many changes can arrive at once (a trip and its journal): wait a moment, then pull once
        liveUp = true; // proof that the live signal really works: the safety checks can now slow down
        clearTimeout(liveTimer);
        liveTimer = setTimeout(() => refreshFromServer({ force: true }), 400);
      },
      (up) => { if (!up) liveUp = false; }, // it counts as working only once a change has really arrived (below)
    );
  } catch { liveChannel = null; /* tried again at the next check */ }
  liveStarting = false;
}
let liveChannel = null;

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
    if (ctx.roleFor(trip.id) === 'owner') deleteTripRemote(trip.id).catch(() => {}); // only the owner may erase a trip on the server
  }
}

// Makes the app work without internet: the service worker (sw.js) keeps a copy of the app's files.
function registerOffline() {
  if (!('serviceWorker' in navigator)) return; // for example a plain http page: offline needs https
  navigator.serviceWorker.register('./sw.js').catch(() => {}); // if this fails the app still works online
}

start();
