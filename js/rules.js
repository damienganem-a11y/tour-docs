// The rules of the trip: who is where, what counts as full, how names are shown.
//
// These are plain functions: give them the trip data (see loader.js for its shape), they give
// back an answer. They never change anything and never touch the screen, so they are easy to
// test (see tests.html).

// ---------- Small text helpers ----------

// plural(2, 'seat') -> "2 seats"
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ["Simon B."] -> "Simon B."   ["Simon B.", "Anne B."] -> "Simon B. and Anne B."
export const joinNames = (list) => (list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

// The usual order of a day (Morning, Afternoon, Evening), not alphabetical (which would put Afternoon
// before Evening before Morning). Any other half-day name from the data is put after these.
const HALF_ORDER = ['Morning', 'Afternoon', 'Evening'];
export const halfRank = (half) => {
  const i = HALF_ORDER.indexOf(half);
  return i === -1 ? HALF_ORDER.length : i;
};
// Half-days in trip order: by day, then Morning/Afternoon/Evening.
export const bySlotOrder = (a, b) => a.day - b.day || halfRank(a.half) - halfRank(b.half);

// ---------- Names ----------

// Sorting people by last name, then first name (used to break ties).
export const byName = (a, b) => a.last.localeCompare(b.last, 'en') || a.first.localeCompare(b.first, 'en');

// Every list of guests is alphabetical by the name SHOWN on screen ("Helen C." before "Linda D."): what you
// read is what is sorted. Accents and capitals do not matter. Use it like:  guests.sort(alphabetical(names)).
export const alphabetical = (names) => (a, b) =>
  names.get(a.id).localeCompare(names.get(b.id), 'en', { sensitivity: 'base' }) || byName(a, b);

// Lower-case and remove accents so "grunewald" finds "Grünewald" and "sorensen" finds "Sørensen".
export const plain = (text) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/gi, 'o').replace(/æ/gi, 'ae').replace(/ß/g, 'ss').toLowerCase();

// The name shown on screen for every guest: first name + last name initial ("John S.").
// Returns a Map: guest id -> name to show.
//
// If two guests would look the same, letters are added until they differ ("John Sm." / "John St.").
// If they still look the same (identical last names), the full name is shown. The owner can also
// choose any display name by hand in Settings (step 7).
export function displayNames(guests) {
  const names = new Map();

  // Guests who would look the same ("John S.") are put in one group.
  const groups = new Map();
  for (const guest of guests) {
    const key = `${guest.first} ${guest.last.slice(0, 1)}`.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), guest]);
  }

  for (const group of groups.values()) {
    if (group.length === 1) {
      names.set(group[0].id, shortName(group[0], 1));
      continue;
    }

    // Try 2 letters, then 3, then 4... Whoever is alone with their letters is settled.
    let waiting = group;
    const longestLastName = Math.max(...group.map((g) => g.last.length));
    for (let letters = 2; letters <= longestLastName && waiting.length > 0; letters++) {
      const start = (guest) => guest.last.slice(0, letters).toLowerCase();
      const stillSame = [];
      for (const guest of waiting) {
        const shared = waiting.some((other) => other !== guest && start(other) === start(guest));
        if (shared) stillSame.push(guest);
        else names.set(guest.id, shortName(guest, letters));
      }
      waiting = stillSame;
    }
    for (const guest of waiting) names.set(guest.id, `${guest.first} ${guest.last}`); // still the same: full name
  }
  return names;
}

// "John" + "Smith" + 2 letters -> "John Sm."   (no dot when the whole last name is shown)
const shortName = (guest, letters) =>
  `${guest.first} ${guest.last.slice(0, letters)}${letters < guest.last.length ? '.' : ''}`;

// ---------- Travel parties ----------

// A readable line such as "Couple with Priya S." or "Travelling solo".
// We match on the party, never on names: two different couples can both be called Smith.
export function partyLabel(trip, guest, names) {
  const others = trip.guests.filter((g) => !g.leftAt && g.partyId === guest.partyId && g.id !== guest.id);
  if (others.length === 0) return 'Travelling solo';
  const type = trip.parties.find((p) => p.id === guest.partyId)?.type ?? 'Party';
  return `${type} with ${others.map((o) => names.get(o.id)).join(', ')}`;
}

// ---------- Who is where ----------

