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

  const names = displayNames(trip.guests);
  const who = names.get(guest.id);
  const moverNames = joinNames(movers.map((m) => names.get(m.id)));

  // How many free places does the target have? (Unlimited for At leisure and for activities with no capacity.)
  const room = target.kind === 'activity' && target.activity.capacity !== null
    ? target.activity.capacity - countIn(trip, target.activity) : Infinity;

  if (room >= 1 + movers.length) {
    openSheet({
      eyebrow: 'Travel party', title: 'Also move their travel party?', subtitle: moverNames,
      body: [
        h('button', { class: 'btn', type: 'button', onclick: () => confirmMove(ctx, trip, guest, slot, target, movers) }, `Yes, move ${moverNames} too`),
        h('button', { class: 'btn btn--plain', type: 'button', onclick: () => confirmMove(ctx, trip, guest, slot, target, []) }, `No, only ${who}`),
      ],
    });
  } else {
    // There is room for the guest but not for everybody: only the tapped guest can move.
    openSheet({
      eyebrow: 'Travel party', title: 'Their travel party cannot follow', subtitle: moverNames,
      body: [
        notice(`Only ${plural(room, 'seat')} left in "${target.activity.name}": ${moverNames} cannot come along.`),
        h('button', { class: 'btn', type: 'button', onclick: () => confirmMove(ctx, trip, guest, slot, target, []) }, `Continue with ${who} only`),
      ],
    });
  }
}

// ---------- 4. Confirmation screen ----------

// group: the guests moving together (the tapped guest, and party members if you said Yes).
function confirmMove(ctx, trip, guest, slot, target, movers) {
  const names = displayNames(trip.guests);
  const group = [guest, ...movers];
  const who = joinNames(group.map((g) => names.get(g.id)));
  const here = guestPlace(trip, guest, slot);
  const to = target.kind === 'leisure' ? 'At leisure' : target.activity.name;
  const from = here.kind === 'blank' ? '' : ` from ${here.kind === 'unknown' ? `"${here.raw}"` : placeText(here)}`;

  // Warnings (shown in the warning colour): a nearly full tour, a split travel party.
  const warnings = [];
  if (target.kind === 'activity' && target.activity.capacity !== null) {
    const roomBefore = target.activity.capacity - countIn(trip, target.activity);
    const left = roomBefore - group.length;
    if (left === 0) warnings.push(`Only ${plural(roomBefore, 'seat')} left: the tour will be full after this.`);
    else if (left <= 3) warnings.push(`${plural(left, 'seat')} left after this.`);
  }
  const leftBehind = partyMovers(trip, guest, slot).filter((m) => !movers.includes(m));
  if (leftBehind.length > 0) {
    // (Party members are only "in the same place" when the guest is in an activity or At leisure.)
    const stay = leftBehind.length === 1 ? 'stays' : 'stay';
    warnings.push(`Their travel party will be split: ${joinNames(leftBehind.map((m) => names.get(m.id)))} ${stay} in ${placeText(here)}.`);
  }

  const detail = target.kind === 'activity'
    ? `${slotLabel(trip, slot)} · ${activityDetail(trip, slot, target.activity)}`
    : slotLabel(trip, slot);

  const changes = group.map((g) => ({
    type: 'move', guestId: g.id, slotId: slot.id,
    to: target.kind === 'leisure' ? { kind: 'leisure' } : { kind: 'activity', activityId: target.activity.id },
  }));
  confirmSheet(ctx, trip, {
    title: `Move ${who}${from} to ${to}?`, detail, warnings,
    confirmLabel: 'Confirm', changes, done: `Moved ${who} to ${to}`,
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

// The confirmation sheet used by every change: a summary, warnings, and one Confirm button.
function confirmSheet(ctx, trip, { title, detail, warnings, confirmLabel, danger = false, cancelLabel, changes, done }) {
  let busy = false; // ignore a second tap while the first is still being saved

  const confirmButton = h('button', {
    class: `btn${danger ? ' btn--danger' : ''}`, type: 'button',
    onclick: async () => {
      if (busy) return;
      busy = true;
      const result = await applyChange(ctx, trip.id, changes);
      busy = false;
      if (result.ok) {
        closeSheet();
        ctx.refresh();
        showToast(done);
      } else {
        showToast(result.error, true); // the sheet stays open so nothing is lost
      }
    },
  }, confirmLabel);

  openSheet({ eyebrow: 'Confirm change', title, subtitle: detail, body: [warnings.map(notice), confirmButton], cancelLabel });
}
