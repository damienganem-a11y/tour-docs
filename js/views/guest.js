// Use > "By guest": the searchable list of guests, and one guest's whole trip, half-day after half-day.
// Typical use: sitting with a guest and going through their whole trip; reconfirming names on board
// (the sort switch next to Undo can list everybody by seat instead of alphabetically).
//
// On a guest's own page, a half-day already over is moved down under "Earlier in the trip" (compared
// day by day, in that half-day's OWN destination time zone, so a trip in several time zones is still
// right): the top of the list is always where you would look next.

import { h } from '../dom.js';
import { formatTime, formatWeekdayDate, localDateNow } from '../time.js';
import { alphabetical, bySeat, plain, displayNames, partyLabel, guestPlace, splitPastSlots, bySlotOrder, PART_CODE, tourShort } from '../rules.js';
import { pageHead, destinationMenu, destinationSub } from './chrome.js';
import { startMove } from './move.js';
import { undoButton } from './undo.js';
import { USE_UNDO_SCOPE } from '../journal.js';

export function guestPage(ctx, trip, guestId) {
  const guest = trip.guests.find((g) => g.id === guestId);
  return guest ? guestDetail(ctx, trip, guest) : guestList(ctx, trip);
}

// ---------- The list of guests ----------

// Kept while the app stays open (like other screen toggles, e.g. a folded list elsewhere in Settings).
let sortMode = 'alpha'; // 'alpha' | 'seat'
let seatDestination = 'all'; // in seat order: 'all', or the id of the one destination whose plans are shown for each guest

function sortToggle(ctx) {
  return h('button', {
    class: 'btn btn--plain btn--small', type: 'button',
    'aria-label': 'Switch how the guest list is sorted',
    onclick: () => { sortMode = sortMode === 'alpha' ? 'seat' : 'alpha'; ctx.refresh(); },
  }, sortMode === 'alpha' ? 'Sort: A–Z' : 'Sort: Seat');
}

