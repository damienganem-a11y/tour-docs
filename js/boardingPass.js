// Boarding pass QR code (v0.146.0, owner's decision, 5 Nov 2026: "one scan per family, into the SPEC now"). Pure: no screen, no network.
//
// Each guest's programme carries, for each tour they are on, a short code that the guest app draws as a QR code (on the colour card, and as
// "Show my pass" on the tour). The staff's roll call scans it: the whole family (the guest's travel party on that tour, in the same colour when the
// tour has colour groups) is checked into the chosen vehicle at once.
//
//   TD1.<trip>.<tour>.<guest>,<guest>...   each part = the first 8 characters of the internal id (no name, nothing secret)
// The staff app looks the people up in its own trip, so the names on the staff's screen always come from the trip itself: a pass passed to someone
// else shows the wrong name, which the staff sees at once.

const short = (id) => String(id ?? '').replace(/-/g, '').slice(0, 8).toLowerCase();

// Who boards with this guest on this tour: their travel party booked on the same tour (and in the same colour, when the colours are validated).
export function passFamily(trip, guest, activityId) {
  const booked = (g) => { const activity = trip.activities.find((a) => a.id === activityId); const b = trip.bookings?.[g.id]?.[activity?.slotId]; return !g.leftAt && b?.kind === 'activity' && b.activityId === activityId; };
  if (!booked(guest)) return [];
  const split = (trip.splits ?? []).find((s) => s.activityId === activityId && s.validatedAt);
  const sameColour = (g) => !split || split.assignments[g.id] === split.assignments[guest.id];
  const party = guest.partyId ?? guest.id;
  return trip.guests.filter((g) => (g.partyId ?? g.id) === party && booked(g) && sameColour(g));
}

export function passCode(trip, guest, activityId) {
  const family = passFamily(trip, guest, activityId);
  if (family.length === 0) return null;
  return `TD1.${short(trip.id)}.${short(activityId)}.${family.map((g) => short(g.id)).join(',')}`;
}

// The text of a scanned QR code -> { trip, tour, guests: [...] } or null when it is not a Tour Docs boarding pass.
export function parsePass(text) {
  const m = String(text ?? '').trim().match(/^TD1\.([0-9a-f]{1,8})\.([0-9a-f]{1,8})\.([0-9a-f]{1,8}(?:,[0-9a-f]{1,8}){0,19})$/i);
  return m ? { trip: m[1].toLowerCase(), tour: m[2].toLowerCase(), guests: m[3].toLowerCase().split(',') } : null;
}

// A scanned pass, read against the trip and the tour of the roll call:
//   { ok: false, why: 'not-a-pass' | 'other-trip' }
//   { ok: true, guests, otherTour, onThisTour, elsewhere }   guests: the people found; elsewhere: those booked on another tour (or At leisure)
export function readPass(trip, activityId, text) {
  const pass = parsePass(text);
  if (!pass) return { ok: false, why: 'not-a-pass' };
  if (pass.trip !== short(trip.id)) return { ok: false, why: 'other-trip' };
  const guests = pass.guests.map((code) => trip.guests.filter((g) => short(g.id) === code)).filter((found) => found.length === 1).map((found) => found[0]).filter((g) => !g.leftAt);
  if (guests.length === 0) return { ok: false, why: 'other-trip' };
  const activity = trip.activities.find((a) => a.id === activityId);
  const onIt = (g) => { const b = trip.bookings?.[g.id]?.[activity.slotId]; return b?.kind === 'activity' && b.activityId === activityId; };
  const passTour = trip.activities.find((a) => short(a.id) === pass.tour) ?? null;
  return { ok: true, guests, passTour, onThisTour: guests.filter(onIt), elsewhere: guests.filter((g) => !onIt(g)) };
}
