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

// "2A" -> { row: 2, letter: 'A' }; anything else (blank, not set) -> null.
const seatParts = (seat) => {
  const m = /^(\d+)\s*([A-Za-z]*)$/.exec(String(seat ?? '').trim());
  return m ? { row: Number(m[1]), letter: m[2].toUpperCase() } : null;
};
// Guests by seat (row, then letter: "1A" before "1C" before "2A"), for reconfirming names on board.
// A guest with no seat set sorts after everybody who has one, alphabetical among themselves.
export const bySeat = (names) => (a, b) => {
  const sa = seatParts(a.seat);
  const sb = seatParts(b.seat);
  if (sa && sb) return sa.row - sb.row || sa.letter.localeCompare(sb.letter, 'en');
  if (sa) return -1;
  if (sb) return 1;
  return alphabetical(names)(a, b);
};

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
  const who = others.map((o) => names.get(o.id)).join(', ');
  // A party made without being given a type (Settings > Travel parties: no type is ever asked) just says
  // who it is with, plainly, instead of showing a made-up word.
  const type = trip.parties.find((p) => p.id === guest.partyId)?.type;
  return type ? `${type} with ${who}` : `Travelling with ${who}`;
}

// ---------- Who is where ----------

// Everybody's place in one half-day. Every guest lands in exactly one of three groups:
//   byActivity  Map: activity id -> guests booked on it
//   leisure     guests At leisure
//   attention   guests with no Touring booking: [{ guest, reason }]  (nothing chosen yet, an activity
//               name that matched nothing, OR a dinner booking — Touring itself has nothing to show
//               for them, but they are NOT a problem, unlike the other two: tripWarnings below skips
//               them, and they stay in this array rather than a bucket of their own so nobody
//               reading `attention`'s length (Touring's own card, every export's headcount) silently
//               undercounts guests once dining exists.
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
    else attention.push({ guest, reason: attentionReason(trip, booking) });
  }
  return { byActivity, leisure, attention };
}

function attentionReason(trip, booking) {
  if (booking?.kind === 'unknown') return `Unknown activity: "${booking.raw}"`;
  if (booking?.kind === 'dinner') {
    const dinnerBooking = trip.dinnerBookings.find((b) => b.id === booking.bookingId);
    const restaurant = dinnerBooking && trip.restaurants.find((r) => r.id === dinnerBooking.restaurantId);
    return restaurant ? `Dining: ${restaurant.name}, ${dinnerBooking.seating}` : 'Dining';
  }
  return 'Nothing chosen yet';
}

// One guest's place in one half-day, ready to show:
//   { kind: 'activity', activity } | { kind: 'leisure' } | { kind: 'dinner', booking, restaurant }
//   | { kind: 'blank' } | { kind: 'unknown', raw }
export function guestPlace(trip, guest, slot) {
  const booking = trip.bookings[guest.id]?.[slot.id];
  if (booking?.kind === 'activity') {
    const activity = trip.activities.find((a) => a.id === booking.activityId);
    if (activity) return { kind: 'activity', activity };
  }
  if (booking?.kind === 'leisure') return { kind: 'leisure' };
  if (booking?.kind === 'dinner') {
    const dinnerBooking = trip.dinnerBookings.find((b) => b.id === booking.bookingId);
    const restaurant = dinnerBooking && trip.restaurants.find((r) => r.id === dinnerBooking.restaurantId);
    if (dinnerBooking && restaurant) return { kind: 'dinner', booking: dinnerBooking, restaurant };
  }
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
    || (a.kind === 'leisure' && b.kind === 'leisure')
    || (a.kind === 'dinner' && b.kind === 'dinner' && a.booking.id === b.booking.id);
}

// The other people of a guest's travel party who are in the SAME place as the guest in this half-day.
// These are the ones we offer to move together ("Also move their travel party?"). Someone who is
// already somewhere else is already split from the guest, so we do not ask about them.
export function partyMovers(trip, guest, slot) {
  const here = guestPlace(trip, guest, slot);
  return trip.guests.filter((other) =>
    !other.leftAt && other.partyId === guest.partyId && other.id !== guest.id && samePlace(here, guestPlace(trip, other, slot)));
}