// Everybody's place in one half-day. Every guest lands in exactly one of three groups:
//   byActivity  Map: activity id -> guests booked on it
//   leisure     guests At leisure
//   attention   guests with no valid booking: [{ guest, reason }]  (nothing chosen yet, or an
//               activity name that matched nothing). The Warnings screen (step 9) lists these too.
export function whoIsWhere(trip, slot) {
  const byActivity = new Map(trip.activities.filter((a) => a.slotId === slot.id).map((a) => [a.id, []]));
  const leisure = [];
  const attention = [];

  // A guest who left the trip (Settings, step 7d) is not shown or counted anywhere day-to-day; their
  // history stays in the Journal, and "Guest left the trip" can always be brought back.
  for (const guest of trip.guests) {
    if (guest.leftAt) continue;
    const booking = trip.bookings[guest.id]?.[slot.id];
    if (booking?.kind === 'activity' && byActivity.has(booking.activityId)) byActivity.get(booking.activityId).push(guest);
    else if (booking?.kind === 'leisure') leisure.push(guest);
    else attention.push({ guest, reason: attentionReason(booking) });
  }
  return { byActivity, leisure, attention };
}

const attentionReason = (booking) =>
  booking?.kind === 'unknown' ? `Unknown activity: "${booking.raw}"` : 'Nothing chosen yet';

// One guest's place in one half-day, ready to show:
//   { kind: 'activity', activity } | { kind: 'leisure' } | { kind: 'blank' } | { kind: 'unknown', raw }
export function guestPlace(trip, guest, slot) {
  const booking = trip.bookings[guest.id]?.[slot.id];
  if (booking?.kind === 'activity') {
    const activity = trip.activities.find((a) => a.id === booking.activityId);
    if (activity) return { kind: 'activity', activity };
  }
  if (booking?.kind === 'leisure') return { kind: 'leisure' };
  if (booking?.kind === 'unknown') return { kind: 'unknown', raw: booking.raw };
  return { kind: 'blank' };
}

// A readable name for a half-day, e.g. "Day 6 · Afternoon · Istanbul".
export function slotLabel(trip, slot) {
  const destination = trip.destinations.find((d) => d.id === slot.destinationId);
  return `Day ${slot.day} · ${slot.half} · ${destination.name}`;
}

// Are two places (from guestPlace) the same? Two guests "At leisure" are in the same place.
export function samePlace(a, b) {
  return (a.kind === 'activity' && b.kind === 'activity' && a.activity.id === b.activity.id)
    || (a.kind === 'leisure' && b.kind === 'leisure');
}

// The other people of a guest's travel party who are in the SAME place as the guest in this half-day.
// These are the ones we offer to move together ("Also move their travel party?"). Someone who is
// already somewhere else is already split from the guest, so we do not ask about them.
export function partyMovers(trip, guest, slot) {
  const here = guestPlace(trip, guest, slot);
  return trip.guests.filter((other) =>
    !other.leftAt && other.partyId === guest.partyId && other.id !== guest.id && samePlace(here, guestPlace(trip, other, slot)));
}

// ---------- Capacity ----------

// How a guest (and the travel party who is with them) fit into a place they might be moved to.
//   movers        party members in the same place: the ones we offer to move together
//   room          free places in the target (Infinity for At leisure and for a tour with no capacity)
//   guestFits     the tapped guest alone fits without forcing
//   everyoneFits  the guest and all of the movers fit without forcing
export function partyPlan(trip, guest, slot, target) {
  const movers = partyMovers(trip, guest, slot);
  const room = target.kind === 'activity' && target.activity.capacity !== null
    ? target.activity.capacity - countIn(trip, target.activity) : Infinity;
  return { movers, room, guestFits: room >= 1, everyoneFits: room >= 1 + movers.length };
}

// How many guests are booked on an activity right now.
export function countIn(trip, activity) {
  let count = 0;
  for (const guest of trip.guests) {
    if (!guest.leftAt && trip.bookings[guest.id]?.[activity.slotId]?.activityId === activity.id) count++;
  }
  return count;
}


// The count shown next to an activity: "6 / 8", "8 / 8 · Full", "10 / 8 · Over by 2",
// or just "6" when the activity has no capacity (it never fills up).
// tone 'bad' means "draw it in the warning colour".
export function capacityInfo(count, capacity) {
  if (capacity === null) return { text: `${count}`, tone: null };
  if (count > capacity) return { text: `${count} / ${capacity} · Over by ${count - capacity}`, tone: 'bad' };
  if (count === capacity) return { text: `${count} / ${capacity} · Full`, tone: 'bad' };
  return { text: `${count} / ${capacity}`, tone: null };
}
