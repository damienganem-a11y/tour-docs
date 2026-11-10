// Messages (owner's request, 15 Oct 2026): ONE place for every message. Since v0.151.0 it is a tab of its own at the bottom (see messagesPage).

import { h } from '../dom.js';
import { showToast } from '../ui.js';
import { pageHead } from './chrome.js';
import { announceCard } from './settingsGuestApp.js';
import { scheduledSettingsPage } from './settingsScheduled.js';
import { guestMessagesSettingsPage } from './settingsGuestMessages.js';
import { inboxRows } from './inbox.js';
import { inboxList, attentionCount } from '../chat.js';

let tab = null; // the tab stays as the person left it while they work (null: not chosen yet)

const clock = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

// The Messages tab (v0.151.0, owner's decision of 10 Nov 2026: "Messages for everyone"): ONE page for everything that is written or waiting.
//   - "Waiting for you": what the bell used to hold (a request, a free seat, an answer to your request), only when there is something;
//   - "Guests": the conversations with each guest (not for an Expert);   - "Team": the chat between colleagues;
//   - "To all guests" (owner): a message to everybody now, and the ones scheduled for later.
// `which` comes from the address (#/trip/<id>/use/messages/team): a notification or a link can open the right part directly.
export function messagesPage(ctx, trip, which) {
  const role = ctx.roleFor(trip.id);
  const parts = [
    role === 'viewer' ? null : ['guests', 'Guests', attentionCount(inboxList(ctx.guestMessagesFor(trip.id), ctx.guestThreadsFor(trip.id), new Map()))],
    ['team', 'Team', ctx.inboxFor(trip.id).filter((item) => item.kind === 'message' && item.unread).length],
    role === 'owner' ? ['all', 'To all guests', 0] : null,
  ].filter(Boolean);
  if (parts.some(([key]) => key === which)) tab = which;
  if (!parts.some(([key]) => key === tab)) tab = parts[0][0];

  // What waits for this person, other than messages (those are counted on their own part below).
  const waiting = ctx.inboxFor(trip.id).filter((item) => item.kind !== 'message' && item.kind !== 'guest-message');
  const waitingBlock = waiting.length ? [
    h('h3', { class: 'section-title' }, `Waiting for you (${waiting.length})`),
    h('div', { class: 'menu menu--inbox' }, inboxRows(ctx, trip, waiting)),
  ] : [];

  const tabs = parts.length > 1 ? h('div', { class: 'switch', role: 'group', 'aria-label': 'Which messages' },
    parts.map(([key, label, count]) => h('button', { class: `switch-item${tab === key ? ' is-active' : ''}`, type: 'button', 'aria-pressed': String(tab === key), onclick: () => { tab = key; ctx.refresh(); } },
      label, count > 0 ? h('span', { class: 'switch-badge', 'aria-label': `${count} waiting` }, String(count > 9 ? '9+' : count)) : null))) : null;

  const content = tab === 'guests' ? guestMessagesSettingsPage(ctx, trip, { embedded: true })
    : tab === 'all' ? guestsTab(ctx, trip)
    : teamTab(ctx, trip);
  return h('div', {}, pageHead({ title: 'Messages' }), ...waitingBlock, tabs, content);
}

function guestsTab(ctx, trip) {
  return h('div', {}, announceCard(ctx, trip), h('h3', { class: 'section-title' }, 'Scheduled'), scheduledSettingsPage(ctx, trip, { embedded: true }));
}

function teamTab(ctx, trip) {
  const messages = ctx.teamMessagesFor(trip.id);
  const me = ctx.owner?.id;
  // Opening the conversation marks everything in it as seen (the inbox count goes down).
  ctx.markInboxSeen(trip.id, messages.map((m) => `m:${m.id}`));
  const list = h('div', { class: 'thread' }, messages.length === 0
    ? h('p', { class: 'empty' }, 'No message yet. Write to the team below: everybody working on this trip reads it.')
    : messages.map((m) => h('div', { class: `bubble${m.sender_id === me ? ' bubble--mine' : ''}` },
      h('div', { class: 'bubble-who' }, `${m.sender_id === me ? 'You' : m.sender_name} · ${clock(m.created_at)}`),
      h('div', { class: 'bubble-text' }, m.body))));
  const input = h('textarea', { class: 'text-input', rows: '2', maxlength: '600', placeholder: 'A message to the team', 'aria-label': 'A message to the team' });
  const send = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const text = input.value.trim();
    if (!text) return;
    send.disabled = true;
    try { await ctx.sendTeamMessage(trip.id, text); input.value = ''; } catch { showToast('Could not send. Are you online and signed in?', true); }
    send.disabled = false;
  } }, 'Send to the team');
  queueMicrotask(() => list.lastElementChild?.scrollIntoView?.({ block: 'end' }));
  return h('div', {}, list, input, send);
}