// Splits a trip's half-days into "still to come" and "earlier in the trip" (a whole calendar day already
// over — not the half-day itself), each keeping the trip's own order. Compared day by day in EACH
// half-day's own destination time zone, since a trip spanning time zones has no single "today".
// `today(timeZone)` returns today's date ("2027-01-12") in that zone — pass localDateNow (time.js) for the
// real, current split; tests pass a fixed function so the result never depends on when they happen to run.
export function splitPastSlots(trip, today) {
  const upcoming = [];
  const earlier = [];
  for (const slot of trip.slots) {
    const destination = trip.destinations.find((d) => d.id === slot.destinationId);
    (slot.date < today(destination.timeZone) ? earlier : upcoming).push(slot);
  }
  return { upcoming, earlier };
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
  if (capacity === null) return { text: `${count} / ∞`, tone: null };
  if (count > capacity) return { text: `${count} / ${capacity} · Over by ${count - capacity}`, tone: 'bad' };
  if (count === capacity) return { text: `${count} / ${capacity} · Full`, tone: 'bad' };
  return { text: `${count} / ${capacity}`, tone: null };
}

// ---------- Dining (Phase 3 step 2a/2b) ----------

// How many guests are currently on a dinner table, right now — derived the same way countIn works
// for an activity (never cached on the booking itself), so a table someone left later frees back up.
export function dinnerCountIn(trip, dinnerBooking) {
  let count = 0;
  for (const guest of trip.guests) {
    if (!guest.leftAt && trip.bookings[guest.id]?.[dinnerBooking.slotId]?.bookingId === dinnerBooking.id) count++;
  }
  return count;
}

// The table ids currently occupied by a live booking at this restaurant/slot/seating. Shared by
// dinnerFit, dinnerTableGrid, and book-dinner's own-table validation (changes.js), instead of three
// copies that could drift apart.
export function dinnerUsedTableIds(trip, restaurant, slot, seating) {
  return new Set(trip.dinnerBookings
    .filter((b) => b.restaurantId === restaurant.id && b.slotId === slot.id && b.seating === seating && dinnerCountIn(trip, b) > 0)
    .flatMap((b) => b.tableIds));
}

// Would a group of `guestCount` guests fit at this restaurant, this evening, this seating? Returns
// { status: 'confirmed' | 'special-request', tableIds }. Never a refusal — a group that fits nowhere
// is still bookable, just flagged for the local team (the owner's choice, 24 Sep 2026: "flexible with
// a waitlist"). Deliberately simple rules (ROADMAP.md: "fixed rules, not AI"): Strict mode fits on
// exactly one free table, or becomes a Special request — no table-joining (removed 24 Sep 2026: not
// always clear in practice which restaurants allow it, or up to how many people, so it is simpler to
// drop it everywhere than to keep a rule nobody can rely on).
export function dinnerFit(trip, restaurant, slot, seating, guestCount) {
  if (restaurant.mode === 'flexible') {
    const bookingsHere = trip.dinnerBookings.filter((b) =>
      b.restaurantId === restaurant.id && b.slotId === slot.id && b.seating === seating && dinnerCountIn(trip, b) > 0);
    const used = bookingsHere.reduce((sum, b) => sum + dinnerCountIn(trip, b), 0);
    const fits = used + guestCount <= restaurant.seatsPerSeating && guestCount <= restaurant.maxTableSize;
    return { status: fits ? 'confirmed' : 'special-request', tableIds: [] };
  }

  const usedTableIds = dinnerUsedTableIds(trip, restaurant, slot, seating);
  const free = restaurant.tables.filter((t) => !usedTableIds.has(t.id)).sort((a, b) => a.size - b.size);
  const single = free.find((t) => t.size >= guestCount);
  return single ? { status: 'confirmed', tableIds: [single.id] } : { status: 'special-request', tableIds: [] };
}

