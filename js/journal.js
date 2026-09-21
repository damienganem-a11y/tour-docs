// Reading the journal: turning the list of entries into "actions" a person can read, and finding
// what Undo would undo. Plain functions: they never change anything.
//
// The journal is a flat list of entries (see changes.js). Entries made by ONE action (a couple moved
// together, a cancelled tour with all its guests, an undo) share a `batchId`. Here they are grouped
// back together, so the screen shows one card per action.

import { joinNames, plural } from './rules.js';

// The kinds of journal lines that belong to a roll call (see changes.js).
const ROLLCALL_TYPES = new Set(['rollcall-start', 'checkin', 'checkout', 'vehicle-add', 'vehicle-number']);

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
    const onlyRollCall = !types.has('move') && [...types].some((t) => ROLLCALL_TYPES.has(t));
    return {
      batchId, entries: sorted,
      seq: Math.max(...sorted.map((e) => e.seq ?? 0)), at: first.at, who: first.who,
      place: first.place, slotId: first.slotId, slotLabel: first.slotLabel,
      kind: types.has('undo') ? 'undo' : types.has('cancel-tour') ? 'cancel-tour' : onlyRollCall ? 'rollcall' : 'move',
      rollCallId: sorted.find((e) => e.rollCallId)?.rollCallId ?? null, // set when the action belongs to a roll call
      undone: undone.has(batchId),
    };
  }).sort(inTimeOrder);
}

// What the Undo button would undo: the latest action that is not an undo and not already undone.
// Pressing Undo again then reaches the action before it, and so on (like Ctrl+Z). Returns null if none.
export function lastUndoable(entries) {
  const candidates = groupBatches(entries).filter((b) => b.kind !== 'undo' && !b.undone);
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

  if (batch.kind === 'rollcall') return summarizeRollCall(batch);

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
  if (entry.type === 'checkin') {
    if (batch.entries.length > 1) return `${joinNames(alphaNames(batch.entries))} checked in to ${entry.vehicleLabel}`;
    return entry.fromVehicleLabel ? `${entry.guestName} moved from ${entry.fromVehicleLabel} to ${entry.vehicleLabel}` : `${entry.guestName} checked in to ${entry.vehicleLabel}`;
  }
  if (entry.type === 'checkout') return `${entry.guestName} taken out of ${entry.fromVehicleLabel}`;
  if (entry.type === 'vehicle-add') return `Added ${entry.vehicleLabel}`;
  return `${entry.fromLabel} renumbered ${entry.toLabel}`; // vehicle-number
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
