// Use > "By guest": the searchable list of guests, and one guest's whole trip, half-day after half-day.
// Typical use: sitting with a guest and going through their whole trip.
// (Changing a booking comes in step 3; for now this screen only shows.)

import { h } from '../dom.js';
import { formatTime, formatWeekdayDate } from '../time.js';
import { byName, plain, displayNames, partyLabel, guestPlace } from '../rules.js';
import { pageHead } from './chrome.js';

export function guestPage(ctx, trip, guestId) {
  const guest = trip.guests.find((g) => g.id === guestId);
  return guest ? guestDetail(trip, guest) : guestList(trip);
}

// ---------- The list of guests ----------

function guestList(trip) {
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
    pageHead({ eyebrow: 'By guest', title: 'Guests', subtitle: 'Tap a guest to see their whole trip' }),
    search, count, list);
}

// ---------- One guest's trip ----------

function guestDetail(trip, guest) {
  const names = displayNames(trip.guests);

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/use/guest`, label: 'Guests' },
      eyebrow: 'By guest',
      title: names.get(guest.id),
      subtitle: [partyLabel(trip, guest, names), guest.notes].filter(Boolean).join(' · '),
    }),
    trip.slots.map((slot) => slotRow(trip, guest, slot))
  );
}

// One half-day row: when, what, where. What it says depends on the guest's place in that half-day.
function slotRow(trip, guest, slot) {
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

  return h('div', { class: `slot slot--${kind}` },
    h('div', { class: 'slot-when' }, h('div', {}, `Day ${slot.day}`), h('div', {}, slot.half), h('div', { class: 'slot-date' }, formatWeekdayDate(slot.date))),
    h('div', { class: 'slot-what' },
      h('div', { class: 'slot-title' }, title),
      detail ? h('div', { class: 'slot-detail' }, detail) : null));
}
