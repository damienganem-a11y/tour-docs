// The staff inbox (owner's request, 15 Oct 2026): one list, on the main screen, of everything that is waiting for the person using the app, or that they
// should know: guest requests, requests waiting for their OK, requests that no longer fit, the answers to their own requests, seats freed on a tour with
// guests waiting, and messages from the team. Pure: it only reads what it is given (no screen, no network), so it can be tested.
//
// Two sorts of items:
//   - to do (guest request, waiting for your OK, no longer fits, a free seat): they stay in the inbox, and in the count, until the thing is dealt with;
//   - to read (an answer to your request, a team message): in the count until seen.

import { describeRequest } from './sync.js';
import { describeGuestRequest } from './guestRequests.js';
import { guestConversations } from './guestMessages.js';
import { tripWarnings, displayNames } from './rules.js';

const THREE_DAYS = 3 * 86400000;
const A_WEEK = 7 * 86400000;
const MAX_MESSAGES = 15; // the most recent messages from the team; Messages shows the latest 100

// ctx-free input: { trip, role, userId, requests (rows of this trip), guestRequests (rows of this trip), messages (rows of this trip),
//   holdsFor(row) -> true when a pending request waits for the owner's OK, seen: Set of item ids, now }
export function inboxItems({ trip, role, userId, requests = [], guestRequests = [], guestMessages = [], messages = [], holdsFor = () => false, conflict = false, seen = new Set(), now = Date.now() }) {
  const names = displayNames(trip.guests);
  const base = `#/trip/${trip.id}/settings`;
  const items = [];

  if (role === 'owner') {
    for (const row of guestRequests.filter((r) => r.status === 'pending')) {
      items.push({ id: `g:${row.id}`, kind: 'guest-request', todo: true, title: 'Guest request', detail: describeGuestRequest(trip, row, names), at: row.created_at, href: `${base}/requests` });
    }
    for (const c of guestConversations(guestMessages).filter((x) => x.unanswered)) {
      items.push({ id: `gm:${c.last.id}`, kind: 'guest-message', todo: true, title: `${names.get(c.guestId) ?? 'A guest'} wrote to the team`, detail: c.last.body, at: c.last.created_at, href: `${base}/requests` });
    }
    for (const row of requests.filter((r) => r.status === 'failed' && now - Date.parse(r.decided_at ?? r.requested_at) < 2 * A_WEEK)) { // older ones stay in Settings > Requests
      items.push({ id: `f:${row.id}`, kind: 'failed', todo: true, title: 'A request no longer fits', detail: `${row.requester_name || row.requester_email || 'A colleague'}: ${describeRequest(trip, row.changes, names) || 'a change'}`, at: row.decided_at ?? row.requested_at, href: `${base}/requests` });
    }
  }
  // What waits for this person's OK: the owner's, or an Advance's for their own destination (holdsFor says which).
  if (role === 'owner' || role === 'advance') {
    for (const row of requests.filter((r) => r.status === 'pending' && holdsFor(r))) {
      items.push({ id: `h:${row.id}`, kind: 'approval', todo: true, title: 'Waiting for your OK', detail: `${row.requester_name || row.requester_email || 'A colleague'}: ${describeRequest(trip, row.changes, names) || 'a change'}`, at: row.requested_at, href: `${base}/requests` });
    }
  }
  if (role !== 'owner') {
    // A colleague (Jet Staff, Advance): what became of their own requests lately.
    for (const row of requests.filter((r) => r.requested_by === userId && ['applied', 'declined', 'failed'].includes(r.status) && now - Date.parse(r.decided_at ?? r.requested_at) < THREE_DAYS)) {
      const word = row.status === 'applied' ? 'Done' : row.status === 'declined' ? 'Declined' : 'Did not fit';
      items.push({ id: `a:${row.id}:${row.status}`, kind: 'answer', todo: false, title: `Your request: ${word}`, detail: `${describeRequest(trip, row.changes, names) || 'a change'}${row.note ? `. ${row.note}` : ''}`, at: row.decided_at ?? row.requested_at, href: `${base}/requests` });
    }
  }

  // Two versions of the trip (this device was offline while somebody changed it): the owner chooses which to keep.
  if (conflict) items.push({ id: `c:${trip.id}`, kind: 'conflict', todo: true, title: 'Two versions of this trip', detail: 'Changes were made on this device while it was offline, and the trip was changed elsewhere meanwhile. Choose which one to keep.', at: null, href: '#' });

  for (const w of tripWarnings(trip).waitlistRoom) {
    items.push({ id: `w:${w.activity.id}:${w.free}:${w.waiting}`, kind: 'waitlist', todo: true, title: 'A seat is free', detail: `${w.activity.name}: ${w.waiting} waiting${w.free === null ? '' : `, ${w.free} seat${w.free === 1 ? '' : 's'} free`}`, at: null, href: `#/trip/${trip.id}/use/destination/${w.destination.id}/${w.slot.id}` });
  }

  for (const m of messages.filter((x) => x.sender_id !== userId && now - Date.parse(x.created_at) < A_WEEK).slice(-MAX_MESSAGES)) {
    items.push({ id: `m:${m.id}`, kind: 'message', todo: false, title: m.sender_name, detail: m.body, at: m.created_at, href: `${base}/messages` });
  }

  return items
    .map((item) => ({ ...item, unread: item.todo || !seen.has(item.id) }))
    .sort((a, b) => Number(b.todo) - Number(a.todo) || String(b.at ?? '').localeCompare(String(a.at ?? '')));
}

// What the little badge on the bell shows: every to-do item, plus every unread item to read.
export const inboxCount = (items) => items.filter((item) => item.todo || item.unread).length;
