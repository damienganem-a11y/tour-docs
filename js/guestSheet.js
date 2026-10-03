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

// The tours of the trip the guest can read about (the "Tours" tab). Dinners that still exist as activities ("Dinner: ...") are left out: dinners
// have their own place in the programme. A cancelled tour is left out. Never any guest name or any internal ID.
function toursOf(trip, guest, destinationOf) {
  const list = [];
  for (const slot of [...trip.slots].sort(bySlotOrder)) {
    const destination = destinationOf(slot);
    for (const activity of trip.activities.filter((a) => a.slotId === slot.id && !a.cancelled && !/^dinner/i.test(a.name))) {
      const info = activity.info ?? null;
      list.push({
        _id: activity.id, day: slot.day, date: slot.date, half: slot.half, destination: destination.name, name: activity.name,
        time: activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : null, meeting: activity.meeting || null,
        info: info && {
          duration: info.duration || null, description: info.description || null, difficulty: info.difficulty || null, difficultyNote: info.difficultyNote || null,
          bring: info.bring || null, included: info.included || null, photos: (info.photos ?? []).map((p) => ({ url: p.url, caption: p.caption || '' })),
        },
      });
    }
  }
  return list;
}

// What the guest sees for one half-day. `kind` is one of: activity, leisure, dinner, waitlist, open (nothing confirmed yet).
function partOf(trip, guest, slot, destination, tours) {
  const place = guestPlace(trip, guest, slot);
  if (place.kind === 'activity') {
    const a = place.activity;
    return {
      kind: 'activity', name: a.name, cancelled: a.cancelled === true,
      time: a.startsAt ? formatTime(a.startsAt, destination.timeZone) : null, meeting: a.meeting || null,
      tour: tours.findIndex((t) => t._id === a.id), // which entry of the sheet's tours opens when the guest taps it (-1: none)
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
  const tours = toursOf(trip, guest, (slot) => trip.destinations.find((d) => d.id === slot.destinationId));
  for (const slot of [...trip.slots].sort(bySlotOrder)) {
    const destination = trip.destinations.find((d) => d.id === slot.destinationId);
    let day = days.find((d) => d.day === slot.day && d.destination === destination.name);
    if (!day) {
      day = { day: slot.day, date: slot.date, destination: destination.name, parts: [] };
      days.push(day);
    }
    day.parts.push({ half: slot.half, ...partOf(trip, guest, slot, destination, tours) });
  }
  return {
    v: SHEET_VERSION,
    trip: trip.name,
    company: trip.branding?.companyName || '',
    accent: trip.branding?.accent || '#1d5c57',
    first: guest.first,
    updatedAt: now,
    days,
    tours: tours.map(({ _id, ...tour }) => tour),
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
