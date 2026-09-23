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
// one is. Used in this step only for the one-time backfill (app.js); step 2b builds real
// reconciliation (pulling a trip down onto a new device) on top of this same call.
export async function pullTripList() {
  const supabase = await getClient();
  const { data, error } = await supabase.from('trips').select('id, change_count'); // RLS scopes this to the signed-in owner
  if (error) throw error;
  return data;
}
