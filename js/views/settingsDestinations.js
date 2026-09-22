// Settings > Destinations (step 7a/7b, owner only): edit a destination's own details and its activities.
//
//   List screen:    every destination, tap to open.
//   Detail screen:  name / country / time zone (Edit details), the list of its activities (tap one to
//                   edit it), "+ Add activity", and — tucked at the very bottom, for the rare case a
//                   whole destination must be swapped for another — "Replace this destination".
//
// Every change here goes through the one change function (changes.js), so it is in the Journal and Undo works.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { formatTime } from '../time.js';
import { slotLabel, countIn, plural } from '../rules.js';
import { pageHead } from './chrome.js';
import { undoButton } from './undo.js';
import { notice } from './move.js';

// Saves one settings change; closes the sheet and redraws on success, shows the reason on failure.
let saving = false;
async function save(ctx, tripId, change, done) {
  if (saving) return false;
  saving = true;
  const result = await applyChange(ctx, tripId, change);
  saving = false;
  if (result.ok) { closeSheet(); ctx.refresh(); if (done) showToast(done); return true; }
  showToast(result.error, true);
  return false;
}

export function destinationsSettingsPage(ctx, trip, destinationId) {
  const destination = trip.destinations.find((d) => d.id === destinationId);
  return destination ? detailPage(ctx, trip, destination) : listPage(ctx, trip);
}

