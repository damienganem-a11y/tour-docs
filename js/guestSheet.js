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
import { guestMenuCard } from './menuCard.js';

// The sheet's own format number: the guest app refuses a sheet it does not understand instead of showing it wrongly.
export const SHEET_VERSION = 1;

// How long a guest's link keeps working after the trip's last day (days). After that the link switches itself off and the server forgets the sheet:
// a guest's first name and programme must not stay readable for ever. The owner can change this per trip later; this is the default.
export const GUEST_LINK_GRACE_DAYS = 7;
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// What a guest reads once their link has expired (the owner can write their own message and web address in Settings > Guest links).
export const DEFAULT_FAREWELL = 'Thank you so much for traveling with us. We hope you got home with memories of a lifetime and cannot wait to be traveling with you again.';
export function farewellOf(trip) {
  const f = trip.guestFarewell ?? {};
  return { text: (f.text || '').trim() || DEFAULT_FAREWELL, website: (f.website || '').trim() };
}
// The last day on which the guest's link still works: the trip's last half-day date + the grace days (null for a trip with no days).
export function guestLinkExpiry(trip) {
  const dates = trip.slots.map((s) => s.date).sort();
  return dates.length ? addDays(dates[dates.length - 1], trip.guestLinkGraceDays ?? GUEST_LINK_GRACE_DAYS) : null;
}

// The tours of the trip the guest can read about (the "Tours" tab). Dinners that still exist as activities ("Dinner: ...") are left out: dinners
// have their own place in the programme. A cancelled tour is left out. Never any guest name or any internal ID.
function toursOf(trip, guest, destinationOf) {
  const list = [];
  for (const slot of [...trip.slots].sort(bySlotOrder)) {
    const destination = destinationOf(slot);
    for (const activity of trip.activities.filter((a) => a.slotId === slot.id && !a.cancelled && !/^dinner/i.test(a.name))) {
      const info = activity.info ?? null;
      list.push({
        _id: activity.id, _slot: slot.id, day: slot.day, date: slot.date, half: slot.half, destination: destination.name, name: activity.name,
        time: activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : null, meeting: activity.meeting || null,
        info: info && {
          duration: info.duration || null, description: info.description || null, difficulty: info.difficulty || null, difficultyNote: info.difficultyNote || null,
          bring: info.bring || null, accessibility: info.accessibility || null, photos: (info.photos ?? []).map((p) => ({ url: p.url, caption: p.caption || '' })),
        },
      });
    }
  }
  return list;
}

