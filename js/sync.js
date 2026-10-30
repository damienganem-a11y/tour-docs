// Pushing trip data to Supabase, one small safety-net step before trips can be pulled onto another
// device (Phase 2, step 2b). Same discipline as auth.js: every function here does real network
// work, so none of it is ever called from the normal, fully-offline boot path — only after a local
// change, which already succeeded locally regardless of whether this push ever completes.

import { getClient } from './auth.js';

// Returns { accepted }: false means the server already has a change_count at or ahead of ours
// (another device pushed first) — step 2b's reconcile will handle that; this step just backs off
// silently, since the local change is already safely saved on this phone either way.
export async function pushTrip(trip) {
  const supabase = await getClient();
  const { data, error } = await supabase.rpc('push_trip', {
    p_id: trip.id, p_data: trip, p_change_count: trip.changeCount ?? 0,
  });
  if (error) throw error;
  return { accepted: data.length > 0 };
}

// Live editing: writes the trip AND its new journal entries in one step, but only if the server is still at the version this device started from
// (`base`). Returns { accepted: true }, or { accepted: false, stale: true } when somebody else wrote in between (the caller refreshes and tries again).
// Throws when the server cannot be reached, or when this person is not allowed to write (an Expert, or a removed colleague).
export async function applyTripUpdate(trip, base, entries) {
  const supabase = await getClient();
  const { data, error } = await supabase.rpc('apply_trip_update', { p_id: trip.id, p_data: trip, p_base: base, p_new: trip.changeCount, p_entries: entries });
  if (error) throw error;
  return { accepted: data?.accepted === true, stale: data?.reason === 'stale', missing: data?.reason === 'missing' };
}

// Entries are immutable and already have a globally-unique client-generated id (see ids.js), so
// re-pushing ones the server already has is always safe: ignored, not duplicated.
export async function pushJournalEntries(tripId, entries) {
  if (entries.length === 0) return;
  const supabase = await getClient();
  const rows = entries.map((e) => ({ id: e.id, trip_id: tripId, seq: e.seq, data: e }));
  const { error } = await supabase.from('journal_entries').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
}

// Read-only discovery: which trips this owner already has on the server, and how far along each
// one is. Used by the one-time backfill AND by step 2b's pull (below) to find what's changed.
export async function pullTripList() {
  const supabase = await getClient();
  const { data, error } = await supabase.from('trips').select('id, change_count, owner_id'); // RLS: the person's own trips, and trips they were invited to
  if (error) throw error;
  return data;
}

// Phase 2, step 2b: pulling a trip (and its journal) onto a phone that doesn't have this device's
// full up-to-date copy yet — a second phone signed into the same account, or this phone catching up
// after another one pushed ahead of it.

// The full trip row. Returns null if it no longer exists on the server (deleted from another phone).
export async function pullTrip(tripId) {
  const supabase = await getClient();
  const { data, error } = await supabase.from('trips').select('data, change_count').eq('id', tripId).maybeSingle();
  if (error) throw error;
  return data; // { data: <the trip object>, change_count } or null
}

// Journal entries newer than afterSeq, oldest first — so re-pulling a trip this phone already knows
// part of only fetches what's new, never the whole history again.
export async function pullJournalEntries(tripId, afterSeq = 0) {
  const supabase = await getClient();
  // The server answers at most 1000 rows at a time, so a long trip is read page by page.
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('journal_entries').select('data')
      .eq('trip_id', tripId).gt('seq', afterSeq).order('seq', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    out.push(...data.map((row) => row.data));
    if (data.length < 1000) return out;
  }
}

