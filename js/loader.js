// Turns a trip file (the .json) into the shape the app stores and works with.
//
// What changes on the way in:
//   - Everything gets its own UUID (see ids.js). The codes from the file (G001, S05-2, P08...) are
//     kept as `ref`, only so we can point at them in messages and tests.
//   - Sign-ups in the file hold activity NAMES ("Sintra palaces"). We store the activity's ID
//     instead, so renaming an activity never breaks a booking.
//   - "At leisure" is a status, not an activity: it is stored as { kind: 'leisure' }.
//   - A name that matches nothing (a typo) is kept exactly as typed, as { kind: 'unknown', raw },
//     so the Warnings screen can show it and it can be fixed.
//   - An empty sign-up is simply not stored: "nothing chosen yet".
//   - An activity's start time ("15:00", local) becomes an exact moment (see time.js).
//   - Dietary info stays on the guest. It is never copied anywhere else (journal, exports).
//
// The trip we return looks like this (every `id` is a UUID):
//   trip.destinations  [ { id, ref, order, name, country, timeZone, firstDay, lastDay } ]
//   trip.slots         [ { id, ref, destinationId, day, date, half } ]         one slot = one half-day
//   trip.activities    [ { id, ref, slotId, name, startsAt, meeting, capacity, cancelled } ]
//   trip.parties       [ { id, ref, type } ]                                   travel parties
//   trip.guests        [ { id, ref, first, last, partyId, notes, dietary, leftAt } ]
//   trip.bookings      { guestId: { slotId: { kind: 'activity', activityId } | { kind: 'leisure' } | { kind: 'unknown', raw } } }

import { newId } from './ids.js';
import { isValidTimeZone, localToInstant } from './time.js';
import { bySlotOrder } from './rules.js';

const AT_LEISURE = 'at leisure'; // the words used in the file (compared in lower case)

// Stops with a plain-language message when something is wrong with the file.
function need(condition, message) {
  if (!condition) throw new Error(message);
}

const isText = (value) => typeof value === 'string' && value.trim() !== '';

