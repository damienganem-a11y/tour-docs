// The screens for changing a booking. They only ASK questions; the change itself is made by
// applyChange() in changes.js, which is the one place that changes bookings.
//
//   startMove(...)        pick another activity (or At leisure) for a guest in a half-day
//   startAddGuest(...)    pick any guest to bring into an activity
//   startCancelTour(...)  cancel an activity
//
// Moving goes: pick a place -> (travel party prompt) -> confirmation screen -> saved.

import { h } from '../dom.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { applyChange } from '../changes.js';
import { formatTime } from '../time.js';
import { byName, plain, displayNames, guestPlace, countIn, capacityInfo, partyMovers, slotLabel } from '../rules.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ["Simon B."] -> "Simon B."   ["Simon B.", "Anne B."] -> "Simon B. and Anne B."
const joinNames = (list) => (list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

const placeText = (place) =>
  place.kind === 'activity' ? place.activity.name :
  place.kind === 'leisure' ? 'At leisure' :
  place.kind === 'unknown' ? `unknown activity "${place.raw}"` : 'nothing chosen yet';

// ---------- Small building blocks ----------

const notice = (text) => h('div', { class: 'notice' }, text);

// One tappable row in a list inside a sheet.
function choiceRow({ title, detail, side, badge, current = false, disabled = false, onclick }) {
  return h('button', {
    class: `choice${current ? ' is-current' : ''}`, type: 'button', disabled, 'aria-current': current ? 'true' : null, onclick,
  },
    h('div', { class: 'choice-main' },
      h('div', { class: 'choice-title' }, title),
      detail ? h('div', { class: 'slot-detail' }, detail) : null),
    h('div', { class: 'choice-side' },
      badge ? h('div', { class: `badge ${badge.bad ? 'badge--bad' : 'badge--current'}` }, badge.text) : null,
      side ? h('div', { class: 'muted' }, side) : null));
}

// Start time in the destination's local time, then the meeting point.
function activityDetail(trip, slot, activity) {
  const destination = trip.destinations.find((d) => d.id === slot.destinationId);
  return [activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : '', activity.meeting].filter(Boolean).join(' · ');
}

// ---------- 1. Pick a place for a guest ----------

// guest, slot: who and which half-day. Called from a tap on a guest anywhere in the app.
export function startMove(ctx, trip, guest, slot) {
  const names = displayNames(trip.guests);
  const here = guestPlace(trip, guest, slot);

  const leisureRow = choiceRow({
    title: 'At leisure', detail: 'Not on any of our tours',
    badge: here.kind === 'leisure' ? { text: '✓ Current' } : null, current: here.kind === 'leisure',
    onclick: () => afterPick(ctx, trip, guest, slot, { kind: 'leisure' }),
  });

  const activityRows = trip.activities.filter((a) => a.slotId === slot.id).map((activity) => {
    const count = capacityInfo(countIn(trip, activity), activity.capacity);
    const isCurrent = here.kind === 'activity' && here.activity.id === activity.id;
    const full = activity.capacity !== null && countIn(trip, activity) >= activity.capacity;
    // A full activity cannot be joined (but you can still leave it). A cancelled one cannot be joined at all.
    return choiceRow({
      title: activity.name, detail: activityDetail(trip, slot, activity), side: activity.cancelled ? null : count.text,
      current: isCurrent,
      badge: activity.cancelled ? { text: 'Cancelled', bad: true } : isCurrent ? { text: '✓ Current' } : full ? { text: 'Full', bad: true } : null,
      disabled: activity.cancelled || (full && !isCurrent),
      onclick: () => (isCurrent ? closeSheet() : afterPick(ctx, trip, guest, slot, { kind: 'activity', activity })),
    });
  });

  openSheet({
    eyebrow: 'Move',
    title: names.get(guest.id),
    subtitle: `${slotLabel(trip, slot)} · now: ${placeText(here)}`,
    body: [leisureRow, ...activityRows],
  });
}

// ---------- 2. Add a guest to an activity ----------

// Search all guests, see where each one is now, tap one to bring them into this activity.
export function startAddGuest(ctx, trip, slot, activity) {
  const names = displayNames(trip.guests);
  const guests = [...trip.guests].sort(byName);
  const list = h('div', {});
  const now = countIn(trip, activity);
  const full = activity.capacity !== null && now >= activity.capacity;

  function fill() {
    const words = plain(search.value).split(/\s+/).filter(Boolean);
    const shown = guests.filter((g) => words.every((w) => plain(`${g.first} ${g.last}`).includes(w)));
    list.replaceChildren(...(shown.length === 0
      ? [h('p', { class: 'empty' }, 'No guest matches that search.')]
      : shown.map((guest) => {
          const here = guestPlace(trip, guest, slot);
          const already = here.kind === 'activity' && here.activity.id === activity.id;
          return choiceRow({
            title: names.get(guest.id), detail: `Now: ${placeText(here)}`,
            badge: already ? { text: '✓ Already here' } : null, disabled: already || full,
            onclick: () => afterPick(ctx, trip, guest, slot, { kind: 'activity', activity }),
          });
        })));
  }

  const search = h('input', {
    class: 'text-input', type: 'search', placeholder: 'Search guests',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search guests', oninput: fill,
  });
  fill();

  openSheet({
    eyebrow: 'Add guest',
    title: activity.name,
    subtitle: `${slotLabel(trip, slot)} · ${capacityInfo(now, activity.capacity).text}`,
    body: [full ? notice('This tour is full: nobody can be added. Move a guest out of it first.') : null, search, list],
  });
}

// ---------- 3. Travel party prompt ----------

// After a place is picked: if the guest travels with people who are in the same place, ask
// whether to move them too. Splitting a party must stay possible.
function afterPick(ctx, trip, guest, slot, target) {
  const movers = partyMovers(trip, guest, slot);
  if (movers.length === 0) return confirmMove(ctx, trip, guest, slot, target, []);

  // How many free places does the target have? (Unlimited for At leisure and for activities with no capacity.)
  const room = target.kind === 'activity' && target.activity.capacity !== null
    ? target.activity.capacity - countIn(trip, target.activity) : Infinity;

  // There is room for the guest but not for everybody: no question to ask. Only the tapped guest
  // can move, and the confirmation screen says so ("Only 1 seat left: ... stays in ...").
  if (room < 1 + movers.length) return confirmMove(ctx, trip, guest, slot, target, []);

  // This question IS the confirmation: Yes and No both save the move straight away, so there is
  // no second screen. It shows what will happen, and Cancel (in red) backs out.
  const withParty = moveFacts(trip, guest, slot, target, movers);
  const alone = moveFacts(trip, guest, slot, target, []);
  const moverNames = joinNames(movers.map((m) => alone.names.get(m.id)));

  openSheet({
    eyebrow: 'Travel party', title: 'Also move their travel party?',
    subtitle: `Move ${alone.who}${alone.from} to ${alone.to} · ${alone.detail}`,
    body: [
      Number.isFinite(room) && room <= 3 ? notice(`Only ${plural(room, 'seat')} left in "${target.activity.name}".`) : null,
      h('button', { class: 'btn', type: 'button', onclick: () => saveChanges(ctx, trip, withParty.changes, withParty.done) }, `Yes, move ${moverNames} too`),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => saveChanges(ctx, trip, alone.changes, alone.done) }, `No, only ${alone.who}`),
    ],
    cancelDanger: true,
  });
}

