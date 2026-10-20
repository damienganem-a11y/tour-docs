// A travel party's whole trip on one page (owner's request, 20 Oct 2026, for river cruises: parties of 8, several generations).
// Day by day, half-day by half-day, the party is shown in GROUPS: "Everyone: Old Lyon Walking Tour", or "Joe and Samantha: Bike Tour · the others: At leisure".
// It only READS bookings; every change still goes through the booking screens (startMove) and the one change function.
//   Tap a group  -> the usual move screen for that group (it asks about the rest of the party that is in the same place).
//   Tap a name   -> move just that person.

import { h } from '../dom.js';
import { formatTime, formatWeekdayDate, localDateNow } from '../time.js';
import { displayNames, alphabetical, guestPlace, samePlace, splitPastSlots, joinNames } from '../rules.js';
import { pageHead } from './chrome.js';
import { startMove } from './move.js';
import { undoButton } from './undo.js';
import { USE_UNDO_SCOPE } from '../journal.js';

// The people of a guest's travel party who are on the trip (the guest included), in alphabetical order.
export function partyMembers(trip, guest) {
  const names = displayNames(trip.guests);
  return trip.guests.filter((g) => !g.leftAt && g.partyId === guest.partyId).sort(alphabetical(names));
}

// Splits the party into groups for one half-day: people in the same place go together. Someone with nothing chosen (or an unknown name) is shown
// with the others in the same case. Returns [{ place, who: [guest] }], the biggest group first.
export function partyGroups(trip, members, slot) {
  const groups = [];
  for (const guest of members) {
    const place = guestPlace(trip, guest, slot);
    const same = groups.find((g) => samePlace(g.place, place) || (g.place.kind === place.kind && (place.kind === 'blank' || (place.kind === 'unknown' && place.raw === g.place.raw))));
    if (same) same.who.push(guest); else groups.push({ place, who: [guest] });
  }
  return groups.sort((a, b) => b.who.length - a.who.length);
}

// What the party is doing, in words: a title and a detail line.
function describe(trip, slot, place) {
  const destination = trip.destinations.find((d) => d.id === slot.destinationId);
  if (place.kind === 'activity') return { title: place.activity.name, detail: [place.activity.startsAt ? formatTime(place.activity.startsAt, destination.timeZone) : '', place.activity.meeting].filter(Boolean).join(' · '), tone: 'ok' };
  if (place.kind === 'leisure') return { title: 'At leisure', detail: '', tone: 'leisure' };
  if (place.kind === 'dinner') return { title: `Dinner at ${place.restaurant.name}`, detail: [place.booking.seating, place.booking.status === 'special-request' ? 'Special request' : null].filter(Boolean).join(' · '), tone: 'ok' };
  if (place.kind === 'waitlist') return { title: `Waiting list: ${place.activity.name}`, detail: 'No place yet', tone: 'bad' };
  if (place.kind === 'unknown') return { title: '⚠ Unknown activity', detail: `"${place.raw}"`, tone: 'bad' };
  return { title: '⚠ Nothing chosen yet', detail: '', tone: 'bad' };
}

export function partyPage(ctx, trip, guestId) {
  const guest = trip.guests.find((g) => g.id === guestId && !g.leftAt);
  const back = { href: `#/trip/${trip.id}/use/guest`, label: 'Guests' };
  if (!guest) return h('div', {}, pageHead({ back, eyebrow: 'Travel party', title: 'Party not found' }), h('p', { class: 'empty' }, 'This guest is not on the trip.'));
  const names = displayNames(trip.guests);
  const members = partyMembers(trip, guest);
  const locked = Boolean(trip.archivedAt);
  const { upcoming, earlier } = splitPastSlots(trip, localDateNow);
  const nameWithAge = (g) => `${names.get(g.id)}${typeof g.age === 'number' ? ` (${g.age})` : ''}`;

  // Who a group is, in words.
  const whoText = (who) => {
    if (members.length > 1 && who.length === members.length) return `Everyone (${members.length})`;
    return joinNames(who.map((g) => names.get(g.id)));
  };

  const card = (slot) => {
    const destination = trip.destinations.find((d) => d.id === slot.destinationId);
    const groups = partyGroups(trip, members, slot);
    return h('div', { class: 'card party-card' },
      h('div', { class: 'party-when' }, `Day ${slot.day} · ${slot.half}`, h('span', { class: 'muted' }, ` · ${destination.name} · ${formatWeekdayDate(slot.date)}`)),
      groups.map((group) => {
        const what = describe(trip, slot, group.place);
        return h('div', { class: `party-group party-group--${what.tone}` },
          h('button', {
            class: 'party-main', type: 'button', disabled: locked,
            'aria-label': `${whoText(group.who)}: ${what.title}.${locked ? '' : ' Tap to change.'}`,
            onclick: () => startMove(ctx, trip, group.who[0], slot),
          },
            h('span', { class: 'party-who' }, whoText(group.who)),
            h('span', { class: 'party-what' }, what.title),
            what.detail ? h('span', { class: 'party-detail' }, what.detail) : null),
          // Tap a single name to move only that person (no question about the rest of the party).
          members.length > 1 && group.who.length > 1
            ? h('div', { class: 'party-chips' }, group.who.map((g) => h('button', { class: 'chip', type: 'button', disabled: locked, onclick: () => startMove(ctx, trip, g, slot, { askParty: false }) }, names.get(g.id))))
            : null);
      }));
  };

  return h('div', {},
    pageHead({
      back, eyebrow: 'Travel party', title: members.length > 1 ? `Party of ${members.length}` : names.get(guest.id),
      subtitle: members.length > 1 ? members.map(nameWithAge).join(' · ') : 'Travelling solo: this is their own trip.',
      action: undoButton(ctx, trip, { scope: USE_UNDO_SCOPE }),
    }),
    members.length > 1 ? h('p', { class: 'muted party-help' }, 'Tap a group to move it, or a name to move just that person.') : null,
    upcoming.map(card),
    earlier.length > 0 ? h('div', {}, h('h3', { class: 'section-title' }, 'Earlier in the trip'), earlier.map(card)) : null);
}

// The parties of the trip, one per row (for the "Sort: Party" list of Guests): [{ id, members }], in the alphabetical order of their first member.
export function partiesOf(trip) {
  const names = displayNames(trip.guests);
  const byParty = new Map();
  for (const g of trip.guests.filter((x) => !x.leftAt)) byParty.set(g.partyId, [...(byParty.get(g.partyId) ?? []), g]);
  return [...byParty.entries()]
    .map(([id, list]) => ({ id, members: list.sort(alphabetical(names)) }))
    .sort((a, b) => alphabetical(names)(a.members[0], b.members[0]));
}

