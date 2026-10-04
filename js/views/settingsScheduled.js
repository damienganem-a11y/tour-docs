// Settings > Scheduled messages (owner only): messages sent at a time you choose, the automatic reminders, and your own alerts.
//
// A message waits on the server and a timer sends it at the exact moment, so it goes out even if this phone is shut (needs the one-time setup of
// supabase/PUSH_SETUP.md). The time is typed in the clock of a destination and stored as an exact moment. The automatic ones are made by the app from
// the trip (scheduledMessages.js) and renewed whenever the trip changes; here you choose which kinds are on.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { showToast, openSheet, closeSheet } from '../ui.js';
import { plural, joinNames } from '../rules.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { addDays, formatFullMoment, localDateNow } from '../time.js';
import { AUTO_KINDS, MESSAGE_TEMPLATES, audienceGuestIds, autoNotifySettings, clockProposals, draftError, draftRow } from '../scheduledMessages.js';

const field = (label, input, hint) => h('div', { class: 'form-field' }, h('label', { class: 'form-label' }, label, input), hint ? h('div', { class: 'form-hint' }, hint) : null);
const phoneZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function scheduledSettingsPage(ctx, trip) {
  const head = pageHead({
    back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
    eyebrow: 'Scheduled messages', title: 'Scheduled messages', subtitle: 'Messages sent at a time you choose, reminders and alerts for you.',
  });
  if (ctx.roleFor(trip.id) !== 'owner') return h('div', {}, head, notice('Only the owner of a trip manages scheduled messages.'));

  const destinations = [...trip.destinations].sort((a, b) => a.order - b.order);
  const soon = destinations.find((d) => { const today = localDateNow(d.timeZone); return trip.slots.some((s) => s.destinationId === d.id && s.date >= today); }) ?? destinations[0];

  // ---- the timer, and what is waiting ----
  const timerLine = h('p', { class: 'muted count-line' }, 'Checking the timer…');
  ctx.schedulerStatus?.().then((status) => {
    timerLine.textContent = status?.timer ? 'The timer is running: messages are sent at their time, even if this phone is shut.' : 'The timer is not running yet: messages will not be sent. See supabase/PUSH_SETUP.md (switch on "pg_cron" in the Supabase dashboard, then run the push setup again).';
  }).catch(() => { timerLine.textContent = 'The timer could not be checked (sign in and go online).'; });

  const waiting = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  async function loadWaiting() {
    let rows = [];
    try { rows = await ctx.listScheduled(trip.id); } catch { waiting.replaceChildren(h('p', { class: 'muted' }, 'The list could not be loaded. Sign in and go online.')); return; }
    if (rows.length === 0) { waiting.replaceChildren(h('p', { class: 'muted' }, 'Nothing is waiting to be sent.')); return; }
    waiting.replaceChildren(...rows.map((m) => {
      const kind = m.source === 'manual' ? 'Yours' : m.audience === 'owner' ? 'Alert for you' : 'Reminder';
      const who = m.audience === 'owner' ? 'you' : Array.isArray(m.guest_ids) ? plural(m.guest_ids.length, 'guest') : 'every guest';
      return h('div', { class: 'card team-member' },
        h('div', { class: 'act-name' }, m.title),
        h('div', { class: 'muted' }, `${formatFullMoment(m.send_at, phoneZone())} (your phone's clock) · ${who} · ${kind}${m.priority === 'important' ? ' · Important' : ''}`),
        h('div', { class: 'muted' }, m.body),
        m.source === 'manual' ? h('div', { class: 'card-actions' }, h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: async () => { try { await ctx.cancelScheduled(m.id); showToast('Message cancelled'); loadWaiting(); } catch { showToast('Could not cancel. Are you online?', true); } } }, 'Cancel it')) : null);
    }));
  }
  loadWaiting();
  ctx.refreshAutoMessages?.(trip.id)?.then?.(() => loadWaiting());

  // ---- a new message ----
  function newMessageSheet(prefill = {}) {
    const title = h('input', { class: 'text-input', type: 'text', maxlength: '80', value: prefill.title ?? '', placeholder: 'Title', 'aria-label': 'Title' });
    const body = h('textarea', { class: 'text-input', rows: '3', maxlength: '200', placeholder: 'Message (200 letters at most)', 'aria-label': 'Message' }, prefill.body ?? '');
    const templates = h('div', { class: 'chips' }, MESSAGE_TEMPLATES.map((t) => h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => { title.value = t.title; body.value = t.body; } }, t.label)));

    // Who: everyone, a travel party, a group (bus, boat...) or the guests of one tour.
    const guests = trip.guests.filter((g) => !g.leftAt);
    const partyLabel = (party) => { const members = guests.filter((g) => g.partyId === party.id); return joinNames(members.slice(0, 3).map((g) => g.first)) + (members.length > 3 ? ` and ${members.length - 3} more` : ''); };
    const options = [{ value: 'everyone', label: 'Every guest', audience: { type: 'everyone' } }];
    for (const split of trip.splits ?? []) for (const group of split.groups) options.push({ value: `g|${split.id}|${group.id}`, label: `Group: ${split.name}, ${group.name}`, audience: { type: 'group', splitId: split.id, groupId: group.id } });
    for (const activity of trip.activities.filter((a) => !a.cancelled)) {
      const slot = trip.slots.find((s) => s.id === activity.slotId);
      if (slot && slot.date >= addDays(localDateNow(soon.timeZone), -1)) options.push({ value: `t|${activity.id}`, label: `Tour: ${activity.name}, ${slot.date}`, audience: { type: 'tour', activityId: activity.id } });
    }
    for (const party of trip.parties.filter((p) => guests.some((g) => g.partyId === p.id)).slice(0, 80)) options.push({ value: `p|${party.id}`, label: `Travel party: ${partyLabel(party)}`, audience: { type: 'party', id: party.id } });
    const who = h('select', { class: 'text-input', 'aria-label': 'Who receives it' }, options.map((o) => h('option', { value: o.value }, o.label)));

    // When: a day and a time on the clock of a destination.
    const zone = h('select', { class: 'text-input', 'aria-label': 'Clock' }, destinations.map((d) => h('option', { value: d.timeZone, selected: d.timeZone === (prefill.timeZone ?? soon.timeZone) }, `${d.name} clock`)));
    const date = h('input', { class: 'text-input', type: 'date', value: prefill.date ?? addDays(localDateNow(soon.timeZone), 1), 'aria-label': 'Day' });
    const time = h('input', { class: 'text-input', type: 'time', value: prefill.time ?? '19:00', 'aria-label': 'Time' });
    const important = h('input', { type: 'checkbox', 'aria-label': 'Important' });
    const errorLine = h('p', { class: 'modal-error' }, '');
    const send = h('button', { class: 'btn', type: 'button', onclick: async () => {
      const chosen = options.find((o) => o.value === who.value);
      const draft = { title: title.value, body: body.value, date: date.value, time: time.value, timeZone: zone.value, important: important.checked, guestIds: audienceGuestIds(trip, chosen.audience) };
      const problem = draftError(draft);
      if (problem) { errorLine.textContent = problem; return; }
      send.disabled = true;
      try { await ctx.scheduleMessage(trip.id, draftRow(draft)); closeSheet(); showToast('Message scheduled'); loadWaiting(); }
      catch { send.disabled = false; errorLine.textContent = 'Could not schedule it. Are you online and signed in, and is the setup done (supabase/PUSH_SETUP.md)?'; }
    } }, 'Schedule the message');
    openSheet({
      eyebrow: 'New message', title: 'Schedule a message', subtitle: 'It goes to the phones of the guests who turned notifications on.',
      body: [templates, field('Title', title), field('Message', body), field('Who', who), field('Day', date), field('Time', time, 'On the clock chosen below.'), field('Clock', zone),
        h('label', { class: 'check-row' }, important, " Important: arrives with sound, even during the guest's quiet night hours"), errorLine, send],
    });
  }

  // ---- proposals: clocks ----
  const proposals = clockProposals(trip).filter((p) => p.date >= localDateNow(p.timeZone)).slice(0, 3); // the next three: the others appear as the trip goes on
  const proposalsBlock = proposals.length === 0 ? null : h('div', {}, h('h3', { class: 'section-title' }, 'Proposed'),
    ...proposals.map((p) => h('div', { class: 'card team-member' },
      h('div', { class: 'act-name' }, `Clocks: ${p.destination}`), h('div', { class: 'muted' }, p.body),
      h('div', { class: 'card-actions' }, h('button', { class: 'btn btn--small', type: 'button', onclick: () => newMessageSheet({ title: p.title, body: p.body, date: p.date, time: p.time, timeZone: p.timeZone }) }, 'Schedule it...')))));

  // ---- the automatic ones ----
  const autoOn = autoNotifySettings(trip);
  const autoCard = h('div', { class: 'card team-member' },
    h('div', { class: 'act-name' }, 'Automatic reminders and alerts'),
    h('div', { class: 'muted' }, 'Made by the app from your trip and renewed when it changes. Only guests who turned notifications on get the reminders; the alerts come to your own phone. A guest request waiting 2 hours always tells you.'),
    ...AUTO_KINDS.map((kind) => h('label', { class: 'check-row' },
      h('input', { type: 'checkbox', checked: autoOn[kind.key], 'aria-label': kind.label, onchange: async (event) => {
        const result = await applyChange(ctx, trip.id, { type: 'guest-links', action: 'auto-settings', settings: { [kind.key]: event.target.checked } });
        if (result.ok) { showToast(event.target.checked ? 'Turned on' : 'Turned off'); ctx.refreshAutoMessages?.(trip.id)?.then?.(() => loadWaiting()); } else showToast(result.error, true);
      } }), ` ${kind.label}`)));

  return h('div', {}, head, timerLine,
    h('button', { class: 'btn', type: 'button', onclick: () => newMessageSheet() }, 'New message'),
    proposalsBlock, h('h3', { class: 'section-title' }, 'Waiting to be sent'), waiting, autoCard);
}
