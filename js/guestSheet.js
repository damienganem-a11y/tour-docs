// The "sheet" of one guest: the small piece of information their personal link shows (Phase 5, the guest app).
//
// WHY A SHEET AND NOT THE TRIP: the trip file holds every guest, their allergies and the team's notes. A guest must never be
// able to read that, so the owner's phone prepares one small sheet per guest, with only what that guest may see, and sends
// only that to the server. The guest app can read nothing else.
//
// What a sheet holds: the trip name, the company's name and colour, the guest's first name, and their programme day by day
// (activity with start time and meeting point, At leisure, or dinner with restaurant, time and their own travel party).
// What it NEVER holds: allergies or dietary text, notes, other guests (except the guest's own travel party, at dinner),
// the journal, capacities, or any ID that points into the trip.
//
// Times are exact moments in the trip, shown here as clock times in the destination's own time zone (CLAUDE.md rule).

import { guestPlace, samePlace, bySlotOrder } from './rules.js';
import { formatTime } from './time.js';

// The sheet's own format number: the guest app refuses a sheet it does not understand instead of showing it wrongly.
export const SHEET_VERSION = 1;

// What the guest sees for one half-day. `kind` is one of: activity, leisure, dinner, waitlist, open (nothing confirmed yet).
function partOf(trip, guest, slot, destination) {
  const place = guestPlace(trip, guest, slot);
  if (place.kind === 'activity') {
    const a = place.activity;
    return {
      kind: 'activity', name: a.name, cancelled: a.cancelled === true,
      time: a.startsAt ? formatTime(a.startsAt, destination.timeZone) : null, meeting: a.meeting || null,
    };
  }
  if (place.kind === 'leisure') return { kind: 'leisure' };
  if (place.kind === 'dinner') {
    // Only the guest's own travel party is named: the other people at a shared table are not.
    const withNames = trip.guests
      .filter((other) => other.id !== guest.id && !other.leftAt && other.partyId === guest.partyId && samePlace(place, guestPlace(trip, other, slot)))
      .map((other) => other.first);
    return {
      kind: 'dinner', restaurant: place.restaurant.name, seating: place.booking.seating,
      confirmed: place.booking.status === 'confirmed', with: withNames,
    };
  }
  if (place.kind === 'waitlist') return { kind: 'waitlist', name: place.activity.name };
  return { kind: 'open' };
}

// Builds the sheet for one guest. `now` is passed in (an ISO moment) so the result is the same for the same trip.
export function buildGuestSheet(trip, guest, now) {
  const days = [];
  for (const slot of [...trip.slots].sort(bySlotOrder)) {
    const destination = trip.destinations.find((d) => d.id === slot.destinationId);
    let day = days.find((d) => d.day === slot.day && d.destination === destination.name);
    if (!day) {
      day = { day: slot.day, date: slot.date, destination: destination.name, parts: [] };
      days.push(day);
    }
    day.parts.push({ half: slot.half, ...partOf(trip, guest, slot, destination) });
  }
  return {
    v: SHEET_VERSION,
    trip: trip.name,
    company: trip.branding?.companyName || '',
    accent: trip.branding?.accent || '#1d5c57',
    first: guest.first,
    updatedAt: now,
    days,
  };
}

// The sheets of every guest who has a personal link: [{ token, guestId, active, sheet }]. A switched-off link has no
// content at all (sheet null): the server keeps nothing for it.
export function guestSheetRows(trip, now) {
  const rows = [];
  for (const [guestId, link] of Object.entries(trip.guestLinks ?? {})) {
    const guest = trip.guests.find((g) => g.id === guestId);
    if (!guest) continue;
    rows.push({ token: link.token, guestId, active: link.active === true && !guest.leftAt, sheet: link.active && !guest.leftAt ? buildGuestSheet(trip, guest, now) : null });
  }
  return rows;
}
