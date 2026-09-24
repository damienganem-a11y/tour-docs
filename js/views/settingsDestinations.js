// Settings > Destinations (step 7a/7b, owner only): edit a destination's own details and its activities.
//
//   List screen:    every destination, tap to open.
//   Detail screen:  name / country / time zone (Edit details), the list of its ACTIVE activities (tap one
//                   to edit it) with cancelled ones folded away under "N cancelled tours" (so a screen
//                   just replaced starts clean), "+ Add activity", and — tucked at the very bottom, for
//                   the rare case a whole destination must be swapped for another — "Replace this destination".
//
// Every change here goes through the one change function (changes.js), so it is in the Journal and Undo works.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { formatTime, formatTypedTime } from '../time.js';
import { slotLabel, countIn, plural, bySlotOrder } from '../rules.js';
import { pageHead } from './chrome.js';
import { undoButton } from './undo.js';
import { notice } from './move.js';
import { DESTINATION_UNDO_SCOPE } from '../journal.js';

// A time field that adds the ":" for you after the hour: many phone keyboards (numeric ones especially)
// have no ":" key, so typing "1830" becomes "18:30" as you type it.
function timeField(value, label) {
  const input = h('input', {
    class: 'text-input', type: 'text', inputmode: 'numeric', value,
    placeholder: 'HH:MM (optional)', maxlength: '5', 'aria-label': label,
  });
  input.addEventListener('input', () => { input.value = formatTypedTime(input.value); });
  return input;
}

// Destination ids whose "N cancelled tours" are expanded (kept here so it survives a redraw, like the
// open guest cards on By destination). Resets when the app is reloaded — that is fine, it is just a fold.
const openCancelled = new Set();

