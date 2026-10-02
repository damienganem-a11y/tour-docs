// Settings > Requests: changes asked for by Team colleagues (SPEC.md, Team step B).
//   The owner sees what needs attention (a request that no longer fits, with the reason: try again, or decline), what is waiting, and
//   what was done lately. A Team colleague sees their own requests and what became of them. The owner's device applies requests by
//   itself whenever they fit; this screen is for the ones that do not.

import { h } from '../dom.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { displayNames } from '../rules.js';
import { describeRequest } from '../sync.js';

const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export function requestsSettingsPage(ctx, trip) {
  const owner = ctx.roleFor(trip.id) === 'owner';
  const names = displayNames(trip.guests);
  const rows = ctx.requestsFor(trip.id);
  const waiting = ctx.outboxFor(trip.id); // made here, not sent yet (no internet)
  const head = pageHead({
    back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
    eyebrow: 'Team', title: 'Requests',
    subtitle: owner ? 'Changes asked for by your team.' : 'Changes you asked the owner for.',
  });

  const card = (row, actions) => h('div', { class: 'card' },
    h('div', { class: 'act-name' }, describeRequest(trip, row.changes, names) || 'A change'),
    h('div', { class: 'muted' }, `${owner ? `${row.requester_name || row.requester_email || 'A colleague'} · ` : ''}${when(row.requested_at)}`),
    row.status === 'failed' && row.note ? h('div', { class: 'notice' }, `It no longer fits: ${row.note}`) : null,
    row.status === 'declined' ? h('div', { class: 'muted' }, 'Declined') : null,
    actions ? h('div', { class: 'card-actions' }, actions) : null);

  const section = (title, items) => (items.length === 0 ? null : h('div', {}, h('h2', { class: 'section-title' }, title), ...items));
  const failed = rows.filter((r) => r.status === 'failed');
  const pending = rows.filter((r) => r.status === 'pending' || r.status === 'applying');
  const done = rows.filter((r) => r.status === 'applied' || r.status === 'declined').slice(-20).reverse();

  const decide = (row) => [
    h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => ctx.retryRequest(row.id) }, 'Try again'),
    h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => ctx.declineRequest(row.id) }, 'Decline'),
  ];

  const nothing = rows.length === 0 && waiting.length === 0;
  return h('div', {},
    head,
    owner
      ? notice('Your devices apply a colleague\'s request by themselves when it fits. Only the ones that no longer fit wait here for you.')
      : notice('A change you make is sent to the owner\'s device and applied there, usually within seconds. It then shows up in your copy of the trip.'),
    nothing ? h('p', { class: 'empty' }, 'No requests yet.') : null,
    section('Waiting to be sent', waiting.map((r) => h('div', { class: 'card' }, h('div', { class: 'act-name' }, describeRequest(trip, r.changes, names) || 'A change'), h('div', { class: 'muted' }, `${when(r.requestedAt)} · it will be sent as soon as you are online`)))),
    section(owner ? 'Needs your attention' : 'Did not fit', failed.map((r) => card(r, owner ? decide(r) : null))),
    section('Waiting for the owner\'s device', pending.map((r) => card(r, null))),
    section('Done', done.map((r) => card(r, null))));
}
