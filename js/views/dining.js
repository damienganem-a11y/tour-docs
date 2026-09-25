// Use > Dining (Phase 3 step 2a/2b): pick a destination, then an evening, see who already has a table
// and who doesn't yet, and book one. Separate from Touring (the owner's call, 24 Sep 2026) — most
// destinations have no dine-around, so this only lists destinations that actually have a restaurant.
//
// Two linked views onto the same evening (the owner's call, this session — kept both rather than
// replacing one with the other):
//   Overview   guest-first: tap a guest with no dinner yet -> (travel party prompt) -> pick a
//              restaurant -> pick a seating time -> confirmation screen -> saved. The fastest path
//              for the common case, one travel party wants a table. Its table cards are also
//              tappable, to add more guests to an existing one.
//   By table   restaurant-first (step 2b): pick a restaurant, then a seating, and see every table for
//              it at once — free seats, taken seats, by whom — so guests who want to share a table
//              with people they don't know yet (a solo, a pair) can be registered and progressively
//              combined by watching each table fill up. A specific empty table can be booked
//              directly, even deliberately oversized (becomes a Special request on that table).

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import {
  alphabetical, plain, displayNames, guestPlace, dinnerFit, dinnerCountIn, dinnerTableGrid, dinnerPartyCandidates,
  capacityInfo, bySlotOrder, joinNames, plural,
} from '../rules.js';
import { pageHead } from './chrome.js';
import { notice, choiceRow } from './move.js';
import { undoButton } from './undo.js';
import { DINING_USE_UNDO_SCOPE } from '../journal.js';

