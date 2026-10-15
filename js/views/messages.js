// Messages (owner's request, 15 Oct 2026): ONE place for every message. "Team": the conversation of the people working on the trip (owner, Jet Staff,
// Advance, Experts). "Guests" (owner only): a message sent to the guests now, and the ones scheduled for later.

import { h } from '../dom.js';
import { showToast } from '../ui.js';
import { pageHead } from './chrome.js';
import { announceCard } from './settingsGuestApp.js';
import { scheduledSettingsPage } from './settingsScheduled.js';

let tab = 'team'; // the tab stays as the person left it while they work

const clock = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export function messagesSettingsPage(ctx, trip) {
  const owner = ctx.roleFor(trip.id) === 'owner';
  if (!owner) tab = 'team';
  const head = pageHead({
    back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
    eyebrow: 'Messages', title: 'Messages', subtitle: owner ? 'The team, and the guests.' : 'The team working on this trip.',
  });
  const tabs = owner ? h('div', { class: 'strip' },
    h('button', { class: `strip-item${tab === 'team' ? ' is-active' : ''}`, type: 'button', onclick: () => { tab = 'team'; ctx.refresh(); } }, 'Team'),
    h('button', { class: `strip-item${tab === 'guests' ? ' is-active' : ''}`, type: 'button', onclick: () => { tab = 'guests'; ctx.refresh(); } }, 'Guests')) : null;
  return h('div', {}, head, tabs, tab === 'guests' && owner ? guestsTab(ctx, trip) : teamTab(ctx, trip));
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