export function buildTrip(raw) {
  need(raw && typeof raw === 'object' && raw.trip && Array.isArray(raw.destinations) && Array.isArray(raw.guests)
    && Array.isArray(raw.slots) && raw.signups && typeof raw.signups === 'object',
    'This file does not look like a Tour Docs trip (it needs "trip", "destinations", "guests", "slots" and "signups").');
  need(isText(raw.trip.name), 'The trip has no name.');
  need(/^\d{4}-\d{2}-\d{2}$/.test(raw.trip.start ?? ''), 'The trip start date must look like 2027-01-12.');
  need(Number.isInteger(raw.trip.days) && raw.trip.days > 0, 'The trip needs a number of days.');
  need(raw.destinations.length > 0, 'The trip has no destinations.');

  // ---------- Destinations ----------
  const destinations = raw.destinations
    .map((d) => {
      need(isText(d.name), 'A destination has no name.');
      need(isValidTimeZone(d.timezone), `The destination ${d.name} has a time zone the phone does not know: "${d.timezone}". It should look like Europe/Lisbon.`);
      return {
        id: newId(), ref: String(d.index ?? ''), order: d.index ?? 0,
        name: d.name, country: d.country ?? '', timeZone: d.timezone,
        firstDay: d.first_day ?? null, lastDay: d.last_day ?? null,
      };
    })
    .sort((a, b) => a.order - b.order);
  const destinationByName = new Map(destinations.map((d) => [d.name, d]));
  need(destinationByName.size === destinations.length, 'Two destinations have the same name.');

  // ---------- Slots (half-days) and their activities ----------
  const slots = [];
  const activities = [];
  const slotByRef = new Map();
  const optionsBySlot = new Map();

  for (const s of raw.slots) {
    need(isText(s.id), 'A half-day has no id.');
    need(!slotByRef.has(s.id), `The half-day ${s.id} appears twice.`);
    const destination = destinationByName.get(s.dest);
    need(destination, `The half-day ${s.id} is in "${s.dest}", which is not in the destinations list.`);
    need(/^\d{4}-\d{2}-\d{2}$/.test(s.date ?? ''), `The half-day ${s.id} needs a date like 2027-01-12.`);
    need(isText(s.half), `The half-day ${s.id} needs a part of the day (Morning, Afternoon...).`);
    need(Array.isArray(s.options), `The half-day ${s.id} has no list of activities.`);

    const slot = { id: newId(), ref: s.id, destinationId: destination.id, day: s.day, date: s.date, half: s.half };
    slotByRef.set(s.id, slot);
    optionsBySlot.set(slot.id, s.options); // the activities offered in this half-day, as written in the file
    slots.push(slot);
  }
  slots.sort(bySlotOrder);

  const activityByRefName = new Map(); // "slot ref|activity name" -> activity, used for the sign-ups below
  const seenActivityRefs = new Set();
  for (const slot of slots) {
    const destination = destinations.find((d) => d.id === slot.destinationId);
    for (const o of optionsBySlot.get(slot.id)) {
      need(isText(o.id) && isText(o.name), `An activity in half-day ${slot.ref} has no id or no name.`);
      need(!seenActivityRefs.has(o.id), `The activity ${o.id} appears twice.`);
      seenActivityRefs.add(o.id);
      need(!o.start || /^\d{1,2}:\d{2}$/.test(o.start), `The start time of "${o.name}" must look like 15:00.`);

      const activity = {
        id: newId(), ref: o.id, slotId: slot.id, name: o.name.trim(),
        startsAt: o.start ? localToInstant(slot.date, o.start, destination.timeZone) : null,
        meeting: o.meeting ?? '',
        capacity: o.cap === null || o.cap === undefined ? null : Number(o.cap), // no capacity = never full
        cancelled: false,
      };
      activities.push(activity);
      activityByRefName.set(`${slot.ref}|${activity.name}`, activity);
    }
  }

  // ---------- Guests and travel parties ----------
  const parties = [];
  const partyByRef = new Map();
  const guests = [];
  const guestByRef = new Map();

  for (const g of raw.guests) {
    need(isText(g.id) && isText(g.first) && isText(g.last), 'A guest is missing an id, a first name or a last name.');
    need(!guestByRef.has(g.id), `The guest ${g.id} appears twice.`);

    // A guest without a party travels alone: they get a party of their own.
    const partyRef = g.party ?? `solo-${g.id}`;
    if (!partyByRef.has(partyRef)) {
      const party = { id: newId(), ref: partyRef, type: g.ptype ?? 'Solo' };
      partyByRef.set(partyRef, party);
      parties.push(party);
    }
    const guest = {
      id: newId(), ref: g.id, first: g.first.trim(), last: g.last.trim(),
      partyId: partyByRef.get(partyRef).id, notes: g.notes ?? '', dietary: g.dietary ?? '',
      leftAt: null, // set to the exact moment when "Guest left the trip" is used (Settings, step 7d); reversible
    };
    guests.push(guest);
    guestByRef.set(g.id, guest);
  }

  // ---------- Bookings ----------
  for (const guestRef of Object.keys(raw.signups)) {
    need(guestByRef.has(guestRef), `The sign-ups mention ${guestRef}, who is not in the guest list.`);
  }
  const bookings = {};
  for (const guest of guests) {
    const row = raw.signups[guest.ref] ?? {};
    bookings[guest.id] = {};

    for (const slotRef of Object.keys(row)) {
      need(slotByRef.has(slotRef), `The sign-ups of ${guest.ref} mention ${slotRef}, which is not a half-day of this trip.`);
    }
    for (const slot of slots) {
      const value = typeof row[slot.ref] === 'string' ? row[slot.ref].trim() : '';
      if (value === '') continue;                                            // nothing chosen yet

      if (value.toLowerCase() === AT_LEISURE) {
        bookings[guest.id][slot.id] = { kind: 'leisure' };
        continue;
      }
      const activity = activityByRefName.get(`${slot.ref}|${value}`);
      bookings[guest.id][slot.id] = activity
        ? { kind: 'activity', activityId: activity.id }
        : { kind: 'unknown', raw: value };                                   // unknown name, kept as typed
    }
  }

  return {
    formatVersion: 2,
    id: newId(),
    ref: raw.trip.code ?? '',
    name: raw.trip.name.trim(),
    start: raw.trip.start,
    days: raw.trip.days,
    defaultVehicles: raw.trip.default_vehicles ?? 4,
    vehicleLabel: raw.trip.vehicle_label ?? 'V',   // what vehicles are called: V1, V2...
    loadedAt: new Date().toISOString(),
    destinations, slots, activities, parties, guests, bookings,
    rollCalls: [],                                 // one per activity, once its roll call has been started (see rollcall.js)
  };
}
