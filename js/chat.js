// The messaging inbox and chat, the pure part (v0.133.0, owner's request 27 Oct 2026: "like WhatsApp, so there is no question of using anything else").
// No page and no network here: the leader's tests check it. The screens are in views/settingsGuestMessages.js (staff) and guest/guest.js (guest); the shared
// chat window is chatUi.js. Message rows are the ones of guestMessages.js: { id, trip_id, guest_id, direction, body, created_at, read_at, sender_name }.

const pad = (n) => String(n).padStart(2, '0');
const localDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dayDiff = (a, b) => Math.round((Date.parse(`${localDay(b)}T12:00:00`) - Date.parse(`${localDay(a)}T12:00:00`)) / 86400000);

// "14:32", in the phone's own time.
export const clockOf = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// The label of a day inside a chat: Today, Yesterday, a weekday for the last week, else the date ("Mon 12 Oct 2026").
export function dayLabel(iso, now = new Date()) {
  const date = new Date(iso); const diff = dayDiff(date, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return date.toLocaleDateString('en-GB', { weekday: 'long' });
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// The time shown at the right of a conversation in the list: the clock today, "Yesterday", a weekday this week, else the date (12/10/2026).
export function listTime(iso, now = new Date()) {
  const date = new Date(iso); const diff = dayDiff(date, now);
  if (diff <= 0) return clockOf(iso);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return date.toLocaleDateString('en-GB', { weekday: 'short' });
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// The messages of a conversation cut into days, oldest first, each day with its label: [{ key, label, messages }].
export function groupByDay(messages, now = new Date()) {
  const sorted = [...messages].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const days = [];
  for (const m of sorted) {
    const key = localDay(new Date(m.created_at));
    if (!days.length || days.at(-1).key !== key) days.push({ key, label: dayLabel(m.created_at, now), messages: [] });
    days.at(-1).messages.push(m);
  }
  return days;
}

// Two letters for the round picture of a conversation ("Anna A." -> "AA").
export function initialsOf(name) {
  const words = String(name ?? '').replace(/[^\p{L}\s'-]/gu, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words.at(-1)[0]).toUpperCase();
}
// A stable colour for a name: one of a few calm hues (the screens turn the number into a colour).
export function hueOf(name) { let n = 0; for (const ch of String(name ?? '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0; return n % 360; }

// The inbox: one row per guest who wrote (or was written to), the latest conversation first.
//   rows: guest_messages rows of the trip.  states: guest_thread_state rows ({ guest_id, flagged }).  names: guestId -> name.
// A row: { guestId, name, last, preview, mine (the last word is the staff's), time, unread (guest messages nobody has opened), flagged (marked as unread by hand),
//   dot (show the red mark), waiting (the guest's word is the last and nobody answered) }.
export function inboxList(rows, states, names, now = new Date()) {
  const byGuest = new Map();
  for (const m of rows) { if (!byGuest.has(m.guest_id)) byGuest.set(m.guest_id, []); byGuest.get(m.guest_id).push(m); }
  const flaggedIds = new Set((states ?? []).filter((s) => s.flagged).map((s) => s.guest_id));
  return [...byGuest.entries()].map(([guestId, list]) => {
    const sorted = [...list].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const last = sorted.at(-1);
    const unread = sorted.filter((m) => m.direction === 'guest' && !m.read_at).length;
    const flagged = flaggedIds.has(guestId);
    return { guestId, name: names.get(guestId) ?? 'A guest', last, preview: last.body.replace(/\s+/g, ' ').slice(0, 90), mine: last.direction === 'staff',
      time: listTime(last.created_at, now), unread, flagged, dot: unread > 0 || flagged, waiting: last.direction === 'guest' };
  }).sort((a, b) => String(b.last.created_at).localeCompare(String(a.last.created_at)));
}

// How many conversations need the staff: unopened, marked as unread, or still waiting for an answer. This is the red number on the envelope and on the app's icon.
export const attentionCount = (list) => list.filter((c) => c.dot || c.waiting).length;

// A guest's own count for the red number on their app's icon: staff answers they have not opened.
export const guestUnread = (rows) => rows.filter((m) => m.direction === 'staff' && !m.read_at).length;

// Reminder choices for "a message waits too long" (minutes; 0 = no reminder).
export const REMIND_CHOICES = [[0, 'No reminder'], [15, 'After 15 minutes'], [30, 'After 30 minutes'], [60, 'After 1 hour'], [120, 'After 2 hours']];
export const REMIND_DEFAULT = 30;
export const remindMinutesError = (value) => (Number.isInteger(value) && REMIND_CHOICES.some(([m]) => m === value) ? null : 'Choose one of the reminder times.');

// Saved answers the staff tap in a chat (the owner edits them; these until then). Plain sentences, no allergies or private details.
export const DEFAULT_QUICK_REPLIES = [
  'Thank you, we are on it and will come back to you shortly.',
  'Please come and see us at reception.',
  'Yes, see you in the lounge.',
  'No problem at all, enjoy your day!',
];
export const quickRepliesOf = (trip) => (Array.isArray(trip?.quickReplies) && trip.quickReplies.length ? trip.quickReplies : DEFAULT_QUICK_REPLIES);
