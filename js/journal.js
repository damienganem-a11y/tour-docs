// Reading the journal: turning the list of entries into "actions" a person can read, and finding
// what Undo would undo. Plain functions: they never change anything.
//
// The journal is a flat list of entries (see changes.js). Entries made by ONE action (a couple moved
// together, a cancelled tour with all its guests, an undo) share a `batchId`. Here they are grouped
// back together, so the screen shows one card per action.

import { joinNames, plural } from './rules.js';

// The kinds of journal lines that belong to a roll call (see changes.js).
const ROLLCALL_TYPES = new Set(['rollcall-start', 'rollcall-end', 'rollcall-reopen', 'checkin', 'checkout', 'vehicle-add', 'vehicle-number']);
// The return count was taken out of the app (v0.7.1). A phone that used it (v0.7.0) still has its lines in the journal:
// they stay readable, but can no longer be undone.
const RETURN_COUNT_TYPES = new Set(['return-start', 'return-in', 'return-out']);

// Entries of one action, in the order they were written (`n`), and actions in the order they happened (`seq`).
const inBatchOrder = (a, b) => (a.n ?? 0) - (b.n ?? 0);
const inTimeOrder = (a, b) => a.seq - b.seq || a.at.localeCompare(b.at);

// All the actions of a trip, oldest first. An action looks like:
//   { batchId, seq, at, who, place, slotId, slotLabel, entries, kind: 'move' | 'cancel-tour' | 'undo', undone: true/false }
// `undone` is true when a later Undo took this action back.
export function groupBatches(entries) {
  const byBatch = new Map();
  for (const entry of entries) {
    if (!byBatch.has(entry.batchId)) byBatch.set(entry.batchId, []);
    byBatch.get(entry.batchId).push(entry);
  }
  const undone = new Set(entries.filter((e) => e.type === 'undo').map((e) => e.undoesBatchId));

  return [...byBatch.entries()].map(([batchId, list]) => {
    const sorted = [...list].sort(inBatchOrder);
    const first = sorted[0];
    const types = new Set(sorted.map((e) => e.type));
    // End roll call and Re-open roll call also move guests, but they are still roll call actions.
    const onlyRollCall = types.has('rollcall-end') || types.has('rollcall-reopen') || (!types.has('move') && [...types].some((t) => ROLLCALL_TYPES.has(t)));
    return {
      batchId, entries: sorted,
      seq: Math.max(...sorted.map((e) => e.seq ?? 0)), at: first.at, who: first.who,
      place: first.place, slotId: first.slotId, slotLabel: first.slotLabel,
      kind: types.has('undo') ? 'undo'
        : [...types].some((t) => RETURN_COUNT_TYPES.has(t)) ? 'old-return-count'
        : types.has('replace-destination') ? 'replace-destination'
        : types.has('cancel-tour') ? 'cancel-tour'
        : onlyRollCall ? 'rollcall'
        : types.has('edit-destination') ? 'edit-destination'
        : types.has('add-activity') ? 'add-activity'
        : types.has('edit-activity') ? 'edit-activity'
        : types.has('edit-guest') ? 'edit-guest'
        : types.has('guest-left') ? 'guest-left'
        : types.has('guest-return') ? 'guest-return'
        : types.has('make-solo') ? 'make-solo'
        : types.has('join-party') ? 'join-party'
        : types.has('create-party') ? 'create-party'
        : types.has('archive-trip') ? 'archive-trip'
        : types.has('unarchive-trip') ? 'unarchive-trip'
        : types.has('delete-trip') ? 'delete-trip'
        : types.has('reinstate-trip') ? 'reinstate-trip'
        : 'move',
      rollCallId: sorted.find((e) => e.rollCallId)?.rollCallId ?? null, // set when the action belongs to a roll call
      undone: undone.has(batchId),
    };
  }).sort(inTimeOrder);
}

