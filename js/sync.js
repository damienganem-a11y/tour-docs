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
  const { data, error } = await supabase.from('journal_entries').select('data')
    .eq('trip_id', tripId).gt('seq', afterSeq).order('seq', { ascending: true });
  if (error) throw error;
  return data.map((row) => row.data);
}

// The guests' personal sheets (Phase 5): one row per link. `rows` is [{ token, guestId, active, sheet }] from guestSheet.js. A switched-off
// link keeps no content. Rows of this trip whose secret is no longer on the trip (a renewed link) are deleted, so an old link
// stops working at once. `rows` may be only the sheets that changed; `currentTokens` is every secret the trip has now. Owner only (the server's rules say so too).
export async function pushGuestSheets(tripId, rows, currentTokens = rows.map((r) => r.token)) {
  const supabase = await getClient();
  if (rows.length > 0) {
    const { error } = await supabase.from('guest_links').upsert(
      rows.map((r) => ({ token: r.token, trip_id: tripId, guest_id: r.guestId, active: r.active, data: r.sheet ?? {}, updated_at: new Date().toISOString() })),
      { onConflict: 'token' });
    if (error) throw error;
  }
  const query = supabase.from('guest_links').delete().eq('trip_id', tripId);
  const { error } = await (currentTokens.length > 0 ? query.not('token', 'in', `(${currentTokens.join(',')})`) : query);
  if (error) throw error;
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
    .subscribe((status) => onStatus(status === 'SUBSCRIBED'));
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

export const MEMBER_ROLES = ['team', 'viewer'];

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
  if (!session) return { userId: null, invitations: new Map() };
  const { data, error } = await supabase.from('trip_members').select('trip_id, role').ilike('email', session.user.email ?? '');
  if (error) throw error;
  return { userId: session.user.id, invitations: new Map(data.map((row) => [row.trip_id, row.role])) };
}

export async function listMembers(tripId) {
  const supabase = await getClient();
  const { data, error } = await supabase.from('trip_members').select('email, role, created_at').eq('trip_id', tripId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}
export async function inviteMember(tripId, email, role) {
  const supabase = await getClient();
  const { error } = await supabase.from('trip_members').upsert({ trip_id: tripId, email, role }, { onConflict: 'trip_id,email' });
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
  const { data, error } = await supabase.from('requests')
    .select('id, trip_id, requested_by, requester_email, requester_name, changes, requested_at, status, note, decided_at')
    .order('requested_at', { ascending: true }).limit(300);
  if (error) throw error;
  return data;
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
export async function notifyMe(message) {
  const supabase = await getClient();
  const { data, error } = await supabase.functions.invoke('send-push', { body: { kind: 'to-me', ...message } });
  if (error) throw error;
  return data;
}
