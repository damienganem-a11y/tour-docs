// Use > Dining (Phase 3 step 2a): pick a destination, then an evening, see who already has a table
// and who doesn't yet, and book one. Separate from Touring (the owner's call, 24 Sep 2026) — most
// destinations have no dine-around, so this only lists destinations that actually have a restaurant.
//
// Booking goes: tap a guest -> (travel party prompt) -> pick a restaurant -> pick a seating time ->
// confirmation screen (shows whether it fits) -> saved, as Confirmed or Special request. Adding to
// or moving an existing table is a later step — the cards below are read-only for now.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { alphabetical, displayNames, guestPlace, dinnerFit, dinnerPartyCandidates, bySlotOrder, joinNames, plural } from '../rules.js';
import { pageHead } from './chrome.js';
import { notice, choiceRow } from './move.js';
import { undoButton } from './undo.js';
import { DINING_USE_UNDO_SCOPE } from '../journal.js';

// destinationId and slotId come from the address; if missing or wrong we start at the first ones —
// same pattern as destinationPage.
export function diningPage(ctx, trip, destinationId, slotId) {
  const withDining = trip.destinations.filter((d) => trip.restaurants.some((r) => r.destinationId === d.id));
  if (withDining.length === 0) {
    return h('div', {},
      pageHead({ eyebrow: 'Dining' }),
      h('p', { class: 'empty' }, 'No restaurants set up yet. Add one in Settings > Dining.'));
  }

  const destination = withDining.find((d) => d.id === destinationId) ?? withDining[0];
  const evenings = trip.slots.filter((s) => s.destinationId === destination.id && s.half === 'Evening').sort(bySlotOrder);
  const base = `#/trip/${trip.id}/use/dining`;

  const destinationStrip = strip(withDining.map((d) => ({
    label: d.name, href: `${base}/${d.id}`, active: d.id === destination.id,
  })));

  if (evenings.length === 0) {
    return h('div', {}, destinationStrip,
      pageHead({ eyebrow: 'Dining', title: destination.name }),
      h('p', { class: 'empty' }, 'This destination has no evenings yet.'));
  }

  const slot = evenings.find((s) => s.id === slotId) ?? evenings[0];
  const eveningStrip = strip(evenings.map((s) => ({
    label: `Day ${s.day}`, href: `${base}/${destination.id}/${s.id}`, active: s === slot,
  })), true);

  const names = displayNames(trip.guests);
  const tables = trip.dinnerBookings.filter((b) => b.slotId === slot.id);
  const noDinnerYet = trip.guests.filter((g) => !g.leftAt && guestPlace(trip, g, slot).kind !== 'dinner');

  return h('div', {},
    destinationStrip, eveningStrip,
    pageHead({
      eyebrow: 'Dining', title: destination.name,
      action: undoButton(ctx, trip, { scope: DINING_USE_UNDO_SCOPE }),
    }),
    tables.map((booking) => tableCard(trip, names, booking)),
    noDinnerYetCard(ctx, trip, slot, noDinnerYet, names));
}

// A row of tappable pills that scrolls sideways — same behavior as destination.js's own strip
// (kept local: small, and each screen's pills mean something slightly different).
function strip(items, small = false) {
  const node = h('nav', { class: `strip${small ? ' strip--small' : ''}` },
    items.map((i) => h('a', { class: `strip-item${i.active ? ' is-active' : ''}`, href: i.href }, i.label)));
  requestAnimationFrame(() => {
    const pill = node.querySelector('.is-active');
    if (pill) node.scrollLeft = pill.offsetLeft - 20;
  });
  return node;
}

// A short label for a guest's current place, for the "No dinner yet" list (so it reads like
// destination.js's attention reasons: what they'd be leaving behind by getting a table).
function placeLabel(place) {
  if (place.kind === 'activity') return place.activity.name;
  if (place.kind === 'leisure') return 'At leisure';
  if (place.kind === 'unknown') return `"${place.raw}"`;
  return 'Nothing chosen yet';
}

// An existing table: read-only in this step (no add/remove/move — that is a later step).
function tableCard(trip, names, booking) {
  const restaurant = trip.restaurants.find((r) => r.id === booking.restaurantId);
  const guests = trip.guests.filter((g) => !g.leftAt && trip.bookings[g.id]?.[booking.slotId]?.bookingId === booking.id);
  const isSpecial = booking.status === 'special-request';

  return h('div', { class: `card${isSpecial ? ' card--warn' : ''}` },
    h('div', { class: 'card-row' },
      h('div', { class: 'act-name' }, restaurant?.name ?? 'Restaurant'),
      h('div', { class: `count${isSpecial ? ' count--bad' : ''}` }, isSpecial ? 'Special request' : 'Confirmed')),
    h('div', { class: 'muted' }, booking.seating),
    h('div', { class: 'chips' },
      [...guests].sort(alphabetical(names)).map((g) => h('span', { class: 'chip' }, names.get(g.id)))));
}