// Would `addCount` more guests still fit on a table that ALREADY has a booking (Phase 3 step 2b's
// "add to an existing table") — not a fresh search, the table/group is already decided; this only
// asks whether it still fits once more guests join it. The status is always recomputed fresh from
// the new total (never "accumulated"), the same principle as dinnerCountIn itself never caching.
export function dinnerAddFit(trip, restaurant, booking, addCount) {
  const newTotal = dinnerCountIn(trip, booking) + addCount;
  if (restaurant.mode === 'flexible') {
    const usedByOthers = trip.dinnerBookings
      .filter((b) => b.id !== booking.id && b.restaurantId === restaurant.id && b.slotId === booking.slotId && b.seating === booking.seating && dinnerCountIn(trip, b) > 0)
      .reduce((sum, b) => sum + dinnerCountIn(trip, b), 0);
    const fits = usedByOthers + newTotal <= restaurant.seatsPerSeating && newTotal <= restaurant.maxTableSize;
    return { status: fits ? 'confirmed' : 'special-request' };
  }
  if (booking.tableIds.length === 0) return { status: 'special-request' }; // already an unfilled special request: stays one
  const capacity = restaurant.tables.find((t) => t.id === booking.tableIds[0]).size;
  return { status: newTotal <= capacity ? 'confirmed' : 'special-request' };
}

// Everything to draw the "By table" grid (Phase 3 step 2b) for one restaurant + seating.
//   Strict: one row per physical table, even empty ones, so the owner can start a fresh table on a
//   specific one they pick, or add to one that already has a booking.
//   Flexible: one row per live booking (there are no fixed physical tables to enumerate), plus the
//   seating's running total — the UI always offers "start a new table" regardless of the total, never
//   gated on room (matches dinnerFit's own "never refuse, only flag" rule).
export function dinnerTableGrid(trip, restaurant, slot, seating) {
  if (restaurant.mode === 'flexible') {
    const bookings = trip.dinnerBookings.filter((b) =>
      b.restaurantId === restaurant.id && b.slotId === slot.id && b.seating === seating && dinnerCountIn(trip, b) > 0);
    const used = bookings.reduce((sum, b) => sum + dinnerCountIn(trip, b), 0);
    return { mode: 'flexible', used, seatsPerSeating: restaurant.seatsPerSeating, rows: bookings.map((b) => ({ booking: b, count: dinnerCountIn(trip, b) })) };
  }
  const rows = restaurant.tables.map((table) => {
    const booking = trip.dinnerBookings.find((b) =>
      b.restaurantId === restaurant.id && b.slotId === slot.id && b.seating === seating && b.tableIds.includes(table.id) && dinnerCountIn(trip, b) > 0);
    return { table, booking: booking ?? null, count: booking ? dinnerCountIn(trip, booking) : 0 };
  });
  return { mode: 'strict', rows };
}

// The guest's travel party members who are not yet booked for dinner this evening — offered as
// "also book their table?" candidates. Not partyMovers: that answers "who's already co-located",
// which makes no sense before the table exists; this answers "who else might join it".
export function dinnerPartyCandidates(trip, guest, slot) {
  return trip.guests.filter((other) =>
    !other.leftAt && other.partyId === guest.partyId && other.id !== guest.id
    && guestPlace(trip, other, slot).kind !== 'dinner');
}

// ---------- Warnings (SPEC.md, "7. Warnings screen") ----------

// Everything across the whole trip that needs a human to look at it:
//   overbooked  an activity with more guests than its own capacity (a forced move allowed it)
//   blank       a guest with nothing chosen yet for a half-day (an empty sign-up in the file)
//   unknown     a guest whose sign-up named an activity that matches nothing (a typo in the file)
// A guest can only ever hold ONE booking for a given half-day (that is what `trip.bookings` stores),
// so "a guest in two places at once" — also named in SPEC.md — cannot happen in this data shape; it
// is not listed here for that reason, not because it was overlooked.
export function tripWarnings(trip) {
  const overbooked = [];
  const blank = [];
  const unknown = [];

  for (const slot of trip.slots) {
    const destination = trip.destinations.find((d) => d.id === slot.destinationId);
    const { attention } = whoIsWhere(trip, slot);
    for (const { guest, reason } of attention) {
      const booking = trip.bookings[guest.id]?.[slot.id];
      if (booking?.kind === 'dinner') continue; // booked for dinner: not a problem, nothing to warn about
      (booking?.kind === 'unknown' ? unknown : blank).push({ guest, slot, destination, reason });
    }
  }

  for (const activity of trip.activities) {
    if (activity.cancelled || activity.capacity === null) continue;
    const count = countIn(trip, activity);
    if (count > activity.capacity) {
      const slot = trip.slots.find((s) => s.id === activity.slotId);
      const destination = trip.destinations.find((d) => d.id === slot.destinationId);
      overbooked.push({ activity, slot, destination, count });
    }
  }

  return { overbooked, blank, unknown };
}