// The guests' personal sheets (Phase 5): one row per link. `rows` is [{ token, guestId, active, sheet }] from guestSheet.js. A switched-off
// link keeps no content. Rows of this trip whose secret is no longer on the trip (a renewed link) are deleted, so an old link
// stops working at once. `rows` may be only the sheets that changed; `currentTokens` is every secret the trip has now. Owner only (the server's rules say so too).
// The sheets go in small groups, never all in one request: with the Passport games a sheet is about 100 KB, so 40 guests are 4 MB, and one request that size
// can fail on a weak signal or run past the server's time limit, leaving every guest with an old programme or none (27 Oct 2026). A group that fails is tried
// again twice, with a pause; `onSent(rows)` is told after each group, so what already arrived is not sent again next time.
const SHEET_GROUP_BYTES = 400 * 1024;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function sheetGroups(rows, limit = SHEET_GROUP_BYTES) {
  const groups = []; let group = []; let size = 0;
  for (const row of rows) {
    const bytes = JSON.stringify(row.sheet ?? {}).length;
    if (group.length > 0 && size + bytes > limit) { groups.push(group); group = []; size = 0; }
    group.push(row); size += bytes;
  }
  if (group.length > 0) groups.push(group);
  return groups;
}
export async function pushGuestSheets(tripId, rows, currentTokens = rows.map((r) => r.token), onSent = () => {}) {
  const supabase = await getClient();
  for (const group of sheetGroups(rows)) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabase.from('guest_links').upsert(
        group.map((r) => ({ token: r.token, trip_id: tripId, guest_id: r.guestId, active: r.active, data: r.sheet ?? {}, updated_at: new Date().toISOString() })),
        { onConflict: 'token' });
      lastError = error;
      if (!error) break;
      await pause(1500 * 2 ** attempt);
    }
    if (lastError) throw lastError;
    onSent(group);
  }
  const query = supabase.from('guest_links').delete().eq('trip_id', tripId);
  const { error } = await (currentTokens.length > 0 ? query.not('token', 'in', `(${currentTokens.join(',')})`) : query);
  if (error) throw error;
}

// The part of the guests' programmes that is the same for everyone (tours, Passport games), kept once per trip (v0.136.0, migration 0030).
export async function pushGuestShared(tripId, version, data) {
  const supabase = await getClient();
  const { error } = await supabase.from('guest_shared').upsert({ trip_id: tripId, version, data, updated_at: new Date().toISOString() }, { onConflict: 'trip_id' });
  if (error) throw error;
}

// What the server holds for each of the trip's guest links (owner only): [{ guest_id, token_start, active, has_sheet, bytes, updated_at }].
export async function guestLinkStatus(tripId) {
  const supabase = await getClient();
  const { data, error } = await supabase.rpc('guest_link_status', { p_trip: tripId });
  if (error) throw error;
  return data;
}

// A purged trip (deleted locally 30 days ago) is erased on the server too, so no other phone on the
// account ever pulls it back from the dead.
export async function deleteTripRemote(tripId) {
  const supabase = await getClient();
  await supabase.from('journal_entries').delete().eq('trip_id', tripId);
  await supabase.from('documents').delete().eq('trip_id', tripId);
  await supabase.from('guest_links').delete().eq('trip_id', tripId);
  const { error } = await supabase.from('trips').delete().eq('id', tripId);
  if (error) throw error;
}

// Pure and network-free, so it's easy to unit-test: given what this phone knows about a trip, should
// it pull the server's copy?
//   'pull'      the server is ahead, and this phone has nothing of its own still unconfirmed to lose
//   'conflict'  both sides have diverged from what was last confirmed synced — do nothing
//               automatically (no in-app conflict resolution built yet; matches ROADMAP's own
//               colleague-conflict-inbox being later work)
//   'in-sync'   nothing to pull
export function decideSync({ localChangeCount, pushedChangeCount, serverChangeCount }) {
  if (serverChangeCount <= localChangeCount) return 'in-sync';
  return localChangeCount <= (pushedChangeCount ?? 0) ? 'pull' : 'conflict';
}

// ---------- "Sync details" (the screen behind the sync light) ----------
// Sync only works when THIS browser holds a live Supabase login. Being signed in inside the app (a name and
// an email saved on the phone) is not the same thing, and neither is "Skip this for now". Without a live
// login the server does not raise an error: it just answers "no trips", so a phone could look fine while
// nothing moved. These functions exist so the owner can SEE which case they are in.

// Asks the online service (needs internet). Throws if it cannot be reached at all.
// Returns { email, serverCount }: email is null when this browser has no live login.
export async function syncProbe() {
  const supabase = await getClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { email: null, serverCount: null };
  const trips = await pullTripList();
  return { email: session.user.email, serverCount: trips.length };
}

// Turns a technical error into a sentence the owner can act on.
export function plainSyncError(message) {
  const text = String(message ?? '');
  if (/jwt|not authenticated|not authorized|permission|row-level|violates not-null|auth/i.test(text)) {
    return 'The online account did not accept this phone\'s login. Sign out and sign in again with the email link.';
  }
  if (/failed to fetch|network|load failed|timeout/i.test(text)) return 'The online service could not be reached.';
  return text || 'Something went wrong while syncing.';
}