function listPage(ctx, trip) {
  return h('div', {},
    pageHead({ back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' }, eyebrow: 'Settings', title: 'Destinations' }),
    h('div', { class: 'menu' },
      trip.destinations.map((d) => h('a', { class: 'menu-row', href: `#/trip/${trip.id}/settings/destinations/${d.id}` },
        h('span', {}, d.name),
        h('span', { class: 'menu-side' }, h('span', { class: 'muted' }, d.country), h('span', { class: 'row-chev' }, '›'))))));
}

function detailPage(ctx, trip, destination) {
  const activities = trip.activities
    .filter((a) => trip.slots.find((s) => s.id === a.slotId)?.destinationId === destination.id)
    .map((a) => ({ activity: a, slot: trip.slots.find((s) => s.id === a.slotId) }))
    .sort((x, y) => x.slot.day - y.slot.day || x.slot.half.localeCompare(y.slot.half) || (x.activity.startsAt ?? '').localeCompare(y.activity.startsAt ?? ''));

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings/destinations`, label: 'Destinations' },
      eyebrow: 'Destination', title: destination.name,
      subtitle: [destination.country, destination.timeZone].filter(Boolean).join(' · '),
      action: undoButton(ctx, trip),
    }),
    h('button', { class: 'btn btn--plain btn--small', type: 'button', onclick: () => editDestination(ctx, trip, destination) }, 'Edit details'),
    h('h3', { class: 'section-title' }, 'Activities'),
    activities.length === 0
      ? h('p', { class: 'empty' }, 'No activities yet in this destination.')
      : h('div', {}, activities.map(({ activity, slot }) => activityRow(ctx, trip, slot, destination, activity))),
    h('button', { class: 'btn btn--plain', type: 'button', onclick: () => addActivity(ctx, trip, destination) }, '+ Add activity'),
    h('button', {
      class: 'btn btn--plain btn--small footer-note', type: 'button', style: 'margin-top: 32px;',
      onclick: () => replaceDestination(ctx, trip, destination),
    }, 'Replace this destination…'));
}

// One activity, tap to edit it (a cancelled activity can only be brought back with Undo, so it is not tappable here).
function activityRow(ctx, trip, slot, destination, activity) {
  const detail = [
    activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : 'No time set',
    activity.meeting || 'No meeting point set',
    slotLabel(trip, slot),
  ].join(' · ');
  const count = activity.cancelled ? 'Cancelled' : activity.capacity === null ? 'No limit' : `Capacity ${activity.capacity}`;

  const head = h('button', {
    class: 'card-head', type: 'button', disabled: activity.cancelled,
    onclick: () => editActivity(ctx, trip, slot, destination, activity),
  },
    h('div', { class: 'card-row' },
      h('div', { class: 'act-name' }, activity.name),
      h('div', { class: 'count' }, count)),
    h('div', { class: 'muted' }, detail));
  return h('div', { class: `card${activity.cancelled ? ' card--cancelled' : ''}` }, head);
}

// ---------- Sheets ----------

function editDestination(ctx, trip, destination) {
  const nameInput = h('input', { class: 'text-input', type: 'text', value: destination.name, 'aria-label': 'Name', maxlength: '80' });
  const countryInput = h('input', { class: 'text-input', type: 'text', value: destination.country ?? '', placeholder: 'Country (optional)', 'aria-label': 'Country' });
  const zoneInput = h('input', {
    class: 'text-input', type: 'text', value: destination.timeZone, placeholder: 'e.g. Europe/Lisbon',
    autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Time zone',
  });

  const confirm = h('button', {
    class: 'btn', type: 'button',
    onclick: () => save(ctx, trip.id, {
      type: 'edit-destination', destinationId: destination.id,
      name: nameInput.value, country: countryInput.value, timeZone: zoneInput.value.trim(),
    }, `"${nameInput.value.trim()}" updated`),
  }, 'Save');

  openSheet({
    eyebrow: 'Destination', title: 'Edit destination details',
    subtitle: 'The time zone must be one the phone knows, like Europe/Lisbon or Asia/Tokyo.',
    body: [nameInput, countryInput, zoneInput, confirm], cancelLabel: 'Cancel',
  });
}

function editActivity(ctx, trip, slot, destination, activity) {
  const nameInput = h('input', { class: 'text-input', type: 'text', value: activity.name, 'aria-label': 'Name', maxlength: '80' });
  const meetingInput = h('input', { class: 'text-input', type: 'text', value: activity.meeting ?? '', placeholder: 'Meeting point (optional)', 'aria-label': 'Meeting point' });
  const timeInput = h('input', {
    class: 'text-input', type: 'text', value: activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : '',
    placeholder: 'HH:MM (optional)', inputmode: 'numeric', 'aria-label': 'Start time',
  });
  const capacityInput = h('input', {
    class: 'text-input', type: 'number', min: '1', value: activity.capacity ?? '', placeholder: 'No limit', inputmode: 'numeric', 'aria-label': 'Capacity',
  });

  const confirm = h('button', {
    class: 'btn', type: 'button',
    onclick: () => save(ctx, trip.id, {
      type: 'edit-activity', activityId: activity.id,
      name: nameInput.value, meeting: meetingInput.value, startTime: timeInput.value.trim(),
      capacity: capacityInput.value.trim() === '' ? null : Number(capacityInput.value),
    }, `"${nameInput.value.trim()}" updated`),
  }, 'Save');

  openSheet({
    eyebrow: slotLabel(trip, slot), title: `Edit "${activity.name}"`, subtitle: destination.name,
    body: [nameInput, meetingInput, timeInput, capacityInput, confirm], cancelLabel: 'Cancel',
  });
}

function addActivity(ctx, trip, destination) {
  const slots = trip.slots.filter((s) => s.destinationId === destination.id).sort((a, b) => a.day - b.day || a.half.localeCompare(b.half));
  const select = h('select', { class: 'text-input', 'aria-label': 'Half-day' },
    slots.map((s) => h('option', { value: s.id }, slotLabel(trip, s))));
  const nameInput = h('input', { class: 'text-input', type: 'text', placeholder: 'Activity name', 'aria-label': 'Name', maxlength: '80' });
  const meetingInput = h('input', { class: 'text-input', type: 'text', placeholder: 'Meeting point (optional)', 'aria-label': 'Meeting point' });
  const timeInput = h('input', { class: 'text-input', type: 'text', placeholder: 'HH:MM (optional)', inputmode: 'numeric', 'aria-label': 'Start time' });
  const capacityInput = h('input', { class: 'text-input', type: 'number', min: '1', placeholder: 'No limit', inputmode: 'numeric', 'aria-label': 'Capacity' });

  const confirm = h('button', {
    class: 'btn', type: 'button',
    onclick: () => save(ctx, trip.id, {
      type: 'add-activity', slotId: select.value,
      name: nameInput.value, meeting: meetingInput.value, startTime: timeInput.value.trim(),
      capacity: capacityInput.value.trim() === '' ? null : Number(capacityInput.value),
    }, `"${nameInput.value.trim()}" added`),
  }, 'Add');

  openSheet({
    eyebrow: destination.name, title: 'Add an activity',
    body: [select, nameInput, meetingInput, timeInput, capacityInput, confirm], cancelLabel: 'Cancel',
  });
}

// A rare, deliberately unobtrusive action: the destination becomes a different place altogether (a city
// turns out to be impossible to visit, for example). Its tours are cancelled and everybody on them moves
// to At leisure, all in one action; the owner then rebuilds the activities with "+ Add activity".
function replaceDestination(ctx, trip, destination) {
  const activeTours = trip.activities.filter((a) => trip.slots.find((s) => s.id === a.slotId)?.destinationId === destination.id && !a.cancelled);
  const bookedCount = activeTours.reduce((sum, a) => sum + countIn(trip, a), 0);

  const nameInput = h('input', { class: 'text-input', type: 'text', placeholder: 'New destination name', 'aria-label': 'New name', maxlength: '80' });
  const countryInput = h('input', { class: 'text-input', type: 'text', placeholder: 'Country (optional)', 'aria-label': 'Country' });
  const zoneInput = h('input', {
    class: 'text-input', type: 'text', placeholder: 'e.g. Africa/Casablanca', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Time zone',
  });

  const confirm = h('button', {
    class: 'btn btn--danger', type: 'button',
    onclick: async () => {
      const ok = await save(ctx, trip.id, {
        type: 'replace-destination', destinationId: destination.id,
        name: nameInput.value, country: countryInput.value, timeZone: zoneInput.value.trim(),
      }, `${destination.name} replaced with ${nameInput.value.trim()}`);
      if (ok) ctx.go(`#/trip/${trip.id}/settings/destinations/${destination.id}`); // straight to the (now renamed) destination
    },
  }, 'Replace this destination');

  openSheet({
    eyebrow: 'Rare change', title: `Replace ${destination.name} with a different place?`,
    subtitle: 'For the rare case a whole destination changes, for example a city that turns out to be impossible to visit.',
    body: [
      notice(activeTours.length === 0
        ? 'This destination has no active tours to cancel.'
        : `${plural(activeTours.length, 'tour')} will be cancelled${bookedCount > 0 ? ` and ${plural(bookedCount, 'guest')} moved to At leisure` : ''}. You then rebuild the activities for the new place with "+ Add activity".`),
      nameInput, countryInput, zoneInput, confirm,
    ],
    cancelLabel: 'Keep this destination',
  });
}
