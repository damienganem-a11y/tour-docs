// Messages between guests and the staff team (v0.127.0). A guest writes from their app; the owner answers from Settings > Requests.
// This file is the pure part: no network, no screen. A row (as the server keeps it):
//   { id, trip_id, guest_id, direction: 'guest' | 'staff', topic, body, created_at, read_at }
// A conversation is all the rows of one guest, oldest first. The Journal does not hold these words (they are free text, and may touch private matters).

export const GUEST_MESSAGE_TOPICS = [['question', 'A question'], ['problem', 'A problem here'], ['other', 'Something else']];
export const GUEST_MESSAGE_MAX = 1000;

// One conversation per guest who wrote, the most recently active first: { guestId, rows, unanswered, unread, last }.
//   unanswered: the guest's last word has no staff answer after it.   unread: how many guest messages the owner has not opened.
export function guestConversations(rows) {
  const byGuest = new Map();
  for (const row of rows) {
    if (!byGuest.has(row.guest_id)) byGuest.set(row.guest_id, []);
    byGuest.get(row.guest_id).push(row);
  }
  return [...byGuest.entries()].map(([guestId, list]) => {
    const sorted = [...list].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const last = sorted[sorted.length - 1];
    return { guestId, rows: sorted, last, unanswered: last.direction === 'guest', unread: sorted.filter((m) => m.direction === 'guest' && !m.read_at).length };
  }).sort((a, b) => String(b.last.created_at).localeCompare(String(a.last.created_at)));
}

// How many staff answers this guest has not opened yet (for the dot on their app's button).
export const unreadAnswers = (rows) => rows.filter((m) => m.direction === 'staff' && !m.read_at).length;

// What the guest is told when the owner answers.
export function guestMessageAnswerText(body) {
  const text = String(body ?? '').trim();
  return { title: 'Your leader answered', body: text.length > 120 ? `${text.slice(0, 117)}...` : text };
}