// What the Undo button would undo: the latest action that is not an undo and not already undone.
// Pressing Undo again then reaches the action before it, and so on (like Ctrl+Z). Returns null if none.
// Undo scopes (see lastUndoable below), one per "section" of the app, so each screen's Undo only ever
// offers to take back something that belongs there.
export const USE_UNDO_SCOPE = ['move', 'cancel-tour'];                // By destination, By guest
export const DESTINATION_UNDO_SCOPE = ['edit-destination', 'replace-destination', 'add-activity', 'edit-activity']; // Settings > Destinations
export const GUEST_UNDO_SCOPE = ['edit-guest', 'guest-left', 'guest-return', 'make-solo', 'join-party', 'create-party']; // Settings > Guests, Travel parties
// (a roll call screen uses { rollCallId } instead, scoped to that one roll call — see rollcall.js)

// scope narrows which action counts as "the last one", so each screen's Undo only offers to take back
// something that belongs there — opening a guest's page should never offer to undo a change made on a
// destination's tour, and vice versa. Omit it for the true trip-wide last action (used by Undo itself,
// which must always resolve to exactly what the button that was tapped showed).
//   scope undefined        any action
//   scope ['kind', ...]    only batches of one of these kinds (see groupBatches)
//   scope { rollCallId }   only batches of that one roll call (its start, check-ins, End roll call...)
export function lastUndoable(entries, scope) {
  const matches = (batch) => {
    if (!scope) return true;
    if (Array.isArray(scope)) return scope.includes(batch.kind);
    return batch.rollCallId === scope.rollCallId;
  };
  const candidates = groupBatches(entries).filter((b) => b.kind !== 'undo' && b.kind !== 'old-return-count' && !b.undone && matches(b));
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

// Who is in a tour RIGHT NOW because a move was forced (the dispatcher's decision). Returns a Map:
// "guestId|slotId" -> the journal line of that forced move (who approved it, who made it, when).
// Only the latest action for a guest in a half-day counts: if they were moved again afterwards, or the
// forced move was undone, they are no longer in the list.
export function forcedPlacements(entries) {
  const latest = new Map();
  for (const batch of groupBatches(entries)) {          // oldest first
    if (batch.kind === 'undo' || batch.undone) continue; // an undone action no longer counts
    for (const entry of batch.entries) {
      if (entry.type === 'move') latest.set(`${entry.guestId}|${entry.slotId}`, entry);
    }
  }
  return new Map([...latest].filter(([, entry]) => entry.forced));
}

// One line saying what an action did, e.g. "Moved Richard S. and Priya S. from Sintra palaces to At leisure".
export function summarize(batch) {
  if (batch.kind === 'undo') return `Undid: ${batch.entries[0].undoesSummary}`;

  if (batch.kind === 'cancel-tour') {
    const tour = batch.entries.find((e) => e.type === 'cancel-tour');
    return `Cancelled ${tour.activityLabel}${tour.guestCount > 0 ? ` (${plural(tour.guestCount, 'guest')} moved to At leisure)` : ''}`;
  }

  if (batch.kind === 'old-return-count') return 'Return count (no longer part of the app)';
  if (batch.kind === 'replace-destination') return summarizeReplaceDestination(batch);
  if (batch.kind === 'edit-destination') return summarizeEditDestination(batch.entries[0]);
  if (batch.kind === 'add-activity') { const e = batch.entries[0]; return `Added "${e.activityLabel}" (${e.slotLabel})`; }
  if (batch.kind === 'edit-activity') return summarizeEditActivity(batch.entries[0]);
  if (batch.kind === 'edit-guest') return summarizeEditGuest(batch.entries[0]);
  if (batch.kind === 'guest-left') return `${batch.entries[0].guestName} left the trip`;
  if (batch.kind === 'guest-return') return `${batch.entries[0].guestName} is back on the trip`;
  if (batch.kind === 'make-solo') return `${batch.entries[0].guestName} now has their own travel party (solo)`;
  if (batch.kind === 'join-party') return summarizeJoinParty(batch.entries[0]);
  if (batch.kind === 'create-party') return `New travel party: ${joinNames(batch.entries[0].guestNames)}`;
  if (batch.kind === 'rollcall') return summarizeRollCall(batch);
  if (batch.kind === 'archive-trip') return 'Archived the trip';
  if (batch.kind === 'unarchive-trip') return 'Un-archived the trip';
  if (batch.kind === 'delete-trip') return 'Deleted the trip';
  if (batch.kind === 'reinstate-trip') return 'Reinstated the trip';

  // Guests who went from the same place to the same place are told together.
  const groups = new Map();
  for (const entry of batch.entries.filter((e) => e.type === 'move')) {
    const key = `${entry.from.label}|${entry.to.label}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const text = [...groups.values()]
    .map((list) => `Moved ${joinNames(alphaNames(list))}${list[0].from.kind === 'blank' ? '' : ` from ${list[0].from.label}`} to ${list[0].to.label}`)
    .join('; ');

  // A move into a full tour, decided by the dispatcher: say so, and who approved it if it was written down.
  const forced = batch.entries.filter((e) => e.forced);
  if (forced.length === 0) return text;
  const approvers = [...new Set(forced.map((e) => e.approvedBy).filter(Boolean))];
  return `${text} (forced${approvers.length > 0 ? `, approved by ${approvers.join(' and ')}` : ''})`;
}

// The guest names of some journal lines, alphabetical (the names are already the ones shown on screen).
const alphaNames = (entries) => entries.map((e) => e.guestName).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

// One line for one roll call action (a whole travel party checked in together is one action).
function summarizeRollCall(batch) {
  const entry = batch.entries[0];
  if (entry.type === 'rollcall-start') return `Started the roll call: ${entry.activityLabel} (${entry.vehicles.join(', ')})`;
  if (entry.type === 'rollcall-end') {
    // The guests End roll call moved to At leisure are the "move" lines of the same action.
    const moved = alphaNames(batch.entries.filter((e) => e.type === 'move'));
    const parts = [`${entry.checkedInCount} checked in`];
    if (moved.length > 0) parts.push(`${moved.length} moved to At leisure by End roll call (${joinNames(moved)})`);
    if (entry.keptCount > 0) parts.push(`${entry.keptCount} stayed on the tour without a vehicle`);
    return `Ended the roll call: ${parts.join(', ')}`;
  }
  if (entry.type === 'rollcall-reopen') {
    // The guests put back on the tour are the "move" lines of the same action.
    const back = alphaNames(batch.entries.filter((e) => e.type === 'move'));
    const parts = [back.length > 0 ? `${plural(back.length, 'guest')} put back on the tour (${joinNames(back)})` : 'nobody had to be put back'];
    if (entry.leftOutNames.length > 0) parts.push(`${joinNames(entry.leftOutNames)} could not be put back: the tour is full`);
    return `Re-opened the roll call: ${parts.join(', ')}`;
  }
  if (entry.type === 'checkin') {
    if (batch.entries.length > 1) return `${joinNames(alphaNames(batch.entries))} checked in to ${entry.vehicleLabel}`;
    if (entry.fromVehicleLabel) return `${entry.guestName} moved from ${entry.fromVehicleLabel} to ${entry.vehicleLabel}`;
    return `${entry.guestName} checked in to ${entry.vehicleLabel}`;
  }
  if (entry.type === 'checkout') return `${entry.guestName} taken out of ${entry.fromVehicleLabel}`;
  if (entry.type === 'vehicle-add') return `Added ${entry.vehicleLabel}`;
  return `${entry.fromLabel} renumbered ${entry.toLabel}`; // vehicle-number
}

// What changed about a destination, in words ("Marrakech renamed to Fez, time zone set to Africa/Casablanca").
function summarizeEditDestination(entry) {
  const changed = [];
  if (entry.from.name !== entry.to.name) changed.push(`renamed to "${entry.to.name}"`);
  if (entry.from.country !== entry.to.country) changed.push(`country set to "${entry.to.country}"`);
  if (entry.from.timeZone !== entry.to.timeZone) changed.push(`time zone set to ${entry.to.timeZone}`);
  return `${entry.from.name} ${changed.length > 0 ? changed.join(', ') : 'updated (nothing actually changed)'}`;
}

// A destination replaced by another: its tours cancelled and everybody moved to At leisure (their own lines
// are elsewhere in the same card), then the destination's own fields changed.
function summarizeReplaceDestination(batch) {
  const entry = batch.entries.find((e) => e.type === 'replace-destination');
  const parts = [];
  if (entry.cancelledCount > 0) parts.push(`${plural(entry.cancelledCount, 'tour')} cancelled`);
  if (entry.movedCount > 0) parts.push(`${plural(entry.movedCount, 'guest')} moved to At leisure`);
  return `Replaced ${entry.from.name} with ${entry.to.name}${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`;
}

// What changed about an activity, in words.
function summarizeEditActivity(entry) {
  const changed = [];
  if (entry.from.name !== entry.to.name) changed.push(`renamed to "${entry.to.name}"`);
  if (entry.from.meeting !== entry.to.meeting) changed.push('meeting point updated');
  if (entry.from.capacity !== entry.to.capacity) changed.push(`capacity set to ${entry.to.capacity === null ? 'no limit' : entry.to.capacity}`);
  if (entry.from.startsAt !== entry.to.startsAt) changed.push('time updated');
  return `"${entry.from.name}": ${changed.length > 0 ? changed.join(', ') : 'updated (nothing actually changed)'}`;
}

// What changed about a guest's own name, in words.
function summarizeEditGuest(entry) {
  const changed = [];
  if (entry.from.first !== entry.to.first || entry.from.last !== entry.to.last) changed.push(`renamed to "${entry.to.first} ${entry.to.last}"`);
  if ((entry.from.seat ?? null) !== (entry.to.seat ?? null)) changed.push(entry.to.seat ? `seat set to ${entry.to.seat}` : 'seat cleared');
  return `${entry.guestName}${changed.length > 0 ? ` ${changed.join(', ')}` : ' updated (nothing actually changed)'}`;
}

// A guest joining another travel party, named by who is already in it (if anyone is left to name).
function summarizeJoinParty(entry) {
  const withWhom = entry.otherMemberNames.length > 0 ? ` with ${joinNames(entry.otherMemberNames)}` : '';
  const renamed = entry.fromType !== entry.toType ? `, now called "${entry.toType}"` : '';
  return `${entry.guestName} joined the travel party${withWhom}${renamed}`;
}

// Did this action force a move into a full tour?
export const wasForced = (batch) => batch.entries.some((e) => e.forced);

// The guests an action concerns (for searching by guest).
export const guestNamesOf = (batch) => [...new Set(batch.entries.filter((e) => e.guestName).map((e) => e.guestName))];

// What the Journal shows: one card per action, EXCEPT that everything that belongs to one roll call is folded
// into one card for that roll call (its check-ins are listed inside). Newest first.
//   { kind: 'batch', batch, batches: [batch], first, seq }
//   { kind: 'rollcall', rollCallId, batches: [oldest first], first, seq }
export function journalItems(batches) {
  const items = [];
  const byRollCall = new Map();
  for (const batch of batches) { // oldest first
    if (!batch.rollCallId) {
      items.push({ kind: 'batch', batch, batches: [batch], first: batch });
      continue;
    }
    if (!byRollCall.has(batch.rollCallId)) {
      const item = { kind: 'rollcall', rollCallId: batch.rollCallId, batches: [], first: batch };
      byRollCall.set(batch.rollCallId, item);
      items.push(item);
    }
    byRollCall.get(batch.rollCallId).batches.push(batch);
  }
  for (const item of items) item.seq = Math.max(...item.batches.map((b) => b.seq));
  return items.sort((a, b) => b.seq - a.seq);
}