// What a move says about itself: the words for the screens, and the list of changes to apply.
// group: the guests moving together (the tapped guest, and party members if you said Yes).
function moveFacts(trip, guest, slot, target, movers) {
  const names = displayNames(trip.guests);
  const group = [guest, ...movers];
  const who = joinNames(group.map((g) => names.get(g.id)));
  const here = guestPlace(trip, guest, slot);
  const to = target.kind === 'leisure' ? 'At leisure' : target.activity.name;
  const from = here.kind === 'blank' ? '' : ` from ${here.kind === 'unknown' ? `"${here.raw}"` : placeText(here)}`;
  const detail = target.kind === 'activity'
    ? `${slotLabel(trip, slot)} · ${activityDetail(trip, slot, target.activity)}`
    : slotLabel(trip, slot);
  const changes = group.map((g) => ({
    type: 'move', guestId: g.id, slotId: slot.id,
    to: target.kind === 'leisure' ? { kind: 'leisure' } : { kind: 'activity', activityId: target.activity.id },
  }));
  return { names, group, who, here, to, from, detail, changes, done: `Moved ${who} to ${to}` };
}

// ---------- 4. Confirmation screen ----------

function confirmMove(ctx, trip, guest, slot, target, movers) {
  const { names, group, who, here, to, from, detail, changes, done } = moveFacts(trip, guest, slot, target, movers);

  // Warnings (shown in the warning colour): a nearly full tour, a split travel party.
  const warnings = [];
  const limited = target.kind === 'activity' && target.activity.capacity !== null;
  const roomBefore = limited ? target.activity.capacity - countIn(trip, target.activity) : Infinity;
  const partyHere = partyMovers(trip, guest, slot);
  const leftBehind = partyHere.filter((m) => !movers.includes(m));

  if (leftBehind.length > 0) {
    // (Party members are only "in the same place" when the guest is in an activity or At leisure.)
    const stay = leftBehind.length === 1 ? 'stays' : 'stay';
    const leftNames = joinNames(leftBehind.map((m) => names.get(m.id)));
    if (roomBefore < 1 + partyHere.length) {
      // The party could not all fit: say it once, plainly.
      warnings.push(`Only ${plural(roomBefore, 'seat')} left: ${leftNames} cannot come along and ${stay} in ${placeText(here)}. Their travel party will be split.`);
    } else {
      // The party could fit, but you chose to split it.
      warnings.push(`Their travel party will be split: ${leftNames} ${stay} in ${placeText(here)}.`);
    }
  }
  // A nearly full tour (not repeated when the message above already explains the missing seats).
  if (limited && !(leftBehind.length > 0 && roomBefore < 1 + partyHere.length)) {
    const left = roomBefore - group.length;
    if (left === 0) warnings.unshift(`Only ${plural(roomBefore, 'seat')} left: the tour will be full after this.`);
    else if (left <= 3) warnings.unshift(`${plural(left, 'seat')} left after this.`);
  }

  confirmSheet(ctx, trip, {
    title: `Move ${who}${from} to ${to}?`, detail, warnings,
    confirmLabel: 'Confirm', changes, done,
  });
}

