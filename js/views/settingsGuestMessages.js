// Messages (v0.133.0): the inbox of every conversation between guests and the staff, like WhatsApp (owner's request, 27 Oct 2026).
//   - The list: one line per guest, the latest conversation first, the time of the last message, a red mark for what nobody has opened (or what was marked
//     "unread" by hand), a "Reply needed" tag while the guest's word is the last. Press and hold a line to mark it unread.
//   - A conversation opens as a chat window (chatUi.js): everything that was said, by day, with the staff member's name on each answer and two ticks once read.
//   - The owner and invited colleagues (Jet Staff, Advance) read, answer, or write first to a guest; the Expert does not see this page.
//   - A message is a record: nobody can edit or delete it (the database refuses). "The record" makes a printable PDF or a spreadsheet of everything.
//   - A guest's message that waits too long reminds the staff by notification (the owner chooses after how long); the number of conversations that need
//     the staff is the red number on the envelope and on the app's icon.
// The messages are free text and are NOT in the Journal. Allergies have their own field and are never asked for here.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { displayNames, alphabetical, plural, teamLabel } from '../rules.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { staffDisplayName } from '../guestMessages.js';
import { inboxList, attentionCount, REMIND_CHOICES, REMIND_DEFAULT } from '../chat.js';
import { openChat, avatar } from '../chatUi.js';
import { exportMessageRecord } from '../export.js';

const HOLD_MS = 550;

let searchText = ''; // kept while the list is redrawn

