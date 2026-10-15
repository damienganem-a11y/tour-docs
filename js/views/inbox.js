// The inbox button on the main screens (owner's request, 15 Oct 2026): a bell with the number of things waiting, opening the list (inbox.js).
// Tapping an item goes straight to the screen that deals with it.

import { h } from '../dom.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
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
  const rows = items.map((item) => h('a', { class: `inbox-row${item.unread ? ' is-unread' : ''}`, href: item.href, onclick: (event) => { ctx.markInboxSeen(trip.id, [item.id]); closeSheet(); if (item.kind === 'conflict') { event.preventDefault(); conflictSheet(ctx, trip); } } },
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

// The owner chose to keep changes made offline, or the other version. Said plainly, with what is lost either way.
function conflictSheet(ctx, trip) {
  const mine = ctx.unsentCount(trip.id);
  const choose = async (choice) => {
    closeSheet();
    try { await ctx.resolveConflict(trip.id, choice); showToast(choice === 'theirs' ? 'The other version is now on this device' : 'Your version was sent'); }
    catch (error) { showToast(error?.message ?? 'Could not do it. Are you online?', true); }
  };
  openSheet({
    eyebrow: 'Two versions', title: 'Which version do you keep?',
    subtitle: `This device holds ${mine} change${mine === 1 ? '' : 's'} made while it was offline. Somebody changed the trip elsewhere in the meantime. The two cannot be merged yet.`,
    body: [
      h('button', { class: 'btn', type: 'button', onclick: () => choose('theirs') }, 'Keep the other version (the changes made here are dropped)'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => choose('mine') }, 'Keep this device\'s version (the other changes are overwritten)'),
    ],
    cancelLabel: 'Decide later',
  });
}