// destinationId and slotId come from the address; if missing or wrong we start at the first ones —
// same pattern as destinationPage. restaurantId (and seating) select the "By table" view instead of
// the Overview; both come from the address too, so the phone's back gesture works on this screen
// like every other one.
export function diningPage(ctx, trip, destinationId, slotId, restaurantId, seating) {
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

  const restaurants = trip.restaurants.filter((r) => r.destinationId === destination.id);
  const restaurant = restaurants.find((r) => r.id === restaurantId);

  const modeSwitch = h('nav', { class: 'switch switch--compact', 'aria-label': 'Dining view' },
    h('a', { class: `switch-item${!restaurant ? ' is-active' : ''}`, href: `${base}/${destination.id}/${slot.id}` }, 'Overview'),
    h('a', { class: `switch-item${restaurant ? ' is-active' : ''}`, href: `${base}/${destination.id}/${slot.id}/${restaurants[0].id}` }, 'By table'));

  const head = pageHead({
    eyebrow: 'Dining', title: destination.name,
    action: undoButton(ctx, trip, { scope: DINING_USE_UNDO_SCOPE }),
  });

  if (restaurant) {
    return h('div', {}, destinationStrip, eveningStrip, modeSwitch, head,
      byTablePage(ctx, trip, base, destination, slot, restaurants, restaurant, seating));
  }

  const names = displayNames(trip.guests);
  // A table that lost every guest via the ordinary Move sheet lingers as a "ghost" entity (nothing
  // deletes a dinnerBooking) — filtered out here so this list and the "By table" grid (which already
  // treats a 0-occupant table as free) never visibly disagree about the same table.
  const tables = trip.dinnerBookings.filter((b) => b.slotId === slot.id && dinnerCountIn(trip, b) > 0);
  const noDinnerYet = trip.guests.filter((g) => !g.leftAt && guestPlace(trip, g, slot).kind !== 'dinner');

  return h('div', {}, destinationStrip, eveningStrip, modeSwitch, head,
    tables.map((booking) => tableCard(ctx, trip, names, slot, booking)),
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

// An existing table on the Overview: tap it to add more guests (step 2b) — chips stay read-only
// (they are not the tap target; the card's head is).
function tableCard(ctx, trip, names, slot, booking) {
  const restaurant = trip.restaurants.find((r) => r.id === booking.restaurantId);
  const guests = trip.guests.filter((g) => !g.leftAt && trip.bookings[g.id]?.[booking.slotId]?.bookingId === booking.id);
  const isSpecial = booking.status === 'special-request';

  const head = h('button', {
    class: 'card-head', type: 'button', disabled: Boolean(trip.archivedAt),
    onclick: () => pickForExistingBooking(ctx, trip, slot, restaurant, booking.seating, booking),
  },
    h('div', { class: 'card-row' },
      h('div', { class: 'act-name' }, restaurant?.name ?? 'Restaurant'),
      h('div', { class: `count${isSpecial ? ' count--bad' : ''}` }, isSpecial ? 'Special request' : 'Confirmed')),
    h('div', { class: 'muted' }, booking.seating));

  return h('div', { class: `card${isSpecial ? ' card--warn' : ''}` },
    head,
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

// ---------- Guest-first booking flow (step 2a; unchanged) ----------

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
    body: [...restaurant.seatings].sort().map((seatingTime) => choiceRow({
      title: seatingTime, onclick: () => confirmBooking(ctx, trip, slot, group, restaurant, seatingTime),
    })),
  });
}

function confirmBooking(ctx, trip, slot, group, restaurant, seatingTime) {
  const names = displayNames(trip.guests);
  const who = joinNames(group.map((g) => names.get(g.id)));
  const preview = dinnerFit(trip, restaurant, slot, seatingTime, group.length);
  const fits = preview.status === 'confirmed';

  const confirm = h('button', {
    class: `btn${fits ? '' : ' btn--danger'}`, type: 'button',
    onclick: () => saveBookDinner(ctx, trip, slot, restaurant, seatingTime, group.map((g) => g.id), null, who),
  }, fits ? 'Confirm' : 'Save as special request');

  openSheet({
    eyebrow: fits ? 'Confirm booking' : 'No table free right now', title: `${restaurant.name}, ${seatingTime}`,
    subtitle: `${who} · table for ${plural(group.length, 'guest')}`,
    body: [
      fits ? null : notice(`This does not fit right now — it will be saved as a Special request for the local team to sort out.`),
      confirm,
    ],
    cancelLabel: 'Cancel',
  });
}

// ---------- "By table" grid (step 2b) ----------

function byTablePage(ctx, trip, base, destination, slot, restaurants, restaurant, seatingParam) {
  const restaurantStrip = strip(restaurants.map((r) => ({
    label: r.name, href: `${base}/${destination.id}/${slot.id}/${r.id}`, active: r.id === restaurant.id,
  })), true);

  const seatings = [...restaurant.seatings].sort();
  const seating = seatings.includes(seatingParam) ? seatingParam : seatings[0];
  const seatingStrip = strip(seatings.map((s) => ({
    label: s, href: `${base}/${destination.id}/${slot.id}/${restaurant.id}/${s}`, active: s === seating,
  })), true);

  const names = displayNames(trip.guests);
  const grid = dinnerTableGrid(trip, restaurant, slot, seating);

  const rows = grid.mode === 'strict'
    ? grid.rows.map(({ table, booking, count }) => gridRow(trip, names, slot, {
        title: `Table for ${table.size}`, count, capacity: table.size, booking,
        onclick: () => (booking
          ? pickForExistingBooking(ctx, trip, slot, restaurant, seating, booking)
          : pickForEmptyTable(ctx, trip, slot, restaurant, seating, table)),
      }))
    : [
        ...grid.rows.map(({ booking, count }) => gridRow(trip, names, slot, {
          title: `Table (${plural(count, 'guest')})`, count, capacity: null, booking,
          onclick: () => pickForExistingBooking(ctx, trip, slot, restaurant, seating, booking),
        })),
        h('p', { class: 'muted' }, `${capacityInfo(grid.used, grid.seatsPerSeating).text} seated this seating`),
        h('button', {
          class: 'btn btn--plain', type: 'button', disabled: Boolean(trip.archivedAt),
          onclick: () => pickForNewFlexibleTable(ctx, trip, slot, restaurant, seating),
        }, '+ Start a new table'),
      ];

  return h('div', {}, restaurantStrip, seatingStrip, h('div', {}, rows));
}

function gridRow(trip, names, slot, { title, count, capacity, booking, onclick }) {
  const isSpecial = booking?.status === 'special-request';
  const occupantNames = booking
    ? [...trip.guests.filter((g) => !g.leftAt && trip.bookings[g.id]?.[slot.id]?.bookingId === booking.id)].sort(alphabetical(names)).map((g) => names.get(g.id))
    : [];
  return choiceRow({
    title,
    detail: booking ? joinNames(occupantNames) : 'Empty',
    side: capacity !== null ? capacityInfo(count, capacity).text : (count > 0 ? plural(count, 'guest') : null),
    badge: isSpecial ? { text: 'Special request', bad: true } : booking ? { text: 'Confirmed' } : null,
    disabled: Boolean(trip.archivedAt),
    onclick,
  });
}

// ---------- Shared multi-select guest picker ----------
//
// Every guest with no dinner yet this evening, grouped by travel party for readability, ticked
// individually — unlike the guest-first flow above, this lets unrelated solos and pairs who don't
// know each other yet be combined onto one table in a single action (the owner's call, this
// session). Mirrors rollcall.js's own tick-row checkbox list.

function groupByParty(trip, guests, names) {
  const groups = new Map();
  for (const guest of guests) {
    if (!groups.has(guest.partyId)) groups.set(guest.partyId, []);
    groups.get(guest.partyId).push(guest);
  }
  return [...groups.values()]
    .map((members) => [...members].sort(alphabetical(names)))
    .sort((a, b) => names.get(a[0].id).localeCompare(names.get(b[0].id), 'en', { sensitivity: 'base' }));
}

// ceiling: the capacity to check the running total against (null when there is none to show, e.g. a
// Strict special-request table with no table assigned — any number just becomes a Special request).
// baseUsed: how many are already seated there before this pick (0 for a fresh table).
function guestPicker(trip, slot, { eyebrow, title, subtitle, ceiling, baseUsed, confirmLabel = 'Confirm', onConfirm }) {
  const names = displayNames(trip.guests);
  const guests = trip.guests.filter((g) => !g.leftAt && guestPlace(trip, g, slot).kind !== 'dinner');

  if (guests.length === 0) {
    openSheet({ eyebrow, title, subtitle, body: [h('p', { class: 'empty' }, 'Everybody already has a table this evening.')], cancelLabel: 'Close' });
    return;
  }

  const checked = new Set();
  const status = h('div', { class: 'notice' });
  const partyPrompt = h('div', {});
  const confirmBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: () => onConfirm([...checked]) }, confirmLabel);
  const list = h('div', {});

  const say = () => {
    confirmBtn.disabled = checked.size === 0;
    if (checked.size === 0) { status.textContent = 'Pick at least one guest.'; return; }
    if (ceiling === null) { status.textContent = 'Will be saved as a Special request.'; return; }
    const total = baseUsed + checked.size;
    status.textContent = total > ceiling ? `${capacityInfo(total, ceiling).text} — will be saved as a Special request.` : capacityInfo(total, ceiling).text;
  };

  // Ticking someone with unchecked travel-party members offers to tick them too — the same question
  // the guest-first flow asks up front, brought here since this picker is built for combining several
  // people at once (the owner's feedback, this session). One guest's prompt at a time; replaced or
  // cleared by the next tick, so it never piles up.
  const offerParty = (guest) => {
    const candidates = dinnerPartyCandidates(trip, guest, slot).filter((c) => !checked.has(c.id));
    if (candidates.length === 0) { partyPrompt.replaceChildren(); return; }
    const moverNames = joinNames([...candidates].sort(alphabetical(names)).map((c) => names.get(c.id)));
    partyPrompt.replaceChildren(notice(`${names.get(guest.id)} travels with ${moverNames}`),
      h('div', { class: 'card-actions' },
        h('button', {
          class: 'btn btn--small', type: 'button',
          onclick: () => { for (const c of candidates) checked.add(c.id); partyPrompt.replaceChildren(); fill(); say(); },
        }, `Add ${moverNames} too`),
        h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => partyPrompt.replaceChildren() }, 'No')));
  };

  // The search matches by name only, exactly like the ordinary "Add guest" search elsewhere in the
  // app (move.js's startAddGuest) — never "also show their travel party" (the owner's call: searching
  // "Robert" must not surface Suzanne just because they travel together — offerParty above is the
  // deliberate, opt-in version of that). "Travelling together" only shows when more than one member of
  // a party is still in the FILTERED list, so it naturally disappears once a search narrows things
  // down to one name — no special-casing needed. Ticks are kept in `checked` across searches (not just
  // what's currently on screen), so picking Robert, then searching "Suzanne" and picking her too, adds
  // both when confirmed.
  const fill = () => {
    const words = plain(search.value).split(/\s+/).filter(Boolean);
    const shown = guests.filter((g) => words.every((w) => plain(`${g.first} ${g.last}`).includes(w)));
    const groups = groupByParty(trip, shown, names);
    list.replaceChildren(...(shown.length === 0
      ? [h('p', { class: 'empty' }, 'No guest matches that search.')]
      : groups.flatMap((members) => [
          members.length > 1 ? h('div', { class: 'muted' }, 'Travelling together') : null,
          ...members.map((guest) => {
            const box = h('input', { type: 'checkbox', checked: checked.has(guest.id), 'aria-label': names.get(guest.id) });
            box.addEventListener('change', () => {
              if (box.checked) { checked.add(guest.id); offerParty(guest); } else { checked.delete(guest.id); partyPrompt.replaceChildren(); }
              say();
            });
            return h('label', { class: 'tick-row' }, box, h('span', {}, names.get(guest.id)));
          }),
        ]).filter(Boolean)));
  };

  const search = h('input', {
    class: 'text-input', type: 'search', placeholder: 'Search guests',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search guests', oninput: fill,
  });

  say();
  fill();
  openSheet({ eyebrow, title, subtitle, body: [status, partyPrompt, search, list, confirmBtn], cancelLabel: 'Cancel' });
}

