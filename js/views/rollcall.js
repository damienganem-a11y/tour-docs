// The roll call screen (check-in at departure): #/trip/<id>/rollcall/<activityId>
//
//   - Top row: the vehicles (V1, V2...) and a + to add one. Tap a vehicle to choose it; tap the chosen one
//     again to see who is inside; long-press a vehicle to change its number.
//   - One tap on a guest puts them in the chosen vehicle and takes them off the list. No question, no
//     confirmation: speed first. Undo (like Ctrl+Z) takes back the last tap.
//   - Long-press a guest: At leisure, or another tour of the same half-day.
//   - "Add guest": somebody from another tour joins this one and goes straight into the chosen vehicle.
// Every tap goes through the one change function (changes.js) and is written in the journal.

import { h, pressable } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { formatTime } from '../time.js';
import { byName, displayNames, plural } from '../rules.js';
import { findRollCall, vehicleLabel, rollCallState } from '../rollcall.js';
import { forcedPlacements } from '../journal.js';
import { pageHead } from './chrome.js';
import { undoButton } from './undo.js';
import { startMove, startAddGuest, choiceRow, notice } from './move.js';

// Which vehicle the taps go into, for each roll call (remembered while the app is open).
const chosenVehicle = new Map();

export function rollCallView(ctx, tripId, activityId) {
  const trip = ctx.trip(tripId);
  const activity = trip?.activities.find((a) => a.id === activityId);
  if (!trip || !activity) {
    return { node: h('div', { class: 'screen' }, pageHead({ back: { href: '#/', label: 'All trips' }, title: 'Roll call not found' })) };
  }

  const slot = trip.slots.find((s) => s.id === activity.slotId);
  const destination = trip.destinations.find((d) => d.id === slot.destinationId);
  const backTo = { href: `#/trip/${trip.id}/use/destination/${destination.id}/${slot.id}`, label: 'By destination' };
  const rollCall = findRollCall(trip, activity.id);

  if (!rollCall) {
    return {
      node: h('div', { class: 'screen' },
        pageHead({ back: backTo, eyebrow: 'Roll call', title: activity.name, subtitle: 'No roll call has been started for this tour.' })),
    };
  }

  const names = displayNames(trip.guests);
  const state = rollCallState(trip, rollCall);
  const label = (vehicle) => vehicleLabel(trip, vehicle);
  const selected = rollCall.vehicles.find((v) => v.id === chosenVehicle.get(rollCall.id)) ?? rollCall.vehicles[0];
  chosenVehicle.set(rollCall.id, selected.id);

  // Makes one change; if it works the screen is redrawn (keeping its place), if not a message says why.
  async function change(changes) {
    const result = await applyChange(ctx, trip.id, changes);
    if (result.ok) ctx.refresh(); else showToast(result.error, true);
    return result;
  }
  const rollCallChange = (type, extra = {}) => ({ type, activityId: activity.id, ...extra });

  // ---------- Vehicles ----------

  function chooseVehicle(vehicle) {
    chosenVehicle.set(rollCall.id, vehicle.id);
    ctx.refresh();
  }

  // Who is inside a vehicle; tap somebody to take them out or move them to another vehicle.
  function showInside(vehicle) {
    const inside = [...(state.perVehicle.get(vehicle.id) ?? [])].sort(byName);
    openSheet({
      eyebrow: 'Roll call', title: `${label(vehicle)} · ${plural(inside.length, 'guest')} inside`, subtitle: activity.name,
      body: inside.length === 0
        ? [notice('Nobody is in this vehicle yet.')]
        : inside.map((guest) => choiceRow({ title: names.get(guest.id), detail: 'Tap to take out or move', onclick: () => guestInVehicle(guest, vehicle) })),
      cancelLabel: 'Close',
    });
  }

  function guestInVehicle(guest, vehicle) {
    const others = rollCall.vehicles.filter((v) => v.id !== vehicle.id);
    openSheet({
      eyebrow: label(vehicle), title: names.get(guest.id), subtitle: 'Where should they go?',
      body: [
        choiceRow({ title: 'Back on the list', detail: 'Not checked in', onclick: async () => { closeSheet(); await change(rollCallChange('checkout', { guestId: guest.id })); } }),
        ...others.map((v) => choiceRow({ title: `Move to ${label(v)}`, onclick: async () => { closeSheet(); await change(rollCallChange('checkin', { guestId: guest.id, vehicleId: v.id })); } })),
      ],
    });
  }

  // Long-press a vehicle: change its number (for example V1 becomes V4 when the fleet is shared between tours).
  function renumber(vehicle) {
    const input = h('input', { class: 'text-input', type: 'number', inputmode: 'numeric', min: '1', max: '99', value: String(vehicle.number), 'aria-label': 'Vehicle number' });
    openSheet({
      eyebrow: 'Roll call', title: `Change the number of ${label(vehicle)}`, subtitle: 'A whole number. Two vehicles cannot have the same number.',
      body: [
        input,
        h('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            const result = await applyChange(ctx, trip.id, rollCallChange('vehicle-number', { vehicleId: vehicle.id, number: Number(input.value) }));
            if (result.ok) { closeSheet(); ctx.refresh(); } else showToast(result.error, true);
          },
        }, 'Save'),
      ],
    });
  }

  const vehicleButtons = rollCall.vehicles.map((vehicle) => {
    const button = h('button', {
      class: `vehicle${vehicle.id === selected.id ? ' is-selected' : ''}`, type: 'button',
      'aria-label': `${label(vehicle)}, ${plural((state.perVehicle.get(vehicle.id) ?? []).length, 'guest')}. Tap to choose, long-press to change the number.`,
    },
      h('span', { class: 'vehicle-label' }, label(vehicle)),
      h('span', { class: 'vehicle-count' }, String((state.perVehicle.get(vehicle.id) ?? []).length)));
    pressable(button, {
      tap: () => (vehicle.id === selected.id ? showInside(vehicle) : chooseVehicle(vehicle)),
      long: () => renumber(vehicle),
    });
    return button;
  });

  const addVehicle = h('button', {
    class: 'vehicle vehicle--add', type: 'button', 'aria-label': 'Add a vehicle',
    onclick: async () => {
      const result = await change(rollCallChange('vehicle-add'));
      if (result.ok) chosenVehicle.set(rollCall.id, result.entries[0].vehicleId); // the new vehicle is ready for the next taps
    },
  }, '+');

  // ---------- The guests still expected ----------

  const forced = forcedPlacements(ctx.journal(trip.id)); // guests who are on this tour by force show in orange
  const isForced = (guest) => forced.get(`${guest.id}|${slot.id}`)?.to.activityId === activity.id;

  const rows = [...state.expected].sort(byName).map((guest, index) => {
    const row = h('button', { class: `rc-guest${isForced(guest) ? ' rc-guest--forced' : ''}`, type: 'button' },
      h('span', {}, names.get(guest.id)),
      index === 0 ? h('span', { class: 'rc-tap' }, `tap = ${label(selected)}`) : null);
    pressable(row, {
      tap: () => change(rollCallChange('checkin', { guestId: guest.id, vehicleId: selected.id })),
      long: () => startMove(ctx, trip, guest, slot, { askParty: false }), // At leisure, or another tour: asks to confirm
    });
    return row;
  });

  const startTime = activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : '';
  return {
    node: h('div', { class: 'screen' },
      pageHead({
        back: backTo,
        eyebrow: `Roll call · started by ${rollCall.startedBy.name}`,
        title: activity.name,
        subtitle: [destination.name, startTime, `${state.expected.length} still expected`].filter(Boolean).join(' · '),
      }),
      h('div', { class: 'vehicles' }, vehicleButtons, addVehicle),
      undoButton(ctx, trip, { wide: true }),
      rows.length === 0 ? h('p', { class: 'empty' }, 'Everybody is checked in.') : rows,
      h('p', { class: 'rc-hint' }, 'Long-press a name: At leisure or another tour'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => startAddGuest(ctx, trip, slot, activity, { vehicle: selected }) }, '+ Add guest'),
      h('button', { class: 'btn', type: 'button', disabled: true }, 'End roll call'),
      h('p', { class: 'muted footer-note' }, 'Ending the roll call comes in the next update.')
    ),
  };
}
