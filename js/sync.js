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
