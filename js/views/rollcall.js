// The roll call screen: #/trip/<id>/rollcall/<activityId>. One screen, three states:
//
//   1. THE ROLL CALL (check-in at departure)
//      - A search bar at the very top, then the vehicles (V1, V2...) and a + to add one. Tap a vehicle to choose it;
//        tap the chosen one again to see who is inside; long-press a vehicle to change its number.
//      - One tap on a guest puts them in the chosen vehicle and takes them off the list: no confirmation, speed
//        first. If their travel party is still expected, ONE question: "Also check in Susan S.?"
//        Undo (like Ctrl+Z) takes back the last tap.
//      - Long-press a guest: At leisure, or another tour of the same half-day.
//      - "Add guest": somebody from another tour joins this one and appears in the list (not put in a vehicle).
//      - "End roll call": lists everyone who did not show up; each name can be unticked; the rest go to At leisure.
//   2. THE ROLL CALL HAS ENDED: the vehicles and who was in them are kept. "Start return count" begins the count back.
//   3. THE RETURN COUNT (on the way back): the same vehicles; tap each guest as they board. Each vehicle shows
//      how many are back out of how many left.
// Every list is alphabetical by the name shown. Every tap goes through the one change function (changes.js).

import { h, pressable } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { formatTime, formatMoment } from '../time.js';
import { alphabetical, displayNames, plain, plural, joinNames } from '../rules.js';
import { findRollCall, vehicleLabel, rollCallState, returnState } from '../rollcall.js';
import { forcedPlacements } from '../journal.js';
import { pageHead } from './chrome.js';
import { undoButton } from './undo.js';
import { startMove, startAddGuest, choiceRow, notice } from './move.js';

