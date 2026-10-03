// Settings > Requests: changes asked for by Team colleagues (SPEC.md, Team step B).
//   The owner sees what needs attention (a request that no longer fits, with the reason: try again, or decline), what is waiting, and
//   what was done lately. A Team colleague sees their own requests and what became of them. The owner's device applies requests by
//   itself whenever they fit; this screen is for the ones that do not.

import { h } from '../dom.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { displayNames, countIn } from '../rules.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { resolveGuestRequest, describeGuestRequest } from '../guestRequests.js';
import { describeRequest } from '../sync.js';

const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// ---------- Requests from guests (their app's "Ask to switch to this tour") ----------
function guestRequestCard(ctx, trip, row, names) {
  const p = row.payload ?? {};
  const resolved = resolveGuestRequest(trip, row);
  const lines = [h('div', { class: 'act-name' }, describeGuestRequest(trip, row, names)), h('div', { class: 'muted' }, when(row.created_at))];
  if (p.note) lines.push(h('div', { class: 'quote' }, `"${p.note}"`));
  if (resolved.ok && resolved.to.capacity !== null) lines.push(h('div', { class: 'muted' }, `"${p.to}": ${countIn(trip, resolved.to)} of ${resolved.to.capacity} places taken`));
  if (!resolved.ok) lines.push(h('div', { class: 'notice' }, resolved.error));
  const approve = h('button', { class: 'btn btn--small', type: 'button', disabled: !resolved.ok, onclick: async () => {
    const result = await ctx.approveGuestRequest(row.id);
    if (result.ok) showToast('Approved: the guest has been moved');
    else if (result.full) fullSheet(ctx, row, result.error);
    else showToast(result.error, true);
  } }, 'Approve');
  const decline = h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => declineSheet(ctx, row, names, trip) }, 'Decline');
  return h('div', { class: 'card' }, ...lines, h('div', { class: 'card-actions' }, approve, decline));
}

// The wanted tour is full: three honest choices.
function fullSheet(ctx, row, why) {
  const choose = async (mode) => { closeSheet(); const r = await ctx.approveGuestRequest(row.id, mode); showToast(r.ok ? (mode === 'waitlist' ? 'The guest is on the waiting list' : 'The guest has been moved') : r.error, !r.ok); };
  openSheet({
    eyebrow: 'Guest request', title: 'That tour is full', subtitle: why,
    body: [
      h('button', { class: 'btn', type: 'button', onclick: () => choose('waitlist') }, 'Put the guest on the waiting list'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => choose('force') }, 'Move the guest anyway (over capacity)'),
    ], cancelLabel: 'Cancel',
  });
}

function declineSheet(ctx, row, names, trip) {
  const reason = h('input', { class: 'text-input', type: 'text', maxlength: '200', placeholder: 'A short reason for the guest (optional)', 'aria-label': 'Reason' });
  openSheet({
    eyebrow: 'Guest request', title: 'Decline this request?', subtitle: describeGuestRequest(trip, row, names),
    body: [reason, h('button', { class: 'btn', type: 'button', onclick: async () => { closeSheet(); await ctx.declineGuestRequest(row.id, reason.value); showToast('Declined: the guest is told'); } }, 'Decline')],
    cancelLabel: 'Cancel',
  });
}

// Notifications on this phone: a button that says what it will do, and what is missing when it cannot.
function notificationsCard(ctx) {
  const line = h('div', { class: 'muted' }, 'Checking…');
  const actions = h('div', { class: 'card-actions' });
  const card = h('div', { class: 'card' }, h('div', { class: 'act-name' }, 'Notifications on this phone'), line, actions);
  const button = (label, onclick, plain = true) => h('button', { class: `btn btn--small${plain ? ' btn--plain' : ''}`, type: 'button', onclick }, label);
  async function show() {
    const { state } = await ctx.pushState();
    actions.replaceChildren();
    if (state === 'unsupported') line.textContent = 'This browser cannot show notifications.';
    else if (state === 'install') line.textContent = 'On an iPhone, first add Tour Docs to the Home Screen (Share button, then Add to Home Screen), and open it from there.';
    else if (state === 'denied') line.textContent = 'Notifications are blocked for this app. Allow them in the phone\'s Settings, then come back.';
    else if (state === 'on') {
      line.textContent = 'On: you are told when a guest sends a request.';
      actions.append(button('Send a test', async () => { try { const r = await ctx.testPush(); showToast(r?.sent > 0 ? 'Test sent' : 'Nothing was sent: is the setup done? (supabase/PUSH_SETUP.md)', !(r?.sent > 0)); } catch (e) { showToast('Could not send the test.', true); } }),
        button('Turn off', async () => { await ctx.disablePush(); show(); }));
    } else {
      line.textContent = 'Off. Turn them on to be told at once when a guest sends a request.';
      actions.append(button('Turn on', async () => { try { const r = await ctx.enablePush(); if (!r.ok) showToast(r.error, true); else showToast('Notifications are on'); } catch (e) { showToast(String(e?.message ?? e).slice(0, 120), true); } show(); }, false));
    }
  }
  show();
  return card;
}

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

  // Requests from guests: only the owner decides.
  const guestRows = owner ? ctx.guestRequestsFor(trip.id) : [];
  const guestPending = guestRows.filter((r) => r.status === 'pending').reverse();
  const guestDone = guestRows.filter((r) => r.status !== 'pending').slice(0, 10);
  const statusWord = { approved: 'Approved', declined: 'Declined', cancelled: 'Taken back by the guest', failed: 'Did not work' };
  const guestSection = owner ? h('div', {},
    h('h2', { class: 'section-title' }, `Guests' requests${guestPending.length ? ` (${guestPending.length})` : ''}`),
    guestPending.length === 0 ? h('p', { class: 'empty' }, 'No guest request waiting.') : null,
    ...guestPending.map((r) => guestRequestCard(ctx, trip, r, names)),
    guestDone.length ? h('div', {}, h('h2', { class: 'section-title' }, 'Answered lately'), ...guestDone.map((r) => h('div', { class: 'card card--soft' }, h('div', { class: 'act-name' }, describeGuestRequest(trip, r, names)), h('div', { class: 'muted' }, `${statusWord[r.status] ?? r.status}${r.note ? `: ${r.note}` : ''} · ${when(r.decided_at ?? r.created_at)}`)))) : null,
    h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => ctx.refreshGuestRequests() }, 'Check for new requests')) : null;

  const nothing = rows.length === 0 && waiting.length === 0;
  return h('div', {},
    head,
    owner
      ? notice('Your devices apply a colleague\'s request by themselves when it fits. Only the ones that no longer fit wait here for you.')
      : notice('A change you make is sent to the owner\'s device and applied there, usually within seconds. It then shows up in your copy of the trip.'),
    owner ? notificationsCard(ctx) : null,
    guestSection,
    nothing && !owner ? h('p', { class: 'empty' }, 'No requests yet.') : null,
    section('Waiting to be sent', waiting.map((r) => h('div', { class: 'card' }, h('div', { class: 'act-name' }, describeRequest(trip, r.changes, names) || 'A change'), h('div', { class: 'muted' }, `${when(r.requestedAt)} · it will be sent as soon as you are online`)))),
    section(owner ? 'Needs your attention' : 'Did not fit', failed.map((r) => card(r, owner ? decide(r) : null))),
    section('Waiting for the owner\'s device', pending.map((r) => card(r, null))),
    section('Done', done.map((r) => card(r, null))));
}