function guestList(ctx, trip) {
  const names = displayNames(trip.guests);
  // A guest who left the trip (Settings > Guests) is not shown here; bring them back there if needed.
  const comparator = sortMode === 'seat' ? bySeat(names) : alphabetical(names);
  const guests = trip.guests.filter((g) => !g.leftAt).sort(comparator);
  const count = h('p', { class: 'muted count-line' });
  const list = h('ul', { class: 'list' });

  // In seat order, a row reads "2C - Priya S." (the seat first, since that is what you are matching
  // against a boarding list); alphabetically it is just the name, as before.
  const rowTitle = (g) => (sortMode === 'seat' && g.seat ? `${g.seat} – ${names.get(g.id)}` : names.get(g.id));

  // In seat order, you can look at ONE destination (owner's request, 3 Oct 2026: reconfirming a destination from the front of the jet to the back):
  // each row then also lists what that guest has planned there, one short line per half-day ("D12 AM · Angkor"). Tap a line to change that half-day.
  const seatMode = sortMode === 'seat';
  const destination = seatMode && seatDestination !== 'all' ? trip.destinations.find((d) => d.id === seatDestination) : null;
  const slotsHere = destination ? trip.slots.filter((s) => s.destinationId === destination.id).sort(bySlotOrder) : [];
  const linesOf = (g) => slotsHere.map((slot) => {
    const place = guestPlace(trip, g, slot);
    const what = place.kind === 'activity' ? tourShort(place.activity)
      : place.kind === 'leisure' ? 'Leisure'
      : place.kind === 'dinner' ? `Dinner ${place.booking.seating}`
      : place.kind === 'waitlist' ? `Wait: ${tourShort(place.activity)}`
      : '⚠ ?';
    const bad = place.kind === 'blank' || place.kind === 'unknown';
    return h('button', { class: `seat-line${bad ? ' seat-line--bad' : ''}${place.kind === 'leisure' ? ' seat-line--leisure' : ''}`, type: 'button', disabled: Boolean(trip.archivedAt), onclick: () => startMove(ctx, trip, g, slot) },
      h('span', { class: 'seat-when' }, `D${slot.day} ${PART_CODE[slot.half] ?? slot.half}`), h('span', { class: 'seat-what' }, what));
  });

  // Redraws the rows that match what was typed in the search box (the full name is searched too).
  function fill() {
    const words = seatMode ? [] : plain(search.value).split(/\s+/).filter(Boolean);
    const shown = guests.filter((g) => {
      const text = plain(`${g.first} ${g.last}`);
      return words.every((w) => text.includes(w));
    });

    count.textContent = shown.length === guests.length ? `${guests.length} guests` : `${shown.length} of ${guests.length} guests`;
    list.replaceChildren(
      ...(shown.length === 0
        ? [h('li', { class: 'empty' }, 'No guest matches that search.')]
        : shown.map((g) => (destination
            ? h('li', { class: 'seat-card' },
                h('a', { class: 'seat-head', href: `#/trip/${trip.id}/use/guest/${g.id}` }, h('span', { class: 'seat-title' }, rowTitle(g)), h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›')),
                h('div', { class: 'seat-lines' }, linesOf(g)))
            : h('li', {},
                h('a', { class: 'row', href: `#/trip/${trip.id}/use/guest/${g.id}` },
                  h('div', { class: 'row-main' },
                    h('div', { class: 'row-title' }, rowTitle(g)),
                    h('div', { class: 'row-sub' }, partyLabel(trip, g, names))),
                  h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›'))))))
    );
  }

  // In seat order the search box is not needed (a guest is found by seat); a destination chooser takes its place.
  const chooser = destinationMenu([
    { label: 'All destinations', sub: 'One row per guest', active: !destination, onPick: () => { seatDestination = 'all'; ctx.refresh(); } },
    ...trip.destinations.map((d) => ({ label: d.name, sub: `${destinationSub(trip, d)} · each guest's plans there`, active: destination?.id === d.id, onPick: () => { seatDestination = d.id; ctx.refresh(); } })),
  ], { eyebrow: 'By seat', title: 'Which destination?' });

  const search = h('input', {
    class: 'text-input', type: 'search', placeholder: 'Search guests',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search guests',
    oninput: fill,
  });
  fill();

  return h('div', {},
    pageHead({
      eyebrow: 'By guest',
      action: h('div', { class: 'head-actions' }, sortToggle(ctx), undoButton(ctx, trip, { scope: USE_UNDO_SCOPE })),
    }),
    seatMode ? chooser : search, count, list);
}

// ---------- One guest's trip ----------

function guestDetail(ctx, trip, guest) {
  const names = displayNames(trip.guests);
  const { upcoming, earlier } = splitPastSlots(trip, localDateNow);

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/use/guest`, label: 'Guests' },
      eyebrow: 'By guest',
      title: names.get(guest.id),
      subtitle: [guest.seat ? `Seat ${guest.seat}` : null, partyLabel(trip, guest, names), guest.notes].filter(Boolean).join(' · '),
      action: undoButton(ctx, trip, { scope: USE_UNDO_SCOPE }),
    }),
    // Reached by an old link: this guest left the trip (Settings > Guests brings them back).
    guest.leftAt ? h('p', { class: 'notice' }, 'This guest left the trip. Bring them back in Settings › Guests.') : null,
    upcoming.map((slot) => slotRow(ctx, trip, guest, slot)),
    earlier.length > 0
      ? h('div', {}, h('h3', { class: 'section-title' }, 'Earlier in the trip'), earlier.map((slot) => slotRow(ctx, trip, guest, slot)))
      : null
  );
}

// One half-day row: when, what, where. What it says depends on the guest's place in that half-day.
// Tapping it opens the picker to change it.
function slotRow(ctx, trip, guest, slot) {
  const destination = trip.destinations.find((d) => d.id === slot.destinationId);
  const place = guestPlace(trip, guest, slot);
  let title, detail, kind;

  if (place.kind === 'activity') {
    kind = 'activity';
    title = place.activity.name;
    // The start time is shown in the local time of the destination.
    detail = [destination.name, place.activity.startsAt ? formatTime(place.activity.startsAt, destination.timeZone) : '', place.activity.meeting]
      .filter(Boolean).join(' · ');
  } else if (place.kind === 'leisure') {
    kind = 'leisure';
    title = 'At leisure';
    detail = destination.name;
  } else if (place.kind === 'dinner') {
    kind = 'dinner';
    title = place.restaurant.name;
    detail = [destination.name, place.booking.seating, place.booking.status === 'special-request' ? 'Special request' : null]
      .filter(Boolean).join(' · ');
  } else if (place.kind === 'waitlist') {
    kind = 'waitlist';
    title = `Waitlist: ${place.activity.name}`;
    detail = destination.name;
  } else if (place.kind === 'unknown') {
    kind = 'unknown';
    title = '⚠ Unknown activity';
    detail = `"${place.raw}" is not one of the options`;
  } else {
    kind = 'blank';
    title = '⚠ Nothing chosen yet';
    detail = destination.name;
  }

  return h('button', {
    class: `slot slot--${kind}`, type: 'button', disabled: Boolean(trip.archivedAt),
    'aria-label': `Day ${slot.day} ${slot.half}: ${title}.${trip.archivedAt ? '' : ' Tap to change.'}`,
    onclick: () => startMove(ctx, trip, guest, slot),
  },
    h('div', { class: 'slot-when' }, h('div', {}, `Day ${slot.day}`), h('div', {}, slot.half), h('div', { class: 'slot-date' }, formatWeekdayDate(slot.date))),
    h('div', { class: 'slot-what' },
      h('div', { class: 'slot-title' }, title),
      detail ? h('div', { class: 'slot-detail' }, detail) : null),
    h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›'));
}