// Pure and network-free (so it is unit-tested): what to tell the owner.
//   online       navigator.onLine
//   probe        the result of syncProbe(), or null if it could not run
//   probeError   the message if syncProbe() threw
//   localCount   trips on this phone
//   lastError    the last problem a push or pull hit (already in plain words), or null
//   lastOkAt     ISO moment of the last push or pull that worked, or null
// Returns { ok, headline, lines[] }.
export function diagnoseSync({ online, probe, probeError, localCount, lastError, lastOkAt }) {
  const lines = [];
  if (!online) {
    return { ok: false, headline: 'Offline', lines: ['No internet right now. Changes are saved on this phone and will sync when it is back online.'] };
  }
  if (probeError) {
    return { ok: false, headline: 'Cannot reach the online service', lines: [plainSyncError(probeError)] };
  }
  if (!probe || probe.email === null) {
    return {
      ok: false,
      needsSignIn: true,
      headline: 'Not signed in online: nothing is syncing',
      lines: [
        'This phone has your name saved, but no live online login. That happens after "Skip this for now", or when the email link was finished in a different browser.',
        'Fix: tap "Sign in online" below and type the code from the email.',
      ],
    };
  }
  // Everything fine: just say so (the owner does not want a list of trips here). Details only when something is off.
  if (probe.serverCount !== localCount) lines.push(`Trips on this phone: ${localCount}. Trips on the server: ${probe.serverCount}.`);
  if (probe.serverCount < localCount) lines.push('Some trips on this phone have not reached the server yet. They push on their next change or when the app is reopened.');
  if (probe.serverCount > localCount) lines.push('The server has trips this phone does not have yet. Close the app completely and reopen it to pull them.');
  if (lastOkAt) lines.push(`Last successful sync: ${new Date(lastOkAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`);
  if (lastError) lines.push(`Last problem: ${lastError}`);
  return { ok: !lastError, headline: `Signed in online as ${probe.email}`, lines };
}

// Live "something changed" signal from the server (Supabase Realtime), so a phone hears about another device's change
// within a second or two instead of waiting for the next check. It carries no data: the app just runs its normal pull.
// onChange() is called for every change to one of the owner's trips; onStatus(true|false) says whether the live
// connection is up (the app checks the server often while it is not). Needs the trips table added to the
// "supabase_realtime" publication (see SPEC.md); without that it stays silent and the regular checks carry on.
export async function watchServerChanges(onChange, onStatus) {
  const supabase = await getClient();
  return supabase.channel('tour-docs-trips')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guest_requests' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guest_messages' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guest_thread_state' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_messages' }, () => onChange())
    .subscribe((status) => onStatus(status === 'SUBSCRIBED'));
}

// "Check this phone" (Settings > Control): does the server have everything this version of the app needs? Each answer is yes or no, never an error.
// The live function is asked about a trip that does not exist: it answers "missing" when it is there (and nothing is written).
// tripId: a trip this person can reach. With it the check goes through the REAL permission code of the live function
// (a made-up trip would answer "missing" before any permission is looked at, which hid a real bug once).
export async function probeServerFeatures(tripId = null) {
  const supabase = await getClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { email: null };
  const worked = (answer) => !answer.error;
  const [members, messages, requests, live, modes] = await Promise.all([
    supabase.from('trip_members').select('approval').limit(1),
    supabase.from('team_messages').select('id').limit(1),
    supabase.from('requests').select('requester_role').limit(1),
    supabase.rpc('apply_trip_update', { p_id: tripId ?? crypto.randomUUID(), p_data: {}, p_base: 0, p_new: tripId ? 0 : 1, p_entries: [] }),
    supabase.from('trip_members').select('ui_mode').limit(1),
  ]);
  // With a real trip, passing the permission check ends in the 'bad version' refusal (nothing is ever written);
  // a trip not on the server yet answers 'missing', which still proves the function exists.
  const liveOk = tripId ? /bad version/.test(live.error?.message ?? '') || (worked(live) && live.data?.reason === 'missing') : worked(live) && live.data?.reason === 'missing';
  return { email: session.user.email, controlLevels: worked(members), teamMessages: worked(messages), requesterColumns: worked(requests), liveFunction: liveOk, simpleFull: worked(modes) };
}