export function guestMessagesSettingsPage(ctx, trip) {
  const label = teamLabel(trip);
  const names = displayNames(trip.guests);
  const fullName = (guestId) => { const g = trip.guests.find((x) => x.id === guestId); return g ? `${g.first} ${g.last ?? ''}`.trim() : (names.get(guestId) ?? 'A guest'); };
  const nameMap = new Map(trip.guests.map((g) => [g.id, `${g.first} ${g.last ?? ''}`.trim()]));
  const head = pageHead({ back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' }, eyebrow: 'Messages', title: 'Messages', subtitle: `Every conversation between guests and the ${label}.` });
  if (ctx.roleFor(trip.id) === 'viewer') return h('div', {}, head, notice('The Expert role does not see the guests\' messages.'));

  const rows = ctx.guestMessagesFor(trip.id);
  const list = inboxList(rows, ctx.guestThreadsFor(trip.id), nameMap);
  const needing = attentionCount(list);

  // ---- the chat window of one conversation ----
  function openConversation(guestId) {
    ctx.openGuestConversation(trip.id, guestId);
    const mineOf = (m) => m.direction === 'staff';
    const forGuest = () => ctx.guestMessagesFor(trip.id).filter((m) => m.guest_id === guestId);
    const stop = ctx.onGuestMessages(() => { chat.redraw(); ctx.openGuestConversation(trip.id, guestId); }); // a message arriving while the window is open is read at once
    const chat = openChat({
      title: fullName(guestId), name: fullName(guestId), subtitle: 'Kept as a record: messages cannot be edited or deleted',
      getMessages: forGuest, isMine: mineOf,
      labelOf: (m) => (m.direction === 'staff' ? staffDisplayName(m.sender_name, label) : ''),
      note: 'Please do not ask guests for allergies or medical details here: they have their own field.',
      placeholder: `Message to ${fullName(guestId).split(' ')[0]}`, emptyText: 'No message yet. Write the first one below.',
      onSend: (text) => ctx.answerGuestMessage(trip.id, guestId, text),
      menu: [{ label: 'Mark as unread', onClick: async () => { chat.close(); await ctx.flagGuestThread(trip.id, guestId, true); showToast('Marked as unread'); } }],
      onClose: () => { stop(); ctx.refresh(); },
    });
  }

  // ---- write first to a guest ----
  function writeFirstSheet() {
    const guests = trip.guests.filter((g) => !g.leftAt).sort(alphabetical(names));
    const select = h('select', { class: 'text-input', 'aria-label': 'Guest' }, h('option', { value: '' }, 'Choose a guest…'), ...guests.map((g) => h('option', { value: g.id }, `${g.first} ${g.last ?? ''}`.trim())));
    openSheet({ eyebrow: 'New message', title: 'Write to a guest', subtitle: 'The guest sees it in Messages in their app, and by notification if they turned those on.',
      body: [select, h('button', { class: 'btn', type: 'button', onclick: () => { if (!select.value) return; closeSheet(); openConversation(select.value); } }, 'Open the conversation')], cancelLabel: 'Close' });
  }

  // ---- press and hold ----
  function holdSheet(c) {
    openSheet({ eyebrow: 'Conversation', title: c.name, body: [
      h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); openConversation(c.guestId); } }, 'Open'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: async () => {
        closeSheet();
        if (c.dot) { await ctx.openGuestConversation(trip.id, c.guestId); ctx.refresh(); showToast('Marked as read'); }   // opening it is what reads it
        else { await ctx.flagGuestThread(trip.id, c.guestId, true); showToast('Marked as unread'); }
      } }, c.dot ? 'Mark as read' : 'Mark as unread')], cancelLabel: 'Close' });
  }
  function row(c) {
    let timer = null; let held = false;
    const item = h('button', { class: `inbox-item${c.dot ? ' is-unread' : ''}`, type: 'button', 'aria-label': `${c.name}${c.dot ? ', unread' : ''}` },
      avatar(c.name, 48),
      h('div', { class: 'inbox-main' },
        h('div', { class: 'inbox-line' }, h('span', { class: 'inbox-name' }, c.name), h('span', { class: 'inbox-time' }, c.time)),
        h('div', { class: 'inbox-preview' }, h('span', {}, `${c.mine ? 'You: ' : ''}${c.preview}`),
          c.waiting && !c.dot ? h('span', { class: 'inbox-wait' }, 'Reply needed') : null,
          c.unread > 0 ? h('span', { class: 'inbox-dot', 'aria-hidden': 'true' }, String(c.unread)) : c.flagged ? h('span', { class: 'inbox-dot inbox-dot--plain', 'aria-hidden': 'true' }) : null)));
    const start = () => { held = false; timer = setTimeout(() => { held = true; holdSheet(c); }, HOLD_MS); };
    const cancel = () => clearTimeout(timer);
    item.addEventListener('touchstart', start, { passive: true }); item.addEventListener('touchend', cancel); item.addEventListener('touchmove', cancel, { passive: true }); item.addEventListener('touchcancel', cancel);
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); holdSheet(c); });
    item.addEventListener('click', () => { if (held) { held = false; return; } openConversation(c.guestId); });
    return item;
  }

  // ---- the list, with a search box ----
  const listBox = h('div', { class: 'inbox-list' });
  const drawList = () => {
    const q = searchText.trim().toLowerCase();
    const shown = list.filter((c) => !q || c.name.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q));
    listBox.replaceChildren(...(shown.length ? shown.map(row) : [h('p', { class: 'empty' }, list.length ? 'No conversation matches.' : 'No message yet. Guests write from "Message the staff" in their app, and you can write first with "New message".')]));
  };
  const search = h('input', { class: 'text-input', type: 'search', placeholder: 'Search a guest or a word', 'aria-label': 'Search', value: searchText });
  search.addEventListener('input', () => { searchText = search.value; drawList(); });
  drawList();

  // ---- the reminder (owner) ----
  const remind = Number.isInteger(trip.messageRemindMinutes) ? trip.messageRemindMinutes : REMIND_DEFAULT;
  const remindCard = ctx.roleFor(trip.id) === 'owner' ? h('div', { class: 'card card--soft' },
    h('div', { class: 'act-name' }, 'Reminder for a message nobody answered'),
    h('div', { class: 'muted' }, `If a guest's message is still waiting after this time, a notification reminds the staff (up to three times).`),
    h('select', { class: 'text-input', 'aria-label': 'Reminder time', onchange: async (e) => { const r = await applyChange(ctx, trip.id, { type: 'guest-links', action: 'message-settings', remindMinutes: Number(e.target.value) }); if (r.ok) { ctx.refresh(); showToast('Saved'); } else showToast(r.error, true); } },
      REMIND_CHOICES.map(([minutes, text]) => h('option', { value: String(minutes), selected: minutes === remind ? '' : null }, text)))) : null;

  const record = (format) => async () => { try { await exportMessageRecord(trip, ctx.guestMessagesFor(trip.id), format); } catch { showToast('Could not make the file.', true); } };

  return h('div', {}, head,
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--small', type: 'button', onclick: writeFirstSheet }, 'New message'),
      h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => ctx.refreshGuestMessages() }, 'Check for new messages')),
    needing ? h('p', { class: 'muted' }, `${plural(needing, 'conversation')} to look at.`) : null,
    list.length > 5 ? search : null,
    listBox,
    remindCard,
    list.length ? h('div', {}, h('h2', { class: 'section-title' }, 'The record'),
      h('p', { class: 'muted' }, 'Every message is kept exactly as it was sent, with its time, who wrote it and when it was read. Nothing can be edited or deleted. Make a copy to keep on file:'),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn--small', type: 'button', onclick: record('pdf') }, 'Record as PDF'),
        h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: record('csv') }, 'Record as spreadsheet'))) : null);
}