// ---------- Cancel tour ----------

export function startCancelTour(ctx, trip, slot, activity) {
  const booked = countIn(trip, activity);
  confirmSheet(ctx, trip, {
    title: `Cancel ${activity.name}?`,
    detail: `${slotLabel(trip, slot)} · ${activityDetail(trip, slot, activity)}`,
    warnings: [booked === 0 ? 'Nobody is booked on it. It will stay visible as Cancelled.'
      : `${plural(booked, 'guest')} will move to At leisure. The tour stays visible as Cancelled.`],
    confirmLabel: 'Cancel this tour', danger: true, cancelLabel: 'Keep the tour',
    changes: [{ type: 'cancel-tour', activityId: activity.id }], done: `${activity.name} is cancelled`,
  });
}

// Makes the change (through the one change function), then closes the sheet and redraws the screen.
// If the change is refused, the sheet stays open with a message, so nothing is lost.
let saving = false; // ignore a second tap while the first is still being saved
async function saveChanges(ctx, trip, changes, done) {
  if (saving) return;
  saving = true;
  const result = await applyChange(ctx, trip.id, changes);
  saving = false;
  if (result.ok) {
    closeSheet();
    ctx.refresh();
    showToast(done);
  } else {
    showToast(result.error, true);
  }
}

// The confirmation sheet: a summary, warnings, and one Confirm button.
// A tour cancellation has its own red Confirm button, so there the Cancel button stays plain.
function confirmSheet(ctx, trip, { title, detail, warnings, confirmLabel, danger = false, cancelLabel, changes, done }) {
  const confirmButton = h('button', {
    class: `btn${danger ? ' btn--danger' : ''}`, type: 'button',
    onclick: () => saveChanges(ctx, trip, changes, done),
  }, confirmLabel);

  openSheet({
    eyebrow: 'Confirm change', title, subtitle: detail, body: [warnings.map(notice), confirmButton],
    cancelLabel, cancelDanger: !danger,
  });
}