// ---------- Messages between the people working on a trip (migration 0017) ----------
// after (an ISO moment): only the messages written later than that. Without it, the latest 100 of the conversation.
export async function listTeamMessages(tripId, after = null) {
  const supabase = await getClient();
  let query = supabase.from('team_messages').select('*').eq('trip_id', tripId);
  if (after) query = query.gt('created_at', after);
  const { data, error } = await query.order('created_at', { ascending: Boolean(after) }).limit(100);
  if (error) throw error;
  return after ? data : [...data].reverse(); // oldest first either way
}
export async function sendTeamMessage(tripId, senderName, body) {
  const supabase = await getClient();
  const { error } = await supabase.from('team_messages').insert({ trip_id: tripId, sender_name: senderName, body });
  if (error) throw error;
}

// ---------- Documents (Settings > Documents), shared like trips (owner's request, 1 Oct 2026) ----------
// Every document made on one device is copied to the server and comes down to the other devices at once, file included, so
// it can be opened without internet (a plane, a bus in the desert). Table `documents`: id, trip_id, owner_id, data (the
// document's name, version, format, dates... everything but the file), file (the file itself, as base64 text), updated_at.

// The document's own details, without the file and without this device's private bookkeeping.
export function documentMeta(record) {
  const { blob, syncedAt, dirty, ...meta } = record; // eslint-disable-line no-unused-vars
  return meta;
}

// A file (Blob) to text and back, so it fits in a table column.
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
export function base64ToBlob(text, type) {
  const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}

// What is on the server: every document's details, but NOT its file (downloaded only for documents this device lacks).
export async function pullDocumentList() {
  const supabase = await getClient();
  const { data, error } = await supabase.from('documents').select('id, trip_id, data');
  if (error) throw error;
  return data;
}
export async function pullDocumentFile(id) {
  const supabase = await getClient();
  const { data, error } = await supabase.from('documents').select('file').eq('id', id).maybeSingle();
  if (error) throw error;
  return data?.file ?? null;
}
// First time on the server: details and file. Later changes (rename, archive) send only the details.
export async function pushDocument(record, { withFile }) {
  const supabase = await getClient();
  const row = { id: record.id, trip_id: record.tripId, data: documentMeta(record) };
  if (withFile) row.file = await blobToBase64(record.blob);
  const { error } = await supabase.from('documents').upsert(row, { onConflict: 'id' });
  if (error) throw error;
}
export async function deleteDocumentRemote(id) {
  const supabase = await getClient();
  const { error } = await supabase.from('documents').delete().eq('id', id);
  if (error) throw error;
}

// Pure and network-free, so it is easy to test: what should this device do about ONE document?
//   local   this device's copy (or undefined); it may carry `deletedAt` (deleted here, not yet deleted on the server),
//           `dirty` (changed here, not yet sent) and `syncedAt` (the server has had it at some point)
//   server  the server's details for it (or undefined)
// Answers: 'download' | 'upload' | 'push' | 'adopt' | 'delete-remote' | 'delete-local' | 'none'
// When both sides changed, the newest change (updatedAt) wins.
export function decideDocument(local, server) {
  if (local?.deletedAt) return server ? 'delete-remote' : 'delete-local';
  if (!local) return 'download';
  if (!server) return local.syncedAt ? 'delete-local' : 'upload'; // once known to the server and now gone: deleted on another device
  const localAt = local.updatedAt ?? local.createdAt ?? '';
  const serverAt = server.updatedAt ?? server.createdAt ?? '';
  if (local.dirty && localAt >= serverAt) return 'push';
  if (serverAt > localAt) return 'adopt';
  return 'none';
}

// ---------- Team: who else can see a trip (Settings > Team) ----------
// The owner of a trip invites people by e-mail address; they sign in with that address and see the trip. Roles: 'team' and 'viewer'
// (both view-only in this first version). The owner is whoever owns the trip. Server side: supabase/team.sql.

// 'team' is shown as Jet Staff, 'advance' as Advance (one destination), 'viewer' as Expert (looks only). The names inside stay as they were.
export const MEMBER_ROLES = ['team', 'advance', 'viewer'];

