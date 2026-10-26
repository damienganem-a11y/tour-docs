// Settings > Guest messages (v0.130.0): every conversation between guests and the staff, as a record.
//   - Owner and colleagues (Jet Staff, Advance) read the conversations, answer, or write first to a guest. The Expert (viewer) does not see them.
//   - A message is kept for good with its exact time, who wrote it and when it was read. Nothing can be edited or deleted (the server refuses), which makes the
//     whole record usable for liability (owner's request, 26 Oct 2026).
//   - "Record" makes a printable PDF or a spreadsheet of every message, to keep on file.
// The messages are free text and are NOT in the Journal. The guests' allergies have their own field and are never asked for here.

import { h } from '../dom.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { displayNames, alphabetical, plural, teamLabel } from '../rules.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { guestConversations, GUEST_MESSAGE_MAX, staffDisplayName, momentText } from '../guestMessages.js';
import { exportMessageRecord } from '../export.js';

const TOPIC_WORD = { question: 'A question', problem: 'A problem here', other: 'Something else' };

export function guestMessagesSettingsPage(ctx, trip) {
  const label = teamLabel(trip);
  const names = displayNames(trip.guests);
  const fullName = (guestId) => { const g = trip.guests.find((x) => x.id === guestId); return g ? `${g.first} ${g.last ?? ''}`.trim() : (names.get(guestId) ?? 'A guest'); };
  const head = pageHead({ back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' }, eyebrow: 'Guest messages', title: 'Guest messages', subtitle: `Everything guests and the ${label} write to each other.` });
  if (ctx.roleFor(trip.id) === 'viewer') return h('div', {}, head, notice('The Expert role does not see the guests\' messages.'));
  const rows = ctx.guestMessagesFor(trip.id);
  const conversations = guestConversations(rows);
  const waiting = conversations.filter((c) => c.unanswered).length;

  // One writing box + Send, for an answer or a first message.
  function composer(guestId, onSent) {
    const text = h('textarea', { class: 'text-input', rows: '3', maxlength: String(GUEST_MESSAGE_MAX), placeholder: `Your message to ${fullName(guestId)}`, 'aria-label': 'Your message' });
    const error = h('p', { class: 'form-error', hidden: '' });
    const send = h('button', { class: 'btn', type: 'button' }, 'Send');
    send.addEventListener('click', async () => {
      send.disabled = true;
      const result = await ctx.answerGuestMessage(trip.id, guestId, text.value);
      if (result.ok) { onSent(); return; }
      error.hidden = false; error.textContent = result.error; send.disabled = false;
    });
    return [text, error, send];
  }

  function conversationSheet(guestId) {
    const rowsOf = ctx.guestMessagesFor(trip.id).filter((m) => m.guest_id === guestId);
    ctx.openGuestConversation(trip.id, guestId);
    openSheet({
      eyebrow: 'Conversation', title: fullName(guestId), subtitle: 'Kept as it was sent. A message cannot be edited or deleted.',
      body: [...rowsOf.map((m) => h('div', { class: `card ${m.direction === 'staff' ? 'card--soft' : ''}` },
        h('div', { class: 'act-name' }, m.direction === 'staff' ? `${staffDisplayName(m.sender_name, label)} (${label})` : fullName(guestId)),
        m.topic && m.direction === 'guest' ? h('div', { class: 'muted' }, TOPIC_WORD[m.topic] ?? m.topic) : null,
        h('div', {}, m.body),
        h('div', { class: 'muted' }, `${momentText(m.created_at)} · ${m.read_at ? `read ${momentText(m.read_at)}` : 'not read yet'}`))),
      ...composer(guestId, () => { closeSheet(); showToast('Sent'); })],
      cancelLabel: 'Close',
    });
  }

  function writeFirstSheet() {
    const guests = trip.guests.filter((g) => !g.leftAt).sort(alphabetical(names));
    const select = h('select', { class: 'text-input', 'aria-label': 'Guest' }, h('option', { value: '' }, 'Choose a guest…'), ...guests.map((g) => h('option', { value: g.id }, `${g.first} ${g.last ?? ''}`.trim())));
    const area = h('div', {});
    select.addEventListener('change', () => { area.replaceChildren(...(select.value ? composer(select.value, () => { closeSheet(); showToast('Sent'); }) : [])); });
    openSheet({ eyebrow: 'New message', title: 'Write to a guest', subtitle: 'The guest sees it in Messages in their app, and by notification if they turned those on.', body: [select, area], cancelLabel: 'Close' });
  }

  const record = (format) => async () => {
    try { await exportMessageRecord(trip, ctx.guestMessagesFor(trip.id), format); } catch { showToast('Could not make the file.', true); }
  };

  return h('div', {}, head,
    notice('Every message is kept exactly as it was sent, with its time, who wrote it and when it was read. Nothing can be edited or deleted. Please do not ask guests to write allergies or medical details here: they have their own field.'),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--small', type: 'button', onclick: writeFirstSheet }, 'Write to a guest'),
      h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => ctx.refreshGuestMessages() }, 'Check for new messages')),
    h('h2', { class: 'section-title' }, `Conversations (${conversations.length})${waiting ? `, ${waiting} waiting for an answer` : ''}`),
    conversations.length === 0 ? h('p', { class: 'empty' }, 'No message yet. Guests write from "Message the staff" in their app.') : null,
    ...conversations.map((c) => h('button', { class: 'card card--tap', type: 'button', onclick: () => conversationSheet(c.guestId) },
      h('div', { class: 'act-name' }, `${fullName(c.guestId)}${c.unanswered ? ' · waiting for an answer' : ''}`),
      h('div', { class: 'muted' }, `${c.last.direction === 'staff' ? `${staffDisplayName(c.last.sender_name, label)}: ` : ''}${c.last.body.slice(0, 100)}`),
      h('div', { class: 'muted' }, `${plural(c.rows.length, 'message')} · last ${momentText(c.last.created_at)}`))),
    conversations.length ? h('div', {}, h('h2', { class: 'section-title' }, 'The record'),
      h('p', { class: 'muted' }, 'All messages of this trip, both ways, to keep on file.'),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn--small', type: 'button', onclick: record('pdf') }, 'Record as PDF'),
        h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: record('csv') }, 'Record as spreadsheet'))) : null);
}