// True, with a toast, if the trip is archived: read-only. Checked before opening any sheet that would
// lead to a change, so an archived trip never lets you fill in a whole form only to be refused at Save.
function blockedIfArchived(trip) {
  if (!trip.archivedAt) return false;
  showToast('This trip is archived: read-only. Un-archive it on the Trips screen to make changes.', true);
  return true;
}

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
  const all = trip.activities
    .filter((a) => trip.slots.find((s) => s.id === a.slotId)?.destinationId === destination.id)
    .map((a) => ({ activity: a, slot: trip.slots.find((s) => s.id === a.slotId) }))
    .sort((x, y) => bySlotOrder(x.slot, y.slot) || (x.activity.startsAt ?? '').localeCompare(y.activity.startsAt ?? ''));
  // Cancelled tours (for example from "Replace this destination") are folded away by default: after a
  // replace, the screen is clean and ready for the new tours, instead of cluttered with the old ones.
  const active = all.filter(({ activity }) => !activity.cancelled);
  const cancelled = all.filter(({ activity }) => activity.cancelled);
  const isOpen = openCancelled.has(destination.id);
  const restaurants = trip.restaurants.filter((r) => r.destinationId === destination.id);

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings/destinations`, label: 'Destinations' },
      eyebrow: 'Destination', title: destination.name,
      subtitle: [destination.country, destination.timeZone].filter(Boolean).join(' · '),
      action: undoButton(ctx, trip, { scope: DESTINATION_UNDO_SCOPE }),
    }),
    trip.archivedAt ? notice('This trip is archived: read-only. Un-archive it on the Trips screen to make changes.') : null,
    h('button', {
      class: 'btn btn--plain btn--small', type: 'button', disabled: Boolean(trip.archivedAt),
      onclick: () => editDestination(ctx, trip, destination),
    }, 'Edit details'),
    // Restaurants before Activities (ROADMAP.md: "destination first, then Restaurants ... and
    // Activities"). Phase 3 step 1: set-up only here — nothing can be booked onto a restaurant yet.
    h('h3', { class: 'section-title' }, 'Restaurants'),
    restaurants.length === 0
      ? h('p', { class: 'empty' }, 'No restaurants yet in this destination.')
      : h('div', {}, restaurants.map((r) => restaurantRow(ctx, trip, destination, r))),
    h('button', {
      class: 'btn btn--plain', type: 'button', disabled: Boolean(trip.archivedAt),
      onclick: () => addRestaurant(ctx, trip, destination),
    }, '+ Add restaurant'),
    h('h3', { class: 'section-title' }, 'Activities'),
    active.length === 0
      ? h('p', { class: 'empty' }, cancelled.length > 0 ? 'No active tours.' : 'No activities yet in this destination.')
      : h('div', {}, active.map(({ activity, slot }) => activityRow(ctx, trip, slot, destination, activity))),
    cancelled.length > 0
      ? h('div', {},
          h('button', {
            class: 'btn btn--plain btn--small', type: 'button', style: 'margin-top: 12px;',
            onclick: () => { if (isOpen) openCancelled.delete(destination.id); else openCancelled.add(destination.id); ctx.refresh(); },
          }, `${isOpen ? '▾' : '▸'} ${plural(cancelled.length, 'cancelled tour')}`),
          isOpen ? h('div', {}, cancelled.map(({ activity, slot }) => activityRow(ctx, trip, slot, destination, activity))) : null)
      : null,
    h('button', {
      class: 'btn btn--plain', type: 'button', disabled: Boolean(trip.archivedAt),
      onclick: () => addActivity(ctx, trip, destination),
    }, '+ Add activity'),
    h('button', {
      class: 'btn btn--danger btn--small', type: 'button', style: 'margin-top: 32px;', disabled: Boolean(trip.archivedAt),
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
    class: 'card-head', type: 'button', disabled: activity.cancelled || Boolean(trip.archivedAt),
    onclick: () => editActivity(ctx, trip, slot, destination, activity),
  },
    h('div', { class: 'card-row' },
      h('div', { class: 'act-name' }, activity.name),
      h('div', { class: 'count' }, count)),
    h('div', { class: 'muted' }, detail));
  return h('div', { class: `card${activity.cancelled ? ' card--cancelled' : ''}` }, head);
}

// One restaurant, tap to edit it. Phase 3 step 1: no capacity/full-up state to show yet — nothing
// books onto it until the next step.
function restaurantSummary(r) {
  const mode = r.mode === 'flexible'
    ? `Flexible · ${r.seatsPerSeating} seats/seating · max table ${r.maxTableSize}`
    : `Strict · ${plural(r.tableSizes.length, 'table')} (${r.tableSizes.join(', ')})${r.joinable ? ', joinable' : ''}`;
  return `${mode} · ${r.seatings.join(', ')}`;
}

function restaurantRow(ctx, trip, destination, restaurant) {
  const head = h('button', {
    class: 'card-head', type: 'button', disabled: Boolean(trip.archivedAt),
    onclick: () => editRestaurant(ctx, trip, destination, restaurant),
  },
    h('div', { class: 'card-row' }, h('div', { class: 'act-name' }, restaurant.name)),
    h('div', { class: 'muted' }, restaurantSummary(restaurant)));
  return h('div', { class: 'card' }, head);
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
  const timeInput = timeField(activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : '', 'Start time');
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
  const slots = trip.slots.filter((s) => s.destinationId === destination.id).sort(bySlotOrder);
  const select = h('select', { class: 'text-input', 'aria-label': 'Half-day' },
    slots.map((s) => h('option', { value: s.id }, slotLabel(trip, s))));
  const nameInput = h('input', { class: 'text-input', type: 'text', placeholder: 'Activity name', 'aria-label': 'Name', maxlength: '80' });
  const meetingInput = h('input', { class: 'text-input', type: 'text', placeholder: 'Meeting point (optional)', 'aria-label': 'Meeting point' });
  const timeInput = timeField('', 'Start time');
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

// The fields shared by "Add a restaurant" and "Edit a restaurant" (Phase 3 step 1: set-up only,
// nothing books onto a restaurant yet). mode picks one of two ways a restaurant's capacity works:
//   Flexible   a number of seats per seating, and the biggest table it can seat at once
//   Strict     the restaurant's actual tables, one size per table, and whether tables can be pushed together
// Seating times and table sizes are typed as a comma-separated list (e.g. "19:00, 21:00" or "4, 4, 6, 8")
// rather than one row per entry: simple to type, and a restaurant rarely has more than a couple of each.
function restaurantFields(restaurant) {
  const nameInput = h('input', { class: 'text-input', type: 'text', value: restaurant?.name ?? '', placeholder: 'Restaurant name', 'aria-label': 'Name', maxlength: '80' });
  const seatingsInput = h('input', {
    class: 'text-input', type: 'text', value: restaurant?.seatings.join(', ') ?? '', placeholder: 'Seating times, e.g. 19:00, 21:00', 'aria-label': 'Seating times',
  });
  const modeSelect = h('select', { class: 'text-input', 'aria-label': 'Capacity mode' },
    h('option', { value: 'flexible' }, 'Flexible: seats + max table size'),
    h('option', { value: 'strict' }, 'Strict: exact tables'));
  modeSelect.value = restaurant?.mode ?? 'flexible';

  const seatsPerSeatingInput = h('input', {
    class: 'text-input', type: 'number', min: '1', inputmode: 'numeric', value: restaurant?.seatsPerSeating ?? '', placeholder: 'Seats per seating', 'aria-label': 'Seats per seating',
  });
  const maxTableSizeInput = h('input', {
    class: 'text-input', type: 'number', min: '1', inputmode: 'numeric', value: restaurant?.maxTableSize ?? '', placeholder: 'Max table size', 'aria-label': 'Max table size',
  });
  const flexibleFields = h('div', {}, seatsPerSeatingInput, maxTableSizeInput);

  const tableSizesInput = h('input', {
    class: 'text-input', type: 'text', value: restaurant?.tableSizes?.join(', ') ?? '', placeholder: 'Table sizes, e.g. 4, 4, 6, 8', 'aria-label': 'Table sizes',
  });
  const joinableBox = h('input', { type: 'checkbox', checked: Boolean(restaurant?.joinable), 'aria-label': 'Tables can be joined' });
  const strictFields = h('div', {}, tableSizesInput, h('label', { class: 'tick-row' }, joinableBox, h('span', {}, 'Tables can be joined')));

  const showMode = () => {
    flexibleFields.hidden = modeSelect.value !== 'flexible';
    strictFields.hidden = modeSelect.value !== 'strict';
  };
  showMode();
  modeSelect.addEventListener('change', showMode);

  const nodes = [nameInput, seatingsInput, modeSelect, flexibleFields, strictFields];
  const buildChange = () => ({
    name: nameInput.value,
    seatings: seatingsInput.value.split(',').map((t) => t.trim()).filter(Boolean),
    mode: modeSelect.value,
    seatsPerSeating: seatsPerSeatingInput.value.trim() === '' ? null : Number(seatsPerSeatingInput.value),
    maxTableSize: maxTableSizeInput.value.trim() === '' ? null : Number(maxTableSizeInput.value),
    tableSizes: tableSizesInput.value.trim() === '' ? [] : tableSizesInput.value.split(',').map((t) => Number(t.trim())),
    joinable: joinableBox.checked,
  });
  return { nameInput, nodes, buildChange };
}

function addRestaurant(ctx, trip, destination) {
  const { nameInput, nodes, buildChange } = restaurantFields(null);
  const confirm = h('button', {
    class: 'btn', type: 'button',
    onclick: () => save(ctx, trip.id, { type: 'add-restaurant', destinationId: destination.id, ...buildChange() }, `"${nameInput.value.trim()}" added`),
  }, 'Add');

  openSheet({
    eyebrow: destination.name, title: 'Add a restaurant',
    subtitle: 'Seating times and table sizes are typed as a list, e.g. "19:00, 21:00".',
    body: [...nodes, confirm], cancelLabel: 'Cancel',
  });
}

function editRestaurant(ctx, trip, destination, restaurant) {
  const { nameInput, nodes, buildChange } = restaurantFields(restaurant);
  const confirm = h('button', {
    class: 'btn', type: 'button',
    onclick: () => save(ctx, trip.id, { type: 'edit-restaurant', restaurantId: restaurant.id, ...buildChange() }, `"${nameInput.value.trim()}" updated`),
  }, 'Save');

  openSheet({
    eyebrow: destination.name, title: `Edit "${restaurant.name}"`,
    subtitle: 'Seating times and table sizes are typed as a list, e.g. "19:00, 21:00".',
    body: [...nodes, confirm], cancelLabel: 'Cancel',
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
      notice(`All of ${destination.name}'s activities will be cancelled and every guest on them will be moved to At leisure`
        + `${activeTours.length > 0 ? ` (${plural(activeTours.length, 'tour')}, ${plural(bookedCount, 'guest')})` : ''}. `
        + 'You then create the new tours for the new place, one by one, with "+ Add activity".'),
      nameInput, countryInput, zoneInput, confirm,
    ],
    cancelLabel: 'Keep this destination', cancelDanger: false,
  });
}
