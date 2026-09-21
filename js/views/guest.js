// Use > "By guest": the searchable list of guests, and one guest's whole trip, half-day after half-day.
// Typical use: sitting with a guest and going through their whole trip.
// Tap any half-day to change it.

import { h } from '../dom.js';
import { formatTime, formatWeekdayDate } from '../time.js';
import { byName, plain, displayNames, partyLabel, guestPlace } from '../rules.js';
import { pageHead } from './chrome.js';
import { startMove } from './move.js';
import { undoButton } from './undo.js';

export function guestPage(ctx, trip, guestId) {
  const guest = trip.guests.find((g) => g.id === guestId);
  return guest ? guestDetail(ctx, trip, guest) : guestList(ctx, trip);
}

// ---------- The list of guests ----------

function guestList(ctx, trip) {
  const names = displayNames(trip.guests);
  const guests = [...trip.guests].sort(byName);
  const count = h('p', { class: 'muted count-line' });
  const list = h('ul', { class: 'list' });

  // Redraws the rows that match what was typed in the search box (the full name is searched too).
  function fill() {
    const words = plain(search.value).split(/\s+/).filter(Boolean);
    const shown = guests.filter((g) => {
      const text = plain(`${g.first} ${g.last}`);
      return words.every((w) => text.includes(w));
    });

    count.textContent = shown.length === guests.length ? `${guests.length} guests` : `${shown.length} of ${guests.length} guests`;
    list.replaceChildren(
      ...(shown.length === 0
        ? [h('li', { class: 'empty' }, 'No guest matches that search.')]
        : shown.map((g) =>
            h('li', {},
              h('a', { class: 'row', href: `#/trip/${trip.id}/use/guest/${g.id}` },
                h('div', { class: 'row-main' },
                  h('div', { class: 'row-title' }, names.get(g.id)),
                  h('div', { class: 'row-sub' }, partyLabel(trip, g, names))),
                h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›')))))
    );
  }

  const search = h('input', {
    class: 'text-input', type: 'search', placeholder: 'Search guests',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search guests',
    oninput: fill,
  });
  fill();

  return h('div', {},
    pageHead({ eyebrow: 'By guest', title: 'Guests', subtitle: 'Tap a guest to see their whole trip', action: undoButton(ctx, trip) }),
    search, count, list);
}

// ---------- One guest's trip ----------

function guestDetail(ctx, trip, guest) {
  const names = displayNames(trip.guests);

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/use/guest`, label: 'Guests' },
      eyebrow: 'By guest',
      title: names.get(guest.id),
      subtitle: [partyLabel(trip, guest, names), guest.notes].filter(Boolean).join(' · '),
      action: undoButton(ctx, trip),
    }),
    trip.slots.map((slot) => slotRow(ctx, trip, guest, slot))
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
    class: `slot slot--${kind}`, type: 'button',
    'aria-label': `Day ${slot.day} ${slot.half}: ${title}. Tap to change.`,
    onclick: () => startMove(ctx, trip, guest, slot),
  },
    h('div', { class: 'slot-when' }, h('div', {}, `Day ${slot.day}`), h('div', {}, slot.half), h('div', { class: 'slot-date' }, formatWeekdayDate(slot.date))),
    h('div', { class: 'slot-what' },
      h('div', { class: 'slot-title' }, title),
      detail ? h('div', { class: 'slot-detail' }, detail) : null),
    h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›'));
}
