// Reading the journal: turning the list of entries into "actions" a person can read, and finding
// what Undo would undo. Plain functions: they never change anything.
//
// The journal is a flat list of entries (see changes.js). Entries made by ONE action (a couple moved
// together, a cancelled tour with all its guests, an undo) share a `batchId`. Here they are grouped
// back together, so the screen shows one card per action.

import { joinNames, plural } from './rules.js';

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
    return {
      batchId, entries: sorted,
      seq: Math.max(...sorted.map((e) => e.seq ?? 0)), at: first.at, who: first.who,
      place: first.place, slotId: first.slotId, slotLabel: first.slotLabel,
      kind: sorted.some((e) => e.type === 'undo') ? 'undo' : sorted.some((e) => e.type === 'cancel-tour') ? 'cancel-tour' : 'move',
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

// One line saying what an action did, e.g. "Moved Richard S. and Priya S. from Sintra palaces to At leisure".
export function summarize(batch) {
  if (batch.kind === 'undo') return `Undid: ${batch.entries[0].undoesSummary}`;

  if (batch.kind === 'cancel-tour') {
    const tour = batch.entries.find((e) => e.type === 'cancel-tour');
    return `Cancelled ${tour.activityLabel}${tour.guestCount > 0 ? ` (${plural(tour.guestCount, 'guest')} moved to At leisure)` : ''}`;
  }

  // Guests who went from the same place to the same place are told together.
  const groups = new Map();
  for (const entry of batch.entries) {
    const key = `${entry.from.label}|${entry.to.label}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()]
    .map((list) => `Moved ${joinNames(list.map((e) => e.guestName))}${list[0].from.kind === 'blank' ? '' : ` from ${list[0].from.label}`} to ${list[0].to.label}`)
    .join('; ');
}

// The guests an action concerns (for searching by guest).
export const guestNamesOf = (batch) => batch.entries.filter((e) => e.type === 'move').map((e) => e.guestName);