function noDinnerYetCard(ctx, trip, slot, guests, names) {
  return h('div', { class: 'card card--soft' },
    h('div', { class: 'act-name' }, `No dinner yet (${guests.length})`),
    guests.length === 0
      ? h('p', { class: 'muted nobody' }, 'Everybody has a table.')
      : [...guests].sort(alphabetical(names)).map((guest) =>
          h('button', {
            class: 'line line--button', type: 'button', disabled: Boolean(trip.archivedAt),
            onclick: () => startBookDinner(ctx, trip, guest, slot),
          }, h('span', {}, names.get(guest.id)), h('span', {}, placeLabel(guestPlace(trip, guest, slot))))));
}

// ---------- Booking flow ----------

function blockedIfArchived(trip) {
  if (!trip.archivedAt) return false;
  showToast('This trip is archived: read-only. Un-archive it on the Trips screen to make changes.', true);
  return true;
}

function startBookDinner(ctx, trip, guest, slot) {
  if (blockedIfArchived(trip)) return;
  const names = displayNames(trip.guests);
  const candidates = dinnerPartyCandidates(trip, guest, slot);

  if (candidates.length === 0) return pickRestaurant(ctx, trip, slot, [guest]);

  const moverNames = joinNames([...candidates].sort(alphabetical(names)).map((g) => names.get(g.id)));
  openSheet({
    eyebrow: 'Travel party', title: 'Also book their travel party?',
    subtitle: `${names.get(guest.id)} · ${slot.half}, Day ${slot.day}`,
    body: [
      h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); pickRestaurant(ctx, trip, slot, [guest, ...candidates]); } }, `Yes, book ${moverNames} too`),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => { closeSheet(); pickRestaurant(ctx, trip, slot, [guest]); } }, `No, only ${names.get(guest.id)}`),
    ],
    cancelDanger: true,
  });
}

function pickRestaurant(ctx, trip, slot, group) {
  const restaurants = trip.restaurants.filter((r) => r.destinationId === slot.destinationId);
  const names = displayNames(trip.guests);

  openSheet({
    eyebrow: 'Book a table', title: joinNames(group.map((g) => names.get(g.id))),
    subtitle: `${slot.half}, Day ${slot.day} · pick a restaurant`,
    body: restaurants.map((r) => choiceRow({
      title: r.name, detail: r.mode === 'flexible' ? 'Flexible' : 'Strict',
      onclick: () => pickSeating(ctx, trip, slot, group, r),
    })),
  });
}

function pickSeating(ctx, trip, slot, group, restaurant) {
  const names = displayNames(trip.guests);
  openSheet({
    eyebrow: restaurant.name, title: 'Pick a seating time',
    subtitle: joinNames(group.map((g) => names.get(g.id))),
    body: [...restaurant.seatings].sort().map((seating) => choiceRow({
      title: seating, onclick: () => confirmBooking(ctx, trip, slot, group, restaurant, seating),
    })),
  });
}

function confirmBooking(ctx, trip, slot, group, restaurant, seating) {
  const names = displayNames(trip.guests);
  const who = joinNames(group.map((g) => names.get(g.id)));
  const preview = dinnerFit(trip, restaurant, slot, seating, group.length);
  const fits = preview.status === 'confirmed';

  const confirm = h('button', {
    class: `btn${fits ? '' : ' btn--danger'}`, type: 'button',
    onclick: () => saveBooking(ctx, trip, slot, group, restaurant, seating, who),
  }, fits ? 'Confirm' : 'Save as special request');

  openSheet({
    eyebrow: fits ? 'Confirm booking' : 'No table free right now', title: `${restaurant.name}, ${seating}`,
    subtitle: `${who} · table for ${plural(group.length, 'guest')}`,
    body: [
      fits ? null : notice(`This does not fit right now — it will be saved as a Special request for the local team to sort out.`),
      confirm,
    ],
    cancelLabel: 'Cancel',
  });
}

let saving = false;
async function saveBooking(ctx, trip, slot, group, restaurant, seating, who) {
  if (saving) return;
  saving = true;
  const result = await applyChange(ctx, trip.id, {
    type: 'book-dinner', slotId: slot.id, restaurantId: restaurant.id, seating, guestIds: group.map((g) => g.id),
  });
  saving = false;
  if (result.ok) {
    closeSheet();
    ctx.refresh();
    showToast(`${who} booked at ${restaurant.name}, ${seating}${result.status === 'special-request' ? ' (Special request)' : ''}`);
  } else {
    showToast(result.error, true);
  }
}
