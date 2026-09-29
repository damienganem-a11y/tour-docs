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
  const { data, error } = await supabase.from('trips').select('id, change_count'); // RLS scopes this to the signed-in owner
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

// A purged trip (deleted locally 30 days ago) is erased on the server too, so no other phone on the
// account ever pulls it back from the dead.
export async function deleteTripRemote(tripId) {
  const supabase = await getClient();
  await supabase.from('journal_entries').delete().eq('trip_id', tripId);
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
  lines.push(`Trips on this phone: ${localCount}. Trips on the server: ${probe.serverCount}.`);
  if (probe.serverCount < localCount) lines.push('Some trips on this phone have not reached the server yet. They push on their next change or when the app is reopened.');
  if (probe.serverCount > localCount) lines.push('The server has trips this phone does not have yet. Close the app completely and reopen it to pull them.');
  if (lastOkAt) lines.push(`Last successful sync: ${new Date(lastOkAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`);
  if (lastError) lines.push(`Last problem: ${lastError}`);
  return { ok: !lastError, headline: `Signed in online as ${probe.email}`, lines };
}