// What the guest sees for one half-day. `kind` is one of: activity, leisure, dinner, waitlist, open (nothing confirmed yet).
function partOf(trip, guest, slot, destination, tours, restaurants) {
  const place = guestPlace(trip, guest, slot);
  if (place.kind === 'activity') {
    const a = place.activity;
    return {
      kind: 'activity', name: a.name, cancelled: a.cancelled === true,
      time: a.startsAt ? formatTime(a.startsAt, destination.timeZone) : null, meeting: a.meeting || null,
      tour: tours.findIndex((t) => t._id === a.id), // which entry of the sheet's tours opens when the guest taps it (-1: none)
      // The other tours offered in the same half-day, for the guest's "Other options" button (the operator can switch this off for the trip).
      ...(trip.guestOptions !== false ? { alt: tours.map((t, i) => (t._slot === slot.id && t._id !== a.id ? i : -1)).filter((i) => i >= 0) } : {}),
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
      rest: restaurants.findIndex((r) => r._id === place.restaurant.id), // which entry of the sheet's restaurants opens when tapped (-1: none)
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
  // Restaurants that have a presentation or menu (the dine-around). Prices are left out here unless the leader chose to show them.
  const restaurants = trip.restaurants.filter((r) => r.card).map((r) => ({
    _id: r.id, name: r.name, destination: trip.destinations.find((d) => d.id === r.destinationId)?.name ?? '', card: guestMenuCard(r.card),
  }));
  for (const slot of [...trip.slots].sort(bySlotOrder)) {
    const destination = trip.destinations.find((d) => d.id === slot.destinationId);
    let day = days.find((d) => d.day === slot.day && d.destination === destination.name);
    if (!day) {
      day = { day: slot.day, date: slot.date, destination: destination.name, country: destination.country || '', parts: [] };
      days.push(day);
    }
    day.parts.push({ half: slot.half, ...partOf(trip, guest, slot, destination, tours, restaurants) });
  }
  // The sheet only carries the tours a guest can reach: the ones they are booked on and the other options of the same half-day. (Every tour of the
  // trip would make each sheet several times bigger, for nothing.) The indices in the parts are renumbered to match.
  const needed = new Set();
  for (const part of days.flatMap((d) => d.parts)) {
    if (part.tour >= 0) { needed.add(part.tour); for (const i of part.alt ?? []) needed.add(i); }
  }
  const order = [...needed].sort((a, b) => a - b);
  const renumber = new Map(order.map((old, i) => [old, i]));
  for (const part of days.flatMap((d) => d.parts)) {
    if (part.tour >= 0) { part.tour = renumber.get(part.tour); if (part.alt) part.alt = part.alt.map((i) => renumber.get(i)); } else if ('tour' in part) part.tour = -1;
  }
  return {
    v: SHEET_VERSION,
    trip: trip.name,
    company: trip.branding?.companyName || '',
    accent: trip.branding?.accent || '#1d5c57',
    first: guest.first,
    updatedAt: now,
    days,
    // For the passport: each destination with its time zone and the first and last date there (from its half-days), in trip order.
    destinations: [...trip.destinations].sort((a, b) => a.order - b.order).map((d) => {
      const dates = trip.slots.filter((x) => x.destinationId === d.id).map((x) => x.date).sort();
      return { name: d.name, country: d.country || '', photo: d.photo || '', tz: d.timeZone, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null };
    }).filter((d) => d.firstDate),
    options: trip.guestOptions !== false,
    expiresOn: guestLinkExpiry(trip), // the guest app also stops showing the programme after this day, even with no connection
    farewell: farewellOf(trip),
    restaurants: restaurants.map(({ _id, ...restaurant }) => restaurant),
    tours: order.map((i) => { const { _id, _slot, ...tour } = tours[i]; return tour; }),
  };
}

// The sheets of every guest who has a personal link: [{ token, guestId, active, sheet }]. A switched-off link has no
// content at all (sheet null): the server keeps nothing for it.
export function guestSheetRows(trip, now, today = new Date().toISOString().slice(0, 10)) {
  const rows = [];
  // An archived trip, or one past its link expiry, has every link switched off: the server keeps no sheet for it.
  const expiry = guestLinkExpiry(trip);
  const expired = expiry !== null && today > expiry;
  const archivedEarly = Boolean(trip.archivedAt) && !expired;
  // After the expiry the server keeps NO programme, only the farewell message (no name, no days): the guest still gets a kind goodbye.
  const farewell = (guest) => ({ v: SHEET_VERSION, trip: trip.name, company: trip.branding?.companyName || '', accent: trip.branding?.accent || '#1d5c57', first: '', updatedAt: now, days: [], destinations: [], tours: [], restaurants: [], options: false, expiresOn: expiry, ended: true, farewell: farewellOf(trip) });
  for (const [guestId, link] of Object.entries(trip.guestLinks ?? {})) {
    const guest = trip.guests.find((g) => g.id === guestId);
    if (!guest) continue;
    rows.push({ token: link.token, guestId, active: link.active === true && !guest.leftAt && !archivedEarly, sheet: link.active && !guest.leftAt && !archivedEarly ? (expired ? farewell(guest) : buildGuestSheet(trip, guest, now)) : null });
  }
  return rows;
}