function pickForEmptyTable(ctx, trip, slot, restaurant, seatingTime, table) {
  if (blockedIfArchived(trip)) return;
  guestPicker(trip, slot, {
    eyebrow: restaurant.name, title: `Table for ${table.size}`, subtitle: `${seatingTime} · pick who's sitting here`,
    ceiling: table.size, baseUsed: 0,
    onConfirm: (guestIds) => saveBookDinner(ctx, trip, slot, restaurant, seatingTime, guestIds, table.id, null),
  });
}

function pickForExistingBooking(ctx, trip, slot, restaurant, seatingTime, booking) {
  if (blockedIfArchived(trip)) return;
  const used = dinnerCountIn(trip, booking);
  const ceiling = restaurant.mode === 'strict'
    ? (booking.tableIds.length > 0 ? restaurant.tables.find((t) => t.id === booking.tableIds[0]).size : null)
    : restaurant.maxTableSize;
  guestPicker(trip, slot, {
    eyebrow: restaurant.name, title: 'Add to this table', subtitle: `${seatingTime} · ${plural(used, 'guest')} already here`,
    ceiling, baseUsed: used,
    onConfirm: (guestIds) => saveAddToDinnerTable(ctx, trip, booking, guestIds),
  });
}

function pickForNewFlexibleTable(ctx, trip, slot, restaurant, seatingTime) {
  if (blockedIfArchived(trip)) return;
  guestPicker(trip, slot, {
    eyebrow: restaurant.name, title: 'Start a new table', subtitle: `${seatingTime} · pick who's sitting together`,
    ceiling: restaurant.maxTableSize, baseUsed: 0, confirmLabel: 'Next',
    onConfirm: (guestIds) => confirmBooking(ctx, trip, slot, guestIds.map((id) => trip.guests.find((g) => g.id === id)), restaurant, seatingTime),
  });
}

// ---------- Saving ----------

let saving = false;
async function saveBookDinner(ctx, trip, slot, restaurant, seatingTime, guestIds, tableId, who) {
  if (saving) return;
  saving = true;
  const result = await applyChange(ctx, trip.id, { type: 'book-dinner', slotId: slot.id, restaurantId: restaurant.id, seating: seatingTime, guestIds, tableId });
  saving = false;
  if (result.ok) {
    closeSheet();
    ctx.refresh();
    const tag = result.status === 'special-request' ? ' (Special request)' : '';
    showToast(who ? `${who} booked at ${restaurant.name}, ${seatingTime}${tag}` : `Table booked at ${restaurant.name}, ${seatingTime}${tag}`);
  } else {
    showToast(result.error, true);
  }
}

async function saveAddToDinnerTable(ctx, trip, booking, guestIds) {
  if (saving) return;
  saving = true;
  const result = await applyChange(ctx, trip.id, { type: 'add-to-dinner-table', bookingId: booking.id, guestIds });
  saving = false;
  if (result.ok) {
    closeSheet();
    ctx.refresh();
    showToast(`Added to the table${result.status === 'special-request' ? ' (now a Special request)' : ''}`);
  } else {
    showToast(result.error, true);
  }
}