// The address as it will be stored (lowercase, no spaces), or null when it cannot be an e-mail address.
export function cleanInviteEmail(text) {
  const email = String(text ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// Pure: the role of the signed-in person on one trip, from the trip's owner and their invitation (if any).
// A trip they neither own nor were invited to is not visible to them at all; an unknown role is treated as the safest one.
export function roleOf(ownerId, userId, invitedAs) {
  if (ownerId && userId && ownerId === userId) return 'owner';
  return MEMBER_ROLES.includes(invitedAs) ? invitedAs : 'viewer';
}

// Who the signed-in person is, and the trips they were invited to: { userId, invitations: Map(tripId -> role) }.
export async function pullMyAccess() {
  const supabase = await getClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { userId: null, invitations: new Map(), scopes: new Map(), approvals: new Map() };
  const { data, error } = await supabase.from('trip_members').select('*').ilike('email', session.user.email ?? ''); // '*': "approval" exists once migration 0014 is applied
  if (error) throw error;
  return {
    userId: session.user.id, invitations: new Map(data.map((row) => [row.trip_id, row.role])), scopes: new Map(data.filter((row) => row.destination_id).map((row) => [row.trip_id, row.destination_id])),
    approvals: new Map(data.map((row) => [row.trip_id, row.approval === 'review' ? 'review' : 'direct'])),
    modes: new Map(data.map((row) => [row.trip_id, row.ui_mode === undefined || row.ui_mode === 'full' ? 'full' : 'simple'])), // 'simple' until the owner unlocks the person; no column yet (migration 0022 not applied): full
  };
}

export async function listMembers(tripId) {
  const supabase = await getClient();
  // select('*'): the "approval" column exists once migration 0014 is applied; until then the list still works.
  const { data, error } = await supabase.from('trip_members').select('*').eq('trip_id', tripId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}
// approval: 'direct' (the colleague's requests are applied as soon as they fit) or 'review' (every request waits for the owner's OK).
// uiMode: 'simple' (the default) or 'full': whether the colleague sees the full app or the simple one (migration 0022).
export async function inviteMember(tripId, email, role, destinationId = null, approval = 'direct', uiMode = 'simple') {
  const supabase = await getClient();
  const row = { trip_id: tripId, email, role, destination_id: role === 'advance' ? destinationId : null, approval: role === 'team' || role === 'advance' ? approval : 'direct', ui_mode: uiMode === 'full' ? 'full' : 'simple' };
  let { error } = await supabase.from('trip_members').upsert(row, { onConflict: 'trip_id,email' });
  // Before migration 0014 the column does not exist: "direct" is what the server does anyway, so it is saved without it.
  if (error && /ui_mode/i.test(error.message)) { delete row.ui_mode; ({ error } = await supabase.from('trip_members').upsert(row, { onConflict: 'trip_id,email' })); } // the server does not know migration 0022 yet
  if (error && /approval/i.test(error.message) && row.approval === 'direct') { delete row.approval; ({ error } = await supabase.from('trip_members').upsert(row, { onConflict: 'trip_id,email' })); }
  if (error) throw error;
}
export async function removeMember(tripId, email) {
  const supabase = await getClient();
  const { error } = await supabase.from('trip_members').delete().eq('trip_id', tripId).eq('email', email);
  if (error) throw error;
}

// ---------- Requests from colleagues (Settings > Requests; server side: supabase/requests.sql) ----------
// A Team colleague's change is sent as a request: a row holding the change(s) exactly as the one change function takes them. The OWNER'S
// device claims it, applies it, and records the outcome. Statuses: pending, applying, applied, failed (does not fit any more), declined.

export async function sendRequestRemote(request) {
  const supabase = await getClient();
  const { error } = await supabase.from('requests').insert({
    id: request.id, trip_id: request.tripId, requester_name: request.requesterName, changes: request.changes, requested_at: request.requestedAt,
  });
  if (error && !/duplicate key/i.test(error.message)) throw error; // sending the same request twice is harmless
}

// The requests this person can see: all on the trips they own, and their own on others. Oldest first.
export async function pullRequests() {
  const supabase = await getClient();
  // Everything still waiting or being applied (never lost on a long trip), plus the 300 most recent answered ones, oldest first.
  // '*': requester_role / requester_scope / requester_approval exist once migration 0018 is applied.
  const [open, recent] = await Promise.all([
    supabase.from('requests').select('*').in('status', ['pending', 'applying', 'failed']).order('requested_at', { ascending: true }).limit(1000),
    supabase.from('requests').select('*').order('requested_at', { ascending: false }).limit(300),
  ]);
  if (open.error) throw open.error;
  if (recent.error) throw recent.error;
  const byId = new Map([...open.data, ...recent.data].map((r) => [r.id, r]));
  return [...byId.values()].sort((a, b) => String(a.requested_at).localeCompare(String(b.requested_at)));
}

// Takes a pending request so that only ONE of the owner's devices applies it. A claim left behind by a device that stopped half-way
// (older than 2 minutes) may be taken over. Returns true when this device now holds it.
export async function claimRequest(id) {
  const supabase = await getClient();
  const now = new Date().toISOString();
  const first = await supabase.from('requests').update({ status: 'applying', decided_at: now }).eq('id', id).eq('status', 'pending').select('id');
  if (first.error) throw first.error;
  if (first.data.length > 0) return true;
  const stale = new Date(Date.now() - 120000).toISOString();
  const second = await supabase.from('requests').update({ status: 'applying', decided_at: now }).eq('id', id).eq('status', 'applying').lt('decided_at', stale).select('id');
  if (second.error) throw second.error;
  return second.data.length > 0;
}

export async function finishRequest(id, status, note = null) {
  const supabase = await getClient();
  const { error } = await supabase.from('requests').update({ status, note, decided_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// A colleague takes back a request that is still waiting (nothing happens if the owner's device already took it).
export async function cancelRequestRemote(id) {
  const supabase = await getClient();
  const { data, error } = await supabase.from('requests').update({ status: 'cancelled' }).eq('id', id).eq('status', 'pending').select('id');
  if (error) throw error;
  return data.length > 0;
}

// The owner asks for another go at a request that no longer fitted.
export async function reopenRequest(id) {
  const supabase = await getClient();
  const { error } = await supabase.from('requests').update({ status: 'pending', note: null }).eq('id', id);
  if (error) throw error;
}

// What a request says, in a few words, from the trip it concerns: "Amira Y. to At leisure (Day 1 · Afternoon)".
export function describeRequest(trip, changes, names) {
  const slotName = (slotId) => { const s = trip?.slots.find((x) => x.id === slotId); return s ? `Day ${s.day} · ${s.half}` : ''; };
  return (changes ?? []).map((c) => {
    const guest = trip?.guests.find((g) => g.id === c.guestId);
    const who = guest ? (names?.get(guest.id) ?? `${guest.first} ${guest.last}`) : '';
    if (c.type === 'move') {
      const target = c.to?.kind === 'leisure' ? 'At leisure' : c.to?.kind === 'waitlist' ? 'a waitlist' : trip?.activities.find((a) => a.id === c.to?.activityId)?.name ?? 'another tour';
      return `${who} to ${target} (${slotName(c.slotId)})`;
    }
    if (c.type === 'book-dinner' || c.type === 'add-to-dinner-table') {
      const restaurant = trip?.restaurants.find((r) => r.id === (c.restaurantId ?? trip.dinnerBookings.find((b) => b.id === c.bookingId)?.restaurantId))?.name ?? 'a restaurant';
      return `Dinner at ${restaurant}${c.seating ? `, ${c.seating}` : ''}`;
    }
    if (c.type === 'move-dinner-table') return 'Move a dinner table';
    if (c.type === 'checkin' || c.type === 'checkout') return `${c.type === 'checkin' ? 'Check in' : 'Check out'} ${who}`;
    return String(c.type).replace(/-/g, ' ');
  }).join('; ');
}


// ---------- Requests from guests, and notifications (v0.81.0) ----------
// The guests' requests ("switch me to that tour"), on the trips this person owns (the server's rules say so), newest first.
export async function pullGuestRequests() {
  const supabase = await getClient();
  const { data, error } = await supabase.from('guest_requests')
    .select('id, trip_id, guest_id, kind, payload, status, note, created_at, decided_at')
    .order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return data;
}

// The owner's answer. Only a request still waiting can be answered (a guest may have taken it back): returns true when this answer was recorded.
export async function answerGuestRequest(id, status, note = null) {
  const supabase = await getClient();
  const { data, error } = await supabase.from('guest_requests')
    .update({ status, note, decided_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending').select('id');
  if (error) throw error;
  return data.length > 0;
}

// Messages from guests to the team (v0.127.0), on the trips this person owns (the server's rules say so), oldest first.
export async function pullGuestMessages() {
  const supabase = await getClient();
  const { data, error } = await supabase.from('guest_messages')
    .select('id, trip_id, guest_id, direction, topic, body, sender_id, sender_name, created_at, read_at')
    .order('created_at', { ascending: false }).limit(2000);
  if (error) throw error;
  return data.reverse();
}
// A staff member writes to a guest (an answer, or the first word). sender = { id, name }: the name stays on the message for good. Returns the saved row.
export async function answerGuestMessage(tripId, guestId, body, sender) {
  const supabase = await getClient();
  const { data, error } = await supabase.from('guest_messages')
    .insert({ trip_id: tripId, guest_id: guestId, direction: 'staff', body: String(body).trim().slice(0, 1000), sender_id: sender.id, sender_name: sender.name })
    .select('id, trip_id, guest_id, direction, topic, body, sender_id, sender_name, created_at, read_at').single();
  if (error) throw error;
  return data;
}
// The owner opened a guest's conversation: its messages are marked as read.
export async function markGuestMessagesRead(tripId, guestId) {
  const supabase = await getClient();
  const { error } = await supabase.from('guest_messages').update({ read_at: new Date().toISOString() })
    .eq('trip_id', tripId).eq('guest_id', guestId).eq('direction', 'guest').is('read_at', null);
  if (error) throw error;
}

// ---------- Messaging as an inbox (v0.133.0) ----------
// The hand-made "unread" marks of the conversations (shared by the staff of a trip, like a shared inbox).
export async function pullGuestThreads() {
  const supabase = await getClient();
  const { data, error } = await supabase.from('guest_thread_state').select('trip_id, guest_id, flagged, flagged_at').limit(2000);
  if (error) throw error;
  return data;
}
export async function setGuestThreadFlag(tripId, guestId, flagged, userId) {
  const supabase = await getClient();
  const { error } = await supabase.from('guest_thread_state').upsert({ trip_id: tripId, guest_id: guestId, flagged, flagged_by: flagged ? userId : null, flagged_at: flagged ? new Date().toISOString() : null }, { onConflict: 'trip_id,guest_id' });
  if (error) throw error;
}
// How long a guest's message may wait before the staff are reminded (minutes, 0 = never): kept on the server for its timer; the owner's phone saves it.
export async function saveMessageSettings(tripId, ownerId, remindMinutes) {
  const supabase = await getClient();
  const { error } = await supabase.from('message_settings').upsert({ trip_id: tripId, owner_id: ownerId, remind_after_min: remindMinutes, updated_at: new Date().toISOString() }, { onConflict: 'trip_id' });
  if (error) throw error;
}

// ---------- Our Album (v0.128.0): the staff side. The files are handled by the server function `album`; the rows are read directly (the owner's rules say who sees what). ----------
// Photos (not deleted) of a trip, oldest first, and, for the owner, what each guest has saved. Returns { photos, marks, settings }.
export async function pullAlbum(tripId) {
  const supabase = await getClient();
  const photos = await supabase.from('album_photos').select('id, trip_id, guest_id, author_name, caption, pinned, width, height, created_at')
    .eq('trip_id', tripId).is('deleted_at', null).order('created_at', { ascending: false }).limit(1500);
  if (photos.error) throw photos.error;
  const marks = await supabase.from('album_marks').select('guest_id, photo_id, state').eq('trip_id', tripId).limit(20000);
  const settings = await supabase.from('album_settings').select('enabled, upload_until, download_until, purged_at').eq('trip_id', tripId).maybeSingle();
  return { photos: photos.data, marks: marks.error ? [] : marks.data, settings: settings.data ?? null };
}
// The owner's phone keeps the server's copy of the album's settings (on/off and the two last days) in step with the trip.
export async function saveAlbumSettings(tripId, ownerId, { enabled, uploadUntil, downloadUntil }) {
  const supabase = await getClient();
  const { error } = await supabase.from('album_settings').upsert({ trip_id: tripId, owner_id: ownerId, enabled, upload_until: uploadUntil, download_until: downloadUntil, updated_at: new Date().toISOString() }, { onConflict: 'trip_id' });
  if (error) throw error;
}
async function albumFetch(init) {
  const supabase = await getClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session?.session?.access_token;
  if (!token) throw new Error('Sign in online first.');
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('./supabase-config.js');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/album`, { method: 'POST', ...init, headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  return response.json();
}
// Links (valid for an hour) for photos: { id: url }. size: 'thumb' | 'full'.
export async function albumLinks(tripId, ids, size = 'thumb') {
  const out = {};
  for (let i = 0; i < ids.length; i += 60) {
    const r = await albumFetch({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'urls', tripId, ids: ids.slice(i, i + 60), size }) });
    if (r.ok) Object.assign(out, r.urls);
  }
  return out;
}
export async function albumUpload(tripId, author, { full, thumb, width, height }) {
  const form = new FormData();
  form.append('action', 'upload'); form.append('tripId', tripId); form.append('author', author); form.append('w', String(width)); form.append('h', String(height));
  form.append('file', full, 'photo.jpg'); form.append('thumb', thumb, 'thumb.jpg');
  return albumFetch({ body: form });
}
export async function albumAct(tripId, action, id, extra = {}) {
  return albumFetch({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, tripId, id, ...extra }) });
}

// Notifications. The public key lives in the database (the setup workflow put it there); the private one only in the sending function.
export async function getPushPublicKey() {
  const supabase = await getClient();
  const { data, error } = await supabase.rpc('get_push_public_key');
  if (error) throw error;
  return data || null;
}
export async function saveOwnerPush(fields) {
  const supabase = await getClient();
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) throw new Error('Sign in online first.');
  const { error } = await supabase.from('push_subscriptions').upsert(
    { kind: 'owner', trip_id: '*', owner_id: userId, endpoint: fields.endpoint, p256dh: fields.p256dh, auth: fields.auth }, { onConflict: 'endpoint' });
  if (error) throw error;
}
export async function removeOwnerPush(endpoint) {
  const supabase = await getClient();
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('kind', 'owner');
  if (error) throw error;
}
// Asks the sending function to notify guests (all the trip's guests who said "notify me", or only guestIds). Returns { sent }.
export async function notifyGuests(tripId, guestIds, message) {
  const supabase = await getClient();
  const { data, error } = await supabase.functions.invoke('send-push', { body: { kind: 'to-guests', tripId, guestIds, ...message } });
  if (error) throw error;
  return data;
}
// How many of the trip's guests can be reached by notification, and the last messages sent (owner only). Returns { guests_on, recent } or null.
export async function guestPushOverview(tripId) {
  const supabase = await getClient();
  const { data, error } = await supabase.rpc('guest_push_overview', { p_trip: tripId });
  if (error) throw error;
  return data;
}
// A one-time code (4 digits, 30 minutes) for ONE device of a guest, made by the server for the owner of the trip. Needs the guest's link to be on and synced.
export async function makeGuestCode(tripId, guestId) {
  const supabase = await getClient();
  const { data, error } = await supabase.rpc('make_guest_code', { p_trip: tripId, p_guest: guestId });
  if (error) throw error;
  return data;
}
// A one-time sign-in for an invited colleague (made by the server for the trip's owner): { token_hash, type }. It goes into a QR code (settingsTeam.js).
export async function teamSignInToken(tripId, email) {
  const supabase = await getClient();
  const { data, error } = await supabase.functions.invoke('send-push', { body: { kind: 'team-link', tripId, email } });
  if (error) throw error;
  if (!data?.token_hash) throw new Error(data?.error ?? 'no token');
  return data;
}
export async function notifyMe(message) {
  const supabase = await getClient();
  const { data, error } = await supabase.functions.invoke('send-push', { body: { kind: 'to-me', ...message } });
  if (error) throw error;
  return data;
}

// ---------- Scheduled messages and automatic reminders (v0.88.0) ----------
// The messages wait in the table scheduled_messages; a timer on the server sends them at the exact moment, even if this phone is shut.
export async function listScheduled(tripId) {
  const supabase = await getClient();
  const { data, error } = await supabase.from('scheduled_messages').select('id, send_at, audience, guest_ids, title, body, priority, source, status').eq('trip_id', tripId).eq('status', 'pending').order('send_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
export async function scheduleMessage(tripId, row) {
  const supabase = await getClient();
  const { error } = await supabase.from('scheduled_messages').insert({ ...row, trip_id: tripId, source: 'manual' });
  if (error) throw error;
}
export async function cancelScheduled(id) {
  const supabase = await getClient();
  const { error } = await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', id).eq('status', 'pending');
  if (error) throw error;
}
// The automatic messages of one trip, as worked out by scheduledMessages.js: the server keeps exactly these (plus those already sent).
export async function replaceAutoMessages(tripId, rows) {
  const supabase = await getClient();
  const { error } = await supabase.rpc('replace_auto_messages', { p_trip: tripId, p_rows: rows });
  if (error) throw error;
}
export async function schedulerStatus() {
  const supabase = await getClient();
  const { data, error } = await supabase.rpc('scheduler_status');
  if (error) throw error;
  return data;
}
