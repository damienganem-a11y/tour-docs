// The inbox button on the main screens (owner's request, 15 Oct 2026): a bell with the number of things waiting, opening the list (inbox.js).
// Tapping an item goes straight to the screen that deals with it.

import { h } from '../dom.js';
import { openSheet, closeSheet } from '../ui.js';
import { icon } from './icons.js';
import { inboxCount } from '../inbox.js';

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '');

export function inboxButton(ctx, trip) {
  const items = ctx.inboxFor(trip.id);
  const count = inboxCount(items);
  return h('button', { class: 'send-btn inbox-btn', type: 'button', 'aria-label': count > 0 ? `Inbox, ${count} waiting` : 'Inbox', title: 'Inbox', onclick: () => inboxSheet(ctx, trip) },
    icon('bell'), count > 0 ? h('span', { class: 'bell-badge' }, String(count > 9 ? '9+' : count)) : null);
}

function inboxSheet(ctx, trip) {
  const items = ctx.inboxFor(trip.id);
  const rows = items.map((item) => h('a', { class: `inbox-row${item.unread ? ' is-unread' : ''}`, href: item.href, onclick: () => { ctx.markInboxSeen(trip.id, [item.id]); closeSheet(); } },
    h('div', { class: 'inbox-title' }, item.title), h('div', { class: 'inbox-detail' }, item.detail), item.at ? h('div', { class: 'muted' }, when(item.at)) : null));
  openSheet({
    eyebrow: 'Inbox', title: items.length === 0 ? 'Nothing waiting' : `${inboxCount(items)} waiting`,
    body: [
      ...(rows.length === 0 ? [h('p', { class: 'muted' }, 'No request, no message, nothing to decide.')] : rows),
      h('a', { class: 'btn btn--plain', href: `#/trip/${trip.id}/settings/messages`, onclick: () => closeSheet() }, 'Open Messages'),
    ],
    cancelLabel: 'Close',
  });
}
