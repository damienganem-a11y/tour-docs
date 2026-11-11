// "Since you last looked" (v0.153.0, owner's request of 11 Nov 2026): on Today, what OTHER people changed in the trip since this person last said
// "Got it". Reassuring for someone who opens the app twice a day: nothing changed behind their back without them seeing it.
// The moment is kept on this phone only (localStorage), per trip. Pure parts can be tested; the screen part is in views/today.js.

import { groupBatches, summarize } from './journal.js';

const KEY = (tripId) => `td-seen-${tripId}`;
// Changes that say nothing useful to a colleague in the field (a face, the guest app's links, the archive's automatic erasing).
const QUIET = new Set(['set-photo', 'guest-links', 'erase-dietary', 'old-return-count']);

export function lastSeen(tripId) {
  try { return localStorage.getItem(KEY(tripId)); } catch { return null; }
}
export function markSeen(tripId, at = new Date().toISOString()) {
  try { localStorage.setItem(KEY(tripId), at); } catch { /* not kept: shown again next time */ }
}

// What changed after `since` (an ISO moment), by somebody other than `myId`: [{ at, who, text }], newest first. A first visit (no moment yet) shows
// nothing: the person has not "missed" anything yet. Undone actions are left out (they did not happen in the end).
export function changesSince(entries, since, myId) {
  if (!since) return [];
  return groupBatches(entries)
    .filter((b) => b.at > since && !b.undone && b.kind !== 'undo' && !QUIET.has(b.kind) && b.who?.id && b.who.id !== myId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((b) => { let text; try { text = summarize(b); } catch { text = null; } return { at: b.at, who: b.who?.name ?? 'Someone', text }; })
    .filter((c) => c.text); // a line that cannot be said in words is left out rather than breaking Today
}
