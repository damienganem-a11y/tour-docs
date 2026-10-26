// Messages between guests and the staff team (v0.127.0). A guest writes from their app; the owner answers from Settings > Requests.
// This file is the pure part: no network, no screen. A row (as the server keeps it):
//   { id, trip_id, guest_id, direction: 'guest' | 'staff', topic, body, created_at, read_at }
// A conversation is all the rows of one guest, oldest first. The Journal does not hold these words (they are free text, and may touch private matters).

// Messages are a RECORD: nothing is edited or deleted (see supabase/migrations/0026).
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

// ---------- the record (v0.130.0) ----------
// Every message, both ways, is kept with its exact time, who wrote it and when it was read, and can never be edited or deleted (the database refuses).
// What follows turns the rows into the "record" the owner can download for the file: a printable PDF and a spreadsheet (CSV).

// The name written under a staff message. A name that was never filled in can be stored as the words "null null": that is never shown.
export function staffDisplayName(name, fallback = 'Staff') {
  const text = String(name ?? '').trim();
  return !text || /\b(null|undefined)\b/i.test(text) ? fallback : text.slice(0, 60);
}

const ZONE = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };
// "26 Oct 2026, 15:42:07 GMT+2" in the phone's own time (the exact moment is also written in UTC in the spreadsheet).
export function momentText(iso, timeZone = ZONE()) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short', timeZone });
}

// Conversations ready to print: [{ guestId, name, messages: [{ at, when, from, who, topic, body, readAt, read }] }], guests in alphabetical order, messages oldest first.
// `names` maps a guest id to the name to show.
export function messageRecord(rows, names, staffLabel = 'Staff', timeZone = ZONE()) {
  return guestConversations(rows).map((c) => ({
    guestId: c.guestId, name: names.get(c.guestId) ?? 'A guest',
    messages: c.rows.map((m) => ({
      at: m.created_at, when: momentText(m.created_at, timeZone), from: m.direction === 'staff' ? staffLabel : 'Guest',
      who: m.direction === 'staff' ? staffDisplayName(m.sender_name, staffLabel) : (names.get(c.guestId) ?? 'A guest'),
      topic: m.topic ?? '', body: m.body, readAt: m.read_at ?? null, read: m.read_at ? `read ${momentText(m.read_at, timeZone)}` : 'not read yet',
    })),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

// A spreadsheet (CSV, opens in Excel and Numbers): one line per message.
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
export function messageRecordCsv(record) {
  const lines = [['Guest', 'Sent (UTC)', 'Sent (local time)', 'From', 'Written by', 'Topic', 'Message', 'Read (UTC)', 'Read (local time)'].map(csvCell).join(',')];
  for (const c of record) for (const m of c.messages) {
    lines.push([c.name, m.at, m.when, m.from, m.who, m.topic, m.body, m.readAt ?? '', m.readAt ? m.read.replace(/^read /, '') : ''].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`; // the first character lets Excel read accents correctly
}