// What is remembered while the app is open, for each roll call and state: which vehicle the taps go into, and the search words.
const chosenVehicle = new Map();
const searchWords = new Map();

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

  const mode = !rollCall.endedAt ? 'departure' : !rollCall.returnCount ? 'ended' : 'return';
  const key = `${rollCall.id}|${mode}`;
  const names = displayNames(trip.guests);
  const inOrder = alphabetical(names);
  const state = mode === 'return' ? returnState(trip, rollCall) : rollCallState(trip, rollCall);
  const label = (vehicle) => vehicleLabel(trip, vehicle);
  const selected = rollCall.vehicles.find((v) => v.id === chosenVehicle.get(key)) ?? rollCall.vehicles[0];
  chosenVehicle.set(key, selected.id);

  // The guests this state is about: those still expected (roll call) or still to count back (return count).
  const pending = mode === 'return' ? state.toCount : state.expected;
  const inVehicle = (vehicle) => (mode === 'return' ? state.backPerVehicle : state.perVehicle).get(vehicle.id) ?? [];
  const inType = mode === 'return' ? 'return-in' : 'checkin';
  const outType = mode === 'return' ? 'return-out' : 'checkout';

  // Makes one change (or several together); if it works the screen is redrawn (keeping its place), if not a message says why.
  async function change(changes) {
    const result = await applyChange(ctx, trip.id, changes);
    if (result.ok) ctx.refresh(); else showToast(result.error, true);
    return result;
  }
  const rollCallChange = (type, extra = {}) => ({ type, activityId: activity.id, ...extra });
  const countChange = (guest, vehicle) => rollCallChange(inType, { guestId: guest.id, vehicleId: vehicle.id });

  // ---------- Vehicles ----------

  function chooseVehicle(vehicle) {
    chosenVehicle.set(key, vehicle.id);
    ctx.refresh();
  }

  // Who is inside a vehicle. During the roll call and the return count you can take somebody out or move them.
  function showInside(vehicle) {
    const inside = [...inVehicle(vehicle)].sort(inOrder);
    const editable = mode !== 'ended';
    const missing = mode === 'return' ? [...(state.missingPerVehicle.get(vehicle.id) ?? [])].sort(inOrder) : [];
    const heading = mode === 'return'
      ? `${label(vehicle)} · ${inside.length} of ${(state.perVehicle.get(vehicle.id) ?? []).length} back`
      : `${label(vehicle)} · ${plural(inside.length, 'guest')} inside`;

    openSheet({
      eyebrow: mode === 'return' ? 'Return count' : 'Roll call', title: heading, subtitle: activity.name,
      body: [
        missing.length > 0 ? notice(`Not back yet from ${label(vehicle)}: ${joinNames(missing.map((g) => names.get(g.id)))}`) : null,
        inside.length === 0
          ? notice(mode === 'return' ? 'Nobody has been counted back into this vehicle yet.' : 'Nobody is in this vehicle.')
          : inside.map((guest) => (editable
              ? choiceRow({ title: names.get(guest.id), detail: 'Tap to take out or move', onclick: () => guestInVehicle(guest, vehicle) })
              : h('div', { class: 'line' }, h('strong', {}, names.get(guest.id))))),
      ],
      cancelLabel: 'Close',
    });
  }

  function guestInVehicle(guest, vehicle) {
    const others = rollCall.vehicles.filter((v) => v.id !== vehicle.id);
    openSheet({
      eyebrow: label(vehicle), title: names.get(guest.id), subtitle: 'Where should they go?',
      body: [
        choiceRow({
          title: mode === 'return' ? 'Not back yet' : 'Back on the list', detail: mode === 'return' ? 'Take out of the count' : 'Not checked in',
          onclick: async () => { closeSheet(); await change(rollCallChange(outType, { guestId: guest.id })); },
        }),
        ...others.map((v) => choiceRow({ title: `Move to ${label(v)}`, onclick: async () => { closeSheet(); await change(countChange(guest, v)); } })),
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

  // The number under each vehicle: who is inside (roll call), or how many are back out of how many left (return count).
  const countText = (vehicle) => (mode === 'return'
    ? `${inVehicle(vehicle).length}/${(state.perVehicle.get(vehicle.id) ?? []).length}`
    : String(inVehicle(vehicle).length));

  const vehicleButtons = rollCall.vehicles.map((vehicle) => {
    const button = h('button', {
      class: `vehicle${vehicle.id === selected.id && mode !== 'ended' ? ' is-selected' : ''}`, type: 'button',
      'aria-label': `${label(vehicle)}, ${countText(vehicle)}.`,
    },
      h('span', { class: 'vehicle-label' }, label(vehicle)),
      h('span', { class: 'vehicle-count' }, countText(vehicle)));
    pressable(button, {
      tap: () => (mode === 'ended' || vehicle.id === selected.id ? showInside(vehicle) : chooseVehicle(vehicle)),
      long: () => { if (mode === 'departure') renumber(vehicle); }, // only during the roll call: on the way back the vehicles are as they left
    });
    return button;
  });

  const addVehicle = h('button', {
    class: 'vehicle vehicle--add', type: 'button', 'aria-label': 'Add a vehicle',
    onclick: async () => {
      const result = await change(rollCallChange('vehicle-add'));
      if (result.ok) chosenVehicle.set(key, result.entries[0].vehicleId); // the new vehicle is ready for the next taps
    },
  }, '+');

  // ---------- The guests still expected (or still to count back) ----------

  const forced = forcedPlacements(ctx.journal(trip.id)); // guests who are on this tour by force show in orange
  const isForced = (guest) => forced.get(`${guest.id}|${slot.id}`)?.to.activityId === activity.id;

  // A tap counts the guest into the chosen vehicle. If their travel party is still to come, ask about them too (one question).
  function tapGuest(guest) {
    searchWords.delete(key); // the next guest is found with a fresh search
    const partners = pending.filter((g) => g.partyId === guest.partyId && g.id !== guest.id).sort(inOrder);
    if (partners.length === 0) return change(countChange(guest, selected));

    const partnerNames = joinNames(partners.map((g) => names.get(g.id)));
    const back = mode === 'return';
    openSheet({
      eyebrow: 'Travel party', title: `Also ${back ? 'count' : 'check in'} ${partnerNames}${back ? ' back' : ''}?`, subtitle: `${names.get(guest.id)} goes into ${label(selected)}`,
      body: [
        h('button', { class: 'btn', type: 'button', onclick: () => change([guest, ...partners].map((g) => countChange(g, selected))) }, `Yes, ${back ? 'count' : 'check in'} ${partnerNames} too`),
        h('button', { class: 'btn btn--plain', type: 'button', onclick: () => change(countChange(guest, selected)) }, `No, only ${names.get(guest.id)}`),
      ],
      cancelDanger: true,
    });
  }

  // The list, alphabetical, filtered by what is typed in the search bar at the top.
  const list = h('div', {});
  function fillList() {
    const words = plain(searchWords.get(key) ?? '').split(/\s+/).filter(Boolean);
    const shown = [...pending].sort(inOrder).filter((g) => words.every((w) => plain(`${g.first} ${g.last}`).includes(w)));

    list.replaceChildren(...(shown.length === 0
      ? [h('p', { class: 'empty' }, pending.length === 0 ? (mode === 'return' ? 'Everybody is back.' : 'Everybody is checked in.') : 'No guest matches that search.')]
      : shown.map((guest, index) => {
          const wasIn = mode === 'return' ? rollCall.vehicles.find((v) => v.id === rollCall.checkins[guest.id]) : null; // where they left from
          const row = h('button', { class: `rc-guest${isForced(guest) ? ' rc-guest--forced' : ''}`, type: 'button' },
            h('span', {}, names.get(guest.id)),
            mode === 'departure' && index === 0 ? h('span', { class: 'rc-tap' }, `tap = ${label(selected)}`) : null,
            wasIn ? h('span', { class: 'rc-was' }, `was ${label(wasIn)}`) : null);
          pressable(row, {
            tap: () => tapGuest(guest),
            long: () => { if (mode === 'departure') startMove(ctx, trip, guest, slot, { askParty: false }); }, // At leisure, or another tour: asks to confirm
          });
          return row;
        })));
  }

  const search = h('input', {
    class: 'text-input', type: 'search', placeholder: 'Search guests', value: searchWords.get(key) ?? '',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search guests',
    oninput: () => { searchWords.set(key, search.value); fillList(); },
  });
  fillList();

  // ---------- End roll call ----------

  // Lists everyone who did not show up. Each name has a tick: ticked = moved to At leisure, unticked = stays on
  // the tour (someone who joined on site). Then the roll call is closed and the vehicles are kept for the return count.
  function endRollCall() {
    const absent = [...state.expected].sort(inOrder);
    const moving = new Set(absent.map((g) => g.id));
    const summary = h('div', { class: 'notice' });
    const say = () => {
      summary.textContent = absent.length === 0 ? 'Everybody is checked in.'
        : moving.size === 0 ? 'Nobody will be moved: everybody stays booked on this tour.'
        : `${plural(moving.size, 'guest')} will be moved to At leisure.`;
    };
    say();

    const rows = absent.map((guest) => {
      const box = h('input', { type: 'checkbox', checked: true, 'aria-label': names.get(guest.id) });
      box.addEventListener('change', () => { if (box.checked) moving.add(guest.id); else moving.delete(guest.id); say(); });
      return h('label', { class: 'tick-row' }, box, h('span', {}, names.get(guest.id)));
    });

    const confirm = h('button', {
      class: 'btn', type: 'button',
      onclick: async () => {
        const result = await applyChange(ctx, trip.id, rollCallChange('rollcall-end', { moveGuestIds: [...moving] }));
        if (result.ok) {
          closeSheet();
          ctx.refresh();
          showToast(moving.size > 0 ? `Roll call ended: ${plural(moving.size, 'guest')} moved to At leisure` : 'Roll call ended');
        } else showToast(result.error, true);
      },
    }, 'End roll call');

    openSheet({
      eyebrow: 'End roll call', title: `End the roll call for ${activity.name}?`,
      subtitle: `${state.checkedIn.length} checked in · ${absent.length === 0 ? 'nobody missing' : `${absent.length} did not show up`}. Untick anyone who joined on site.`,
      body: [summary, rows],
      footer: confirm, cancelDanger: true,
    });
  }

  // ---------- The screen ----------

  const startTime = activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : '';
  const where = [destination.name, startTime];

  if (mode === 'ended') {
    const endedAt = `${formatMoment(rollCall.endedAt, destination.timeZone)} ${destination.name} time`;
    return {
      node: h('div', { class: 'screen' },
        pageHead({
          back: backTo, eyebrow: `Roll call ended · ${rollCall.endedBy?.name ?? ''}`, title: activity.name,
          subtitle: [...where, `${state.checkedIn.length} checked in`, endedAt].filter(Boolean).join(' · '),
        }),
        h('div', { class: 'vehicles' }, vehicleButtons),
        undoButton(ctx, trip, { wide: true }),
        h('button', { class: 'btn', type: 'button', onclick: () => change(rollCallChange('return-start')) }, 'Start return count'),
        h('p', { class: 'muted footer-note' }, 'The vehicles and who was in them are kept. Tap a vehicle to see who left in it. Undo takes End roll call back.')),
    };
  }

  if (mode === 'return') {
    return {
      node: h('div', { class: 'screen' },
        pageHead({
          back: backTo, eyebrow: `Return count · started by ${rollCall.returnCount.startedBy.name}`, title: activity.name,
          subtitle: [...where, state.toCount.length === 0 ? 'everybody is back' : `${state.toCount.length} still to count`].filter(Boolean).join(' · '),
        }),
        search,
        h('div', { class: 'vehicles' }, vehicleButtons),
        undoButton(ctx, trip, { wide: true }),
        h('p', { class: 'rc-hint' }, `Tap a guest as they board: they are counted into ${label(selected)}`),
        list),
    };
  }

  return {
    node: h('div', { class: 'screen' },
      pageHead({
        back: backTo,
        eyebrow: `Roll call · started by ${rollCall.startedBy.name}`,
        title: activity.name,
        subtitle: [...where, `${state.expected.length} still expected`].filter(Boolean).join(' · '),
      }),
      search,
      h('div', { class: 'vehicles' }, vehicleButtons, addVehicle),
      undoButton(ctx, trip, { wide: true }),
      list,
      h('p', { class: 'rc-hint' }, 'Long-press a name: At leisure or another tour'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => startAddGuest(ctx, trip, slot, activity) }, '+ Add guest'),
      h('button', { class: 'btn', type: 'button', onclick: endRollCall }, 'End roll call')),
  };
}
