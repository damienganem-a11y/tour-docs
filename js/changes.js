// THE ONE PLACE where a trip's bookings get changed.
//
// Every change goes through applyChange() below, no matter where it comes from (a tap in the app
// today; a colleague's request, WhatsApp or a guest tomorrow; End roll call in step 6). That
// guarantees, for every change:
//   1. the rules are checked (right role, activity not full, not cancelled...),
//   2. the trip AND its journal entries are saved together, in one go,
//   3. the journal says who, what, from, to and when (the exact moment).
//
// A change is one of:
//   { type: 'move', guestId, slotId, to: { kind: 'activity', activityId } | { kind: 'leisure' } | { kind: 'dinner', bookingId, label } | { kind: 'waitlist', activityId }, force?, approvedBy? }
//       force: true lets a move go into a full tour (the dispatcher has authority; owner only). The journal
//       then says "forced", with the optional note approvedBy ("Approved by Sam"). A dinner `to` is written
//       by book-dinner below, never asked for directly (there is no "just move to this dinner" picker yet).
//       A `waitlist` target (a full tour's ordered FIFO waitlist, added 25 Sep 2026) never forces and
//       never counts against capacity — joining costs no seat, so it is always allowed, like leisure.
//       Promoting the first waitlisted guest, once a seat frees up, is an ordinary move to
//       { kind: 'activity' } (see views/move.js's proposePromotion) — going through the normal
//       force/confirm flow like any other move, not a change of its own.
//   { type: 'cancel-tour', activityId }        everybody on it goes to At leisure, it stays as "Cancelled"
//   { type: 'undo', scope? }                    takes back the last action (like Ctrl+Z); scope narrows
//       "last" to one screen's own kind of actions (see journal.js's lastUndoable) — omit for trip-wide
//   Roll call (see rollcall.js), each one on its own:
//   { type: 'rollcall-start', activityId }
//   { type: 'rollcall-end', activityId, moveGuestIds }       End roll call: those guests go to At leisure ("moved by End roll call")
//   { type: 'rollcall-reopen', activityId }                  Re-open roll call: the guests End roll call moved to At leisure go back on the tour
//   { type: 'checkin', activityId, guestId, vehicleId }      the guest goes into that vehicle (or moves to it)
//   { type: 'checkout', activityId, guestId }                the guest comes out of the vehicle: back on the list
//   { type: 'vehicle-add', activityId }                      the next vehicle number (V5, V6...)
//   { type: 'vehicle-number', activityId, vehicleId, number }
//   (Several 'checkin' changes for the same roll call may be made together: a travel party checked in at once.)
//   Settings (step 7), each on its own:
//   { type: 'edit-destination', destinationId, name, country, timeZone }
//   { type: 'add-activity', slotId, name, meeting, startTime, capacity }     startTime: "HH:MM" or '' for none
//   { type: 'edit-activity', activityId, name, meeting, startTime, capacity }
//   { type: 'replace-destination', destinationId, name, country, timeZone }  a rare fix: the destination becomes a
//       different place. Its tours are cancelled and everybody on them goes to At leisure, in the same one action.
//   { type: 'add-restaurant', destinationId, name, seatings, mode, seatsPerSeating, maxTableSize, tableSizes }
//       Settings only. seatings: array of "HH:MM" strings (at least one). mode: 'flexible'
//       (seatsPerSeating + maxTableSize set) or 'strict' (tableSizes set, the other two null).
//       tableSizes here is the FORM's plain list of numbers (e.g. [4,4,6,8]); doApply turns it into
//       the restaurant's stored `tables: [{id,size}]` (see reconcileTables below) — a specific table
//       needs a stable id once bookings can reference "this exact table" (step 2a). No table-joining
//       (removed in step 2b, 24 Sep 2026: not always clear in practice which restaurants allow it, or
//       up to how many people, so Strict mode always fits on exactly one table or becomes a Special
//       request — never two joined tables).
//   { type: 'edit-restaurant', restaurantId, name, seatings, mode, seatsPerSeating, maxTableSize, tableSizes }
//   { type: 'book-dinner', slotId, restaurantId, seating, guestIds: [id, ...], tableId? }
//       Phase 3 step 2a/2b: always creates a NEW table. tableId (Strict only, step 2b): book directly
//       onto that specific, currently-empty table instead of letting dinnerFit search for one — the
//       "By table" grid's empty-cell tap; can be deliberately oversized (becomes a Special request on
//       that table, not "nowhere"). Never rejected for "no room" — if it does not fit, it is saved
//       anyway as a Special request (see dinnerFit in rules.js). Applied alone, like cancel-tour.
//       Internally this is one 'book-dinner' journal entry (the table itself) plus one 'move' entry per
//       guest (to:{kind:'dinner'}), reusing the ordinary move machinery — Undo, the Journal's
//       guest-name search and per-guest history all come from that for free.
//   { type: 'add-to-dinner-table', bookingId, guestIds: [id, ...] }
//       Phase 3 step 2b: adds guests to an EXISTING table (never creates a new one) — the "By table"
//       grid's occupied-cell tap, and the Dining overview's tappable table cards. Also never rejected:
//       the table's status is recomputed fresh from its new total occupancy (dinnerAddFit in rules.js),
//       which may flip it to or from Special request. Applied alone. Same move()-reuse as book-dinner,
//       plus one 'add-to-dinner-table' entry recording the status change.
//   { type: 'move-dinner-table', bookingId, restaurantId, seating, tableId? }
//       Phase 3 step 2c: moves EVERY current guest of one table to a different restaurant and/or
//       seating, in one action — a table's own "Move table" action. Creates a fresh table at the
//       destination exactly like book-dinner (same optional tableId for a specific empty table);
//       the source table is left alone and simply disappears on its own once it has zero guests
//       (dinnerCountIn, the same "ghost table" rule step 2b already relies on) — nothing deletes it.
//       Never rejected for "no room": dinnerFit decides Confirmed vs. Special request at the
//       destination, excluding the table's own current occupants from that destination's count (so
//       moving within the same restaurant/seating, to a different table, is not counted against
//       itself). Applied alone. Same move()-reuse as book-dinner.
//   Guests and travel parties (step 7c/7d), each on its own:
//   { type: 'edit-guest', guestId, first, last }             the guest's own name (the shown name is worked out from it)
//   { type: 'guest-left', guestId }                          "Guest left the trip": removed from every day-to-day
//       list and count from now on, without touching a single booking. Reversible (guest-return, or Undo).
//   { type: 'guest-return', guestId }                        brings a guest back who had left
//   { type: 'make-solo', guestId }                           the guest gets a brand new travel party of their own
//   { type: 'join-party', guestId, partyId }                the guest leaves their travel party and joins another one
//   { type: 'create-party', guestIds: [id, id, ...] }        at least 2 guests, each leaving their old travel
//       party (if any), form a brand new one together
//   The trip itself (step 9), each on its own:
//   { type: 'archive-trip' }                                 the trip becomes read-only (views, journal, exports
//       still work; bookings and roll call do not, except undoing this or un-archiving)
//   { type: 'unarchive-trip' }                                the trip can be changed again
//   { type: 'delete-trip' }                                   only an archived trip can be deleted; it moves to
//       "Recently deleted" and is purged for good after 30 days
//   { type: 'reinstate-trip' }                                brings a deleted trip back (still archived)
//   { type: 'rename-trip', name }                              the trip's own name (blocked while archived, like any other change)
// applyChange() accepts one change or a list. A list is all-or-nothing: if any one of them is
// not allowed, none are applied. (Moving a couple together is a list of two moves.)
//
// Undo never deletes anything from the journal: it writes new entries saying what was taken back.
// Privacy: journal entries never contain dietary info.

import { newId } from './ids.js';
import { canUser } from './users.js';
import { displayNames, alphabetical, guestPlace, countIn, slotLabel, plural, dinnerFit, dinnerAddFit, dinnerUsedTableIds, dinnerCountIn } from './rules.js';
import { isValidTimeZone, localToInstant } from './time.js';
import { lastUndoable, summarize } from './journal.js';
import { findRollCall, vehicleLabel, defaultVehicles } from './rollcall.js';

// The changes that belong to a roll call. Each one is made on its own (never mixed with others).
const ROLLCALL_TYPES = new Set(['rollcall-start', 'rollcall-end', 'rollcall-reopen', 'checkin', 'checkout', 'vehicle-add', 'vehicle-number']);
// Settings changes (step 7): each is made on its own, like cancel-tour and undo.
const SETTINGS_TYPES = new Set(['edit-destination', 'add-activity', 'edit-activity', 'replace-destination', 'add-restaurant', 'edit-restaurant']);
// Booking a dinner table, or adding to an existing one (Phase 3 step 2a/2b): also made on its own,
// like cancel-tour.
const DINING_BOOKING_TYPES = new Set(['book-dinner', 'add-to-dinner-table', 'move-dinner-table']);
// Guest and travel party changes (step 7c/7d): also each on its own.
const GUEST_TYPES = new Set(['edit-guest', 'guest-left', 'guest-return', 'make-solo', 'join-party', 'create-party']);
// The trip itself (step 9): archive, un-archive, delete, reinstate. Each on its own. Allowed even when
// the trip is archived (see validateChanges below) — that is how these get taken back.
const TRIP_TYPES = new Set(['archive-trip', 'unarchive-trip', 'delete-trip', 'reinstate-trip']);
// The trip's own name. Its own kind: unlike TRIP_TYPES, renaming is blocked while archived, like any
// other change — nothing about the trip changes while it is read-only.
const TRIP_INFO_TYPES = new Set(['rename-trip']);

const fail = (error) => ({ ok: false, error });

// ---------- 1. Checking changes (changes nothing) ----------

// Returns { ok: true } or { ok: false, error: 'plain-language reason' }.
// The screens also use this to grey out choices that would not be allowed.
// journal: the trip's journal entries (only Undo needs them).
export function validateChanges(trip, user, changes, journal = []) {
  if (!canUser(user, 'change')) return fail('You do not have permission to change bookings.');
  if (!trip) return fail('This trip is not on this phone.');
  // Archived trips are read-only, except for undoing and the archive/delete actions themselves (so
  // a trip can be un-archived, or a deleted trip reinstated, without needing to be un-archived first).
  if (trip.archivedAt && changes[0]?.type !== 'undo' && !TRIP_TYPES.has(changes[0]?.type)) {
    return fail('This trip is archived. Un-archive it to change it.');
  }
  if (!Array.isArray(changes) || changes.length === 0) return fail('There is nothing to change.');

  const names = displayNames(trip.guests);
  // Cancelling a tour, undoing and roll call changes are made on their own. The one exception: several
  // check-ins together (a travel party checked into the same vehicle at once).
  const allCheckins = changes.every((c) => c.type === 'checkin');
  if (changes.some((c) => c.type === 'cancel-tour' || c.type === 'undo' || ROLLCALL_TYPES.has(c.type) || SETTINGS_TYPES.has(c.type) || GUEST_TYPES.has(c.type) || TRIP_TYPES.has(c.type) || TRIP_INFO_TYPES.has(c.type) || DINING_BOOKING_TYPES.has(c.type)) && changes.length > 1 && !allCheckins) {
    return fail('Cancelling a tour, undoing, roll call, settings, dining, guest and trip changes are changes of their own.');
  }
  if (changes[0].type === 'undo') return validateUndo(trip, journal, changes[0].scope);
  if (SETTINGS_TYPES.has(changes[0].type)) return validateSettingsChange(trip, changes[0]);
  if (changes[0].type === 'book-dinner') return validateBookDinner(trip, changes[0]);
  if (changes[0].type === 'add-to-dinner-table') return validateAddToDinnerTable(trip, changes[0]);
  if (changes[0].type === 'move-dinner-table') return validateMoveDinnerTable(trip, changes[0]);
  if (GUEST_TYPES.has(changes[0].type)) return validateGuestChange(trip, changes[0]);
  if (TRIP_TYPES.has(changes[0].type)) return validateTripChange(trip, changes[0]);
  if (TRIP_INFO_TYPES.has(changes[0].type)) return validateRenameTrip(changes[0]);
  if (ROLLCALL_TYPES.has(changes[0].type)) {
    if (changes.some((c) => c.activityId !== changes[0].activityId)) return fail('A roll call change concerns one tour at a time.');
    if (new Set(changes.map((c) => c.guestId)).size !== changes.length) return fail('The same guest appears twice in the same change.');
    for (const change of changes) {
      const result = validateRollCall(trip, change);
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  const seen = new Set();     // the same guest cannot be changed twice in the same half-day
  const flows = new Map();    // activityId -> { activity, joining, leaving, forced }, to check capacity below
  const flow = (activity) => {
    if (!flows.has(activity.id)) flows.set(activity.id, { activity, joining: 0, leaving: 0, forced: false });
    return flows.get(activity.id);
  };

  for (const change of changes) {
    if (change.type === 'cancel-tour') {
      const activity = trip.activities.find((a) => a.id === change.activityId);
      if (!activity) return fail('That activity does not exist.');
      if (activity.cancelled) return fail(`"${activity.name}" is already cancelled.`);
      continue;
    }
    if (change.type !== 'move') return fail(`Unknown kind of change: ${change.type}.`);

    const guest = trip.guests.find((g) => g.id === change.guestId);
    const slot = trip.slots.find((s) => s.id === change.slotId);
    if (!guest) return fail('That guest is not in this trip.');
    if (!slot) return fail('That half-day is not in this trip.');
    if (change.force && !canUser(user, 'force')) return fail('You do not have permission to force a move.');

    const key = `${guest.id}|${slot.id}`;
    if (seen.has(key)) return fail(`${names.get(guest.id)} appears twice in the same change.`);
    seen.add(key);

    const here = guestPlace(trip, guest, slot);
    const target = change.to;

    if (target?.kind === 'leisure') {
      if (here.kind === 'leisure') return fail(`${names.get(guest.id)} is already at leisure.`);
    } else if (target?.kind === 'activity') {
      const activity = trip.activities.find((a) => a.id === target.activityId && a.slotId === slot.id);
      if (!activity) return fail('That activity is not offered in this half-day.');
      if (activity.cancelled) return fail(`"${activity.name}" is cancelled.`);
      if (here.kind === 'activity' && here.activity.id === activity.id) {
        return fail(`${names.get(guest.id)} is already in "${activity.name}".`);
      }
      flow(activity).joining++;
      if (change.force) flow(activity).forced = true;
    } else if (target?.kind === 'waitlist') {
      // Joining a tour's waitlist never needs a seat and is never forced: it costs no capacity, so it
      // is always allowed (like leisure), as long as the guest is not already on it or already booked.
      const activity = trip.activities.find((a) => a.id === target.activityId && a.slotId === slot.id);
      if (!activity) return fail('That activity is not offered in this half-day.');
      if (activity.cancelled) return fail(`"${activity.name}" is cancelled.`);
      if (here.kind === 'waitlist' && here.activity.id === activity.id) {
        return fail(`${names.get(guest.id)} is already on the waitlist for "${activity.name}".`);
      }
      if (here.kind === 'activity' && here.activity.id === activity.id) {
        return fail(`${names.get(guest.id)} is already in "${activity.name}".`);
      }
    } else {
      return fail('Choose an activity, At leisure, or the waitlist.');
    }
    if (here.kind === 'activity') flow(here.activity).leaving++;
  }

  // Capacity: for every activity that gains guests, will they all fit?
  // An activity with no capacity never fills up. Guests leaving in the same change free their places.
  // A forced move (dispatcher's decision) may go over capacity.
  for (const { activity, joining, leaving, forced } of flows.values()) {
    if (joining === 0 || activity.capacity === null || forced) continue;

    const now = countIn(trip, activity);
    const room = activity.capacity - (now - leaving);
    if (joining > room) {
      if (room <= 0) return fail(`"${activity.name}" is full (${now} / ${activity.capacity}).`);
      return fail(`Only ${plural(room, 'place')} left in "${activity.name}", but ${joining} would join.`);
    }
  }
  return { ok: true };
}

// Undo is only possible if the trip still looks the way that action left it. (It always does, as the
// last action is the last thing that happened; this check protects against surprises.)
function validateUndo(trip, journal, scope) {
  const target = lastUndoable(journal, scope);
  if (!target) return fail('There is nothing to undo.');
  // An archived trip is read-only, except undoing a trip-level action itself (archive, un-archive,
  // delete, reinstate): that is how an accidental "Archive" or "Delete" gets taken back.
  if (trip.archivedAt && !target.entries.every((e) => TRIP_TYPES.has(e.type))) {
    return fail('This trip is archived. Un-archive it to change it.');
  }

  for (const entry of target.entries) {
    if (entry.type === 'cancel-tour') {
      const activity = trip.activities.find((a) => a.id === entry.activityId);
      if (!activity || !activity.cancelled) return fail(`"${entry.activityLabel}" is not cancelled anymore, so this cannot be undone.`);
    }
    if (entry.type === 'edit-destination' || entry.type === 'replace-destination') {
      const destination = trip.destinations.find((d) => d.id === entry.destinationId);
      if (!destination) return fail('This action cannot be undone: the destination no longer exists.');
      if (destination.name !== entry.to.name || destination.country !== entry.to.country || destination.timeZone !== entry.to.timeZone) {
        return fail(`This action cannot be undone: "${entry.to.name}" has changed since.`);
      }
    }
    if (entry.type === 'add-activity') {
      const activity = trip.activities.find((a) => a.id === entry.activityId);
      if (!activity) return fail('This action cannot be undone: the activity no longer exists.');
      const onIt = (g) => {
        const booking = trip.bookings[g.id]?.[entry.slotId];
        return (booking?.kind === 'activity' || booking?.kind === 'waitlist') && booking.activityId === entry.activityId;
      };
      if (trip.guests.some(onIt)) {
        return fail(`This action cannot be undone: somebody is already booked or waiting on "${entry.activityLabel}".`);
      }
    }
    if (entry.type === 'edit-activity') {
      const activity = trip.activities.find((a) => a.id === entry.activityId);
      if (!activity) return fail('This action cannot be undone: the activity no longer exists.');
      if (activity.name !== entry.to.name || activity.meeting !== entry.to.meeting || activity.capacity !== entry.to.capacity || activity.startsAt !== entry.to.startsAt) {
        return fail(`This action cannot be undone: "${entry.to.name}" has changed since.`);
      }
    }
    if (entry.type === 'add-restaurant') {
      if (!trip.restaurants.some((r) => r.id === entry.restaurantId)) return fail('This action cannot be undone: the restaurant no longer exists.');
    }
    if (entry.type === 'edit-restaurant') {
      const restaurant = trip.restaurants.find((r) => r.id === entry.restaurantId);
      if (!restaurant) return fail('This action cannot be undone: the restaurant no longer exists.');
      if (restaurant.name !== entry.to.name || JSON.stringify(restaurant.seatings) !== JSON.stringify(entry.to.seatings)
        || restaurant.mode !== entry.to.mode || restaurant.seatsPerSeating !== entry.to.seatsPerSeating
        || restaurant.maxTableSize !== entry.to.maxTableSize || JSON.stringify(restaurant.tables) !== JSON.stringify(entry.to.tables)) {
        return fail(`This action cannot be undone: "${entry.to.name}" has changed since.`);
      }
    }
    if (entry.type === 'book-dinner' || entry.type === 'add-to-dinner-table' || entry.type === 'move-dinner-table') {
      if (!trip.dinnerBookings.some((b) => b.id === entry.bookingId)) return fail('This action cannot be undone: the table no longer exists.');
    }
    if (entry.type === 'edit-guest') {
      const guest = trip.guests.find((g) => g.id === entry.guestId);
      if (!guest) return fail('This action cannot be undone: the guest no longer exists.');
      if (guest.first !== entry.to.first || guest.last !== entry.to.last || (guest.seat ?? null) !== (entry.to.seat ?? null)) {
        return fail(`This action cannot be undone: ${entry.guestName} has changed since.`);
      }
    }
    if (entry.type === 'guest-left') {
      const guest = trip.guests.find((g) => g.id === entry.guestId);
      if (!guest || !guest.leftAt) return fail(`This action cannot be undone: ${entry.guestName} is not marked as having left anymore.`);
    }
    if (entry.type === 'guest-return') {
      const guest = trip.guests.find((g) => g.id === entry.guestId);
      if (!guest || guest.leftAt) return fail(`This action cannot be undone: ${entry.guestName} has left again since.`);
    }
    if (entry.type === 'make-solo' || entry.type === 'join-party') {
      const guest = trip.guests.find((g) => g.id === entry.guestId);
      if (!guest || guest.partyId !== entry.toPartyId) return fail(`This action cannot be undone: ${entry.guestName}'s travel party has changed since.`);
    }
    if (entry.type === 'create-party') {
      if (entry.guestIds.some((id) => trip.guests.find((g) => g.id === id)?.partyId !== entry.toPartyId)) {
        return fail('This action cannot be undone: that travel party has changed since.');
      }
    }
    if (entry.type === 'archive-trip' && !trip.archivedAt) return fail('This action cannot be undone: the trip is not archived anymore.');
    if (entry.type === 'unarchive-trip' && trip.archivedAt) return fail('This action cannot be undone: the trip has been archived again since.');
    if (entry.type === 'delete-trip' && !trip.deletedAt) return fail('This action cannot be undone: the trip is not deleted anymore.');
    if (entry.type === 'reinstate-trip' && trip.deletedAt) return fail('This action cannot be undone: the trip has been deleted again since.');
    if (entry.type === 'rename-trip' && trip.name !== entry.to) return fail('This action cannot be undone: the trip has been renamed again since.');
    if (entry.rollCallId && entry.type !== 'move') {
      const problem = rollCallUndoProblem(trip, entry);
      if (problem) return fail(problem);
      continue;
    }
    if (entry.type !== 'move') continue;

    const guest = trip.guests.find((g) => g.id === entry.guestId);
    const slot = trip.slots.find((s) => s.id === entry.slotId);
    if (!guest || !slot) return fail('This action cannot be undone: the guest or the half-day no longer exists.');
    if (!isPlace(guestPlace(trip, guest, slot), entry.to)) {
      return fail(`This action cannot be undone: ${entry.guestName} is no longer where it left them.`);
    }
    if (entry.from.kind === 'activity' && !trip.activities.some((a) => a.id === entry.from.activityId)) {
      return fail(`This action cannot be undone: "${entry.from.label}" no longer exists.`);
    }
  }
  return { ok: true };
}

// A time typed as "HH:MM", or '' for no time.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isBlank = (text) => String(text ?? '').trim().length === 0;

// Turns a Strict restaurant's typed table sizes (plain numbers, e.g. [4,4,6,8]) into stable table
// entities ({id,size}) a booking can reference. Matches by SIZE, not position, so reordering the
// typed list (e.g. "6, 4" -> "4, 6", same tables) never reassigns ids — only an actual change to the
// bag of sizes (added, removed, resized) does. Each existing table is matched at most once.
function reconcileTables(existingTables, newSizes) {
  const pool = [...(existingTables ?? [])];
  return newSizes.map((size) => {
    const i = pool.findIndex((t) => t.size === size);
    if (i === -1) return { id: newId(), size };
    return pool.splice(i, 1)[0];
  });
}

// Checks one settings change (see the list at the top). None of these touch bookings directly, except
// replace-destination, which also cancels tours (checked here as "the destination exists", the tours
// themselves are handled like normal cancel-tours when the change is applied).
function validateSettingsChange(trip, change) {
  if (change.type === 'add-activity') {
    const slot = trip.slots.find((s) => s.id === change.slotId);
    if (!slot) return fail('That half-day does not exist.');
    if (isBlank(change.name)) return fail('Give the activity a name.');
    if (change.startTime && !TIME_RE.test(change.startTime)) return fail('The time should look like 09:30.');
    if (change.capacity !== null && (!Number.isInteger(change.capacity) || change.capacity < 1)) return fail('Capacity is a whole number of 1 or more, or "no limit".');
    return { ok: true };
  }
  if (change.type === 'edit-activity') {
    const activity = trip.activities.find((a) => a.id === change.activityId);
    if (!activity) return fail('That activity does not exist.');
    if (activity.cancelled) return fail(`"${activity.name}" is cancelled, so it cannot be edited.`);
    if (isBlank(change.name)) return fail('Give the activity a name.');
    if (change.startTime && !TIME_RE.test(change.startTime)) return fail('The time should look like 09:30.');
    if (change.capacity !== null && (!Number.isInteger(change.capacity) || change.capacity < 1)) return fail('Capacity is a whole number of 1 or more, or "no limit".');
    return { ok: true };
  }
  if (change.type === 'add-restaurant') {
    if (!trip.destinations.some((d) => d.id === change.destinationId)) return fail('That destination does not exist.');
    return validateRestaurantFields(change);
  }
  if (change.type === 'edit-restaurant') {
    if (!trip.restaurants.some((r) => r.id === change.restaurantId)) return fail('That restaurant does not exist.');
    return validateRestaurantFields(change);
  }
  // edit-destination and replace-destination
  const destination = trip.destinations.find((d) => d.id === change.destinationId);
  if (!destination) return fail('That destination does not exist.');
  if (isBlank(change.name)) return fail('Give the destination a name.');
  if (!isValidTimeZone(change.timeZone)) return fail(`"${change.timeZone}" is not a time zone the phone knows. It should look like Europe/Lisbon.`);
  return { ok: true };
}

// Checks the fields shared by add-restaurant and edit-restaurant (see the list at the top).
function validateRestaurantFields(change) {
  if (isBlank(change.name)) return fail('Give the restaurant a name.');
  if (!Array.isArray(change.seatings) || change.seatings.length === 0) return fail('Add at least one seating time.');
  for (const time of change.seatings) {
    if (!TIME_RE.test(time)) return fail('Each seating time should look like 19:00.');
  }
  if (new Set(change.seatings).size !== change.seatings.length) return fail('The same seating time appears twice.');

  if (change.mode === 'flexible') {
    if (!Number.isInteger(change.seatsPerSeating) || change.seatsPerSeating < 1) return fail('Seats per seating is a whole number of 1 or more.');
    if (!Number.isInteger(change.maxTableSize) || change.maxTableSize < 1) return fail('Max table size is a whole number of 1 or more.');
    if (change.maxTableSize > change.seatsPerSeating) return fail('Max table size cannot be more than the seats per seating.');
  } else if (change.mode === 'strict') {
    if (!Array.isArray(change.tableSizes) || change.tableSizes.length === 0) return fail('Add at least one table.');
    if (!change.tableSizes.every((n) => Number.isInteger(n) && n >= 1)) return fail('Each table size is a whole number of 1 or more.');
  } else {
    return fail('Choose Flexible or Strict.');
  }
  return { ok: true };
}

// Checks a list of guests for a dinner booking or an add-to-existing-table: each must exist, not have
// left the trip, and not already be booked for dinner this evening. Shared by validateBookDinner and
// validateAddToDinnerTable so the two checks do not drift apart.
function validateDinnerGuestIds(trip, slot, guestIds) {
  if (!Array.isArray(guestIds) || guestIds.length === 0) return fail('Pick at least one guest for the table.');
  if (new Set(guestIds).size !== guestIds.length) return fail('The same guest appears twice.');
  for (const guestId of guestIds) {
    const guest = trip.guests.find((g) => g.id === guestId);
    if (!guest || guest.leftAt) return fail('One of those guests is not on this trip.');
    if (guestPlace(trip, guest, slot).kind === 'dinner') {
      return fail(`${displayNames(trip.guests).get(guestId)} is already booked for dinner this evening.`);
    }
  }
  return { ok: true };
}

// Checks one book-dinner change (see the list at the top). Never refuses for "no room" — that just
// changes the outcome (Confirmed vs. Special request), decided later in doApply by dinnerFit.
function validateBookDinner(trip, change) {
  const slot = trip.slots.find((s) => s.id === change.slotId);
  if (!slot) return fail('That half-day does not exist.');
  const restaurant = trip.restaurants.find((r) => r.id === change.restaurantId);
  if (!restaurant) return fail('That restaurant does not exist.');
  if (restaurant.destinationId !== slot.destinationId) return fail('That restaurant is not in this destination.');
  if (!restaurant.seatings.includes(change.seating)) return fail('That is not one of this restaurant\'s seating times.');

  // A specific table, chosen on the "By table" grid (step 2b) — Strict mode only, and must not
  // already be occupied (an occupied cell is an add-to-dinner-table action instead, not this one).
  if (change.tableId) {
    if (restaurant.mode !== 'strict') return fail('Only a Strict restaurant has specific tables to pick.');
    if (!restaurant.tables.some((t) => t.id === change.tableId)) return fail('That table does not exist.');
    if (dinnerUsedTableIds(trip, restaurant, slot, change.seating).has(change.tableId)) return fail('That table already has a booking.');
  }

  return validateDinnerGuestIds(trip, slot, change.guestIds);
}

// Checks one add-to-dinner-table change (see the list at the top). Same "never refused" rule as
// book-dinner — adding guests always succeeds, it just may flip the table's status.
function validateAddToDinnerTable(trip, change) {
  const booking = trip.dinnerBookings.find((b) => b.id === change.bookingId);
  if (!booking) return fail('That table does not exist.');
  const slot = trip.slots.find((s) => s.id === booking.slotId);
  return validateDinnerGuestIds(trip, slot, change.guestIds);
}

// Checks one move-dinner-table change (see the list at the top): moves every current guest of one
// table to a different restaurant/seating. No guest-id list to check (it is always the table's own
// current occupants, derived live in doApply) — just the table and the destination.
function validateMoveDinnerTable(trip, change) {
  const booking = trip.dinnerBookings.find((b) => b.id === change.bookingId);
  if (!booking) return fail('That table does not exist.');
  if (dinnerCountIn(trip, booking) === 0) return fail('That table has nobody on it to move.');
  const slot = trip.slots.find((s) => s.id === booking.slotId);
  const restaurant = trip.restaurants.find((r) => r.id === change.restaurantId);
  if (!restaurant) return fail('That restaurant does not exist.');
  if (restaurant.destinationId !== slot.destinationId) return fail('That restaurant is not in this destination.');
  if (!restaurant.seatings.includes(change.seating)) return fail('That is not one of this restaurant\'s seating times.');

  // A specific table, chosen on the "By table" grid — Strict mode only, and must not already be
  // occupied BY ANOTHER booking (the table being moved is excluded from its own "used" check, so
  // moving to a different table at its own restaurant/seating is not blocked by itself).
  if (change.tableId) {
    if (restaurant.mode !== 'strict') return fail('Only a Strict restaurant has specific tables to pick.');
    if (!restaurant.tables.some((t) => t.id === change.tableId)) return fail('That table does not exist.');
    if (dinnerUsedTableIds(trip, restaurant, slot, change.seating, booking.id).has(change.tableId)) return fail('That table already has a booking.');
  }
  return { ok: true };
}

// Checks one guest or travel party change (see the list at the top).
function validateGuestChange(trip, change) {
  if (change.type === 'create-party') {
    if (!Array.isArray(change.guestIds) || change.guestIds.length < 2) return fail('Pick at least 2 guests to start a new travel party.');
    if (new Set(change.guestIds).size !== change.guestIds.length) return fail('The same guest appears twice.');
    for (const id of change.guestIds) {
      if (!trip.guests.some((g) => g.id === id)) return fail('One of those guests is not in this trip.');
    }
    return { ok: true };
  }

  const guest = trip.guests.find((g) => g.id === change.guestId);
  if (!guest) return fail('That guest is not in this trip.');

  if (change.type === 'edit-guest') {
    if (isBlank(change.first) || isBlank(change.last)) return fail('A guest needs a first name and a last name.');
    return { ok: true };
  }
  if (change.type === 'guest-left') {
    return guest.leftAt ? fail('That guest has already left the trip.') : { ok: true };
  }
  if (change.type === 'guest-return') {
    return guest.leftAt ? { ok: true } : fail('That guest has not left the trip.');
  }
  if (change.type === 'make-solo') {
    const others = trip.guests.filter((g) => g.partyId === guest.partyId && g.id !== guest.id);
    return others.length === 0 ? fail('That guest is already travelling solo.') : { ok: true };
  }
  // join-party
  const party = trip.parties.find((p) => p.id === change.partyId);
  if (!party) return fail('That travel party does not exist.');
  if (party.id === guest.partyId) return fail('That guest is already in this travel party.');
  return { ok: true };
}

// Checks one trip-level change (archive, un-archive, delete, reinstate). A trip must be archived
// before it can be deleted, and a trip must be deleted before it can be reinstated.
function validateTripChange(trip, change) {
  if (change.type === 'archive-trip') return trip.archivedAt ? fail('This trip is already archived.') : { ok: true };
  if (change.type === 'unarchive-trip') return trip.archivedAt ? { ok: true } : fail('This trip is not archived.');
  if (change.type === 'delete-trip') {
    if (!trip.archivedAt) return fail('Only an archived trip can be deleted.');
    return trip.deletedAt ? fail('This trip is already deleted.') : { ok: true };
  }
  return trip.deletedAt ? { ok: true } : fail('This trip is not deleted.'); // reinstate-trip
}

// Checks a trip rename (see the list at the top).
function validateRenameTrip(change) {
  return isBlank(change.name) ? fail('Give the trip a name.') : { ok: true };
}

// Checks one roll call change (see the list at the top).
function validateRollCall(trip, change) {
  const activity = trip.activities.find((a) => a.id === change.activityId);
  if (!activity) return fail('That activity does not exist.');
  const rollCall = findRollCall(trip, activity.id);

  if (change.type === 'rollcall-start') {
    if (activity.cancelled) return fail(`"${activity.name}" is cancelled.`);
    if (rollCall) return fail(`The roll call for "${activity.name}" has already been started.`);
    return { ok: true };
  }

  if (!rollCall) return fail(`There is no roll call for "${activity.name}".`);
  if (change.type === 'rollcall-reopen') {
    if (!rollCall.endedAt) return fail('This roll call is not ended, so there is nothing to re-open.');
    if (activity.cancelled) return fail(`"${activity.name}" is cancelled.`);
    return { ok: true };
  }
  if (rollCall.endedAt) return fail('This roll call has ended. Re-open it to change it.');
  const vehicle = rollCall.vehicles.find((v) => v.id === change.vehicleId);
  const names = displayNames(trip.guests);
  const guest = trip.guests.find((g) => g.id === change.guestId);
  const bookedHere = (g) => {
    const booking = trip.bookings[g.id]?.[activity.slotId];
    return booking?.kind === 'activity' && booking.activityId === activity.id;
  };

  if (change.type === 'checkin') {
    if (!guest) return fail('That guest is not in this trip.');
    if (!vehicle) return fail('That vehicle does not exist.');
    if (!bookedHere(guest)) return fail(`${names.get(guest.id)} is not booked on "${activity.name}".`);
    if (rollCall.checkins[guest.id] === vehicle.id) return fail(`${names.get(guest.id)} is already in ${vehicleLabel(trip, vehicle)}.`);
  } else if (change.type === 'checkout') {
    if (!guest) return fail('That guest is not in this trip.');
    if (!rollCall.checkins[guest.id]) return fail(`${names.get(guest.id)} is not in a vehicle.`);
  } else if (change.type === 'rollcall-end') {
    // End roll call: the guests who did not show up go to At leisure. Only guests still expected can be moved.
    const ids = change.moveGuestIds;
    if (!Array.isArray(ids)) return fail('Say which guests to move to At leisure.');
    if (new Set(ids).size !== ids.length) return fail('The same guest appears twice in the same change.');
    for (const id of ids) {
      const absent = trip.guests.find((g) => g.id === id);
      if (!absent || !bookedHere(absent)) return fail('One of those guests is not booked on this tour.');
      if (rollCall.checkins[id]) return fail(`${names.get(id)} is checked in, so cannot be moved to At leisure.`);
    }
  } else if (change.type === 'vehicle-add') {
    if (rollCall.vehicles.length >= 30) return fail('That is enough vehicles (30).');
  } else if (change.type === 'vehicle-number') {
    if (!vehicle) return fail('That vehicle does not exist.');
    if (!Number.isInteger(change.number) || change.number < 1 || change.number > 99) return fail('A vehicle number is a whole number from 1 to 99.');
    if (change.number === vehicle.number) return fail(`That vehicle is already ${vehicleLabel(trip, vehicle)}.`);
    const taken = rollCall.vehicles.find((v) => v.number === change.number);
    if (taken) return fail(`${vehicleLabel(trip, taken)} exists already in this roll call. Pick another number.`);
  }
  return { ok: true };
}

// Can this roll call line be taken back? Returns the reason if not. (It always can, as the last action is
// the last thing that happened; this protects against surprises.)
function rollCallUndoProblem(trip, entry) {
  const rollCall = (trip.rollCalls ?? []).find((r) => r.id === entry.rollCallId);
  if (!rollCall) return 'This action cannot be undone: the roll call no longer exists.';
  if (entry.type === 'checkin' && rollCall.checkins[entry.guestId] !== entry.vehicleId) return `This action cannot be undone: ${entry.guestName} is no longer in ${entry.vehicleLabel}.`;
  if (entry.type === 'checkout' && rollCall.checkins[entry.guestId]) return `This action cannot be undone: ${entry.guestName} is in a vehicle again.`;
  if (entry.type === 'rollcall-end' && !rollCall.endedAt) return 'This action cannot be undone: the roll call is not in the state that End roll call left it.';
  if (entry.type === 'rollcall-reopen' && rollCall.endedAt) return 'This action cannot be undone: the roll call is not in the state that Re-open left it.';
  if (entry.type === 'vehicle-add' && !rollCall.vehicles.some((v) => v.id === entry.vehicleId)) return 'This action cannot be undone: that vehicle is gone.';
  if (entry.type === 'vehicle-number' && rollCall.vehicles.find((v) => v.id === entry.vehicleId)?.number !== entry.toNumber) return 'This action cannot be undone: that vehicle has another number now.';
  return null;
}

// Is a guest's place (from guestPlace) the one a journal entry describes ({ kind, activityId, raw })?
function isPlace(place, spec) {
  if (spec.kind === 'activity') return place.kind === 'activity' && place.activity.id === spec.activityId;
  if (spec.kind === 'waitlist') return place.kind === 'waitlist' && place.activity.id === spec.activityId;
  if (spec.kind === 'unknown') return place.kind === 'unknown' && place.raw === spec.raw;
  return place.kind === spec.kind; // 'leisure' or 'blank'
}

// ---------- 2. Making changes ----------

// Changes are handled one at a time, in order, so two quick taps can never trample each other.
let queue = Promise.resolve();

// ctx must provide:
//   ctx.trip(id)                 the current trip
//   ctx.owner                    who is making the change (see users.js)
//   ctx.commit(newTrip, entries) saves the trip AND the journal entries together, then makes the
//                                app use the new trip (returns a promise)
// Returns { ok: true, entries } or { ok: false, error }.
export function applyChange(ctx, tripId, changes) {
  const list = Array.isArray(changes) ? changes : [changes];
  const run = queue.then(() => doApply(ctx, tripId, list));
  queue = run.catch(() => {}); // keep the line moving even if one change throws
  return run;
}

async function doApply(ctx, tripId, changes) {
  const trip = ctx.trip(tripId);
  const journal = ctx.journal(tripId);
  const check = validateChanges(trip, ctx.owner, changes, journal);
  if (!check.ok) return check;

  // Work on a copy. The real trip is only replaced once the copy is safely saved, so a failed
  // save can never leave the screen and the phone disagreeing.
  const next = structuredClone(trip);
  const names = displayNames(trip.guests);
  const batchId = newId();                  // links changes made together (a couple, a cancelled tour)
  const at = new Date().toISOString();      // the exact moment
  const entries = [];

  // A guest or travel party change (step 7c/7d) is not tied to one half-day or destination, unlike a move
  // or a roll call line: the Journal still needs *some* place and time zone to show it by, so it uses the
  // phone's own, local, right now.
  const guestWhere = { slotId: null, slotLabel: null, place: { name: 'local', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } };

  // Every action gets the next number in the trip's own order (`seq`), so the journal keeps its order even
  // when two actions happen in the same millisecond. (Journals from before this had no numbers: they count as 0.)
  const lastSeq = Math.max(trip.changeCount ?? 0, ...journal.map((e) => e.seq ?? 0));
  next.changeCount = lastSeq + 1;

  // Which activities will be over capacity once this change is made (only those make a move "forced").
  const net = new Map(); // activityId -> guests gained (+) or lost (-)
  for (const change of changes) {
    if (change.type !== 'move') continue;
    const before = guestPlace(trip, trip.guests.find((g) => g.id === change.guestId), trip.slots.find((s) => s.id === change.slotId));
    if (before.kind === 'activity') net.set(before.activity.id, (net.get(before.activity.id) ?? 0) - 1);
    if (change.to.kind === 'activity') net.set(change.to.activityId, (net.get(change.to.activityId) ?? 0) + 1);
  }
  const willBeOver = (activityId) => {
    const activity = trip.activities.find((a) => a.id === activityId);
    return activity.capacity !== null && countIn(trip, activity) + (net.get(activityId) ?? 0) > activity.capacity;
  };

  const base = () => ({
    id: newId(), tripId: trip.id, at,
    seq: next.changeCount, n: entries.length, // n = this entry's place inside its action
    who: { id: ctx.owner.id, name: ctx.owner.name, role: ctx.owner.role },
    source: 'app',                          // later: 'colleague request', 'whatsapp'...
    batchId,
  });

  // Undo: take back the last action (of the given scope, if any), and write what was taken back.
  if (changes[0].type === 'undo') {
    const target = lastUndoable(journal, changes[0].scope);
    const summary = summarize(target);
    const [firstEntry] = target.entries;
    entries.push({
      ...base(), type: 'undo', undoesBatchId: target.batchId, undoesSummary: summary,
      rollCallId: firstEntry.rollCallId ?? null, // an undone roll call action stays with its roll call in the Journal
      slotId: firstEntry.slotId, slotLabel: firstEntry.slotLabel, place: firstEntry.place,
    });
    // The lines are taken back in the opposite order (the last thing done is the first thing undone).
    for (const entry of [...target.entries].reverse()) undoEntry(next, entry, base, entries);
    return save(ctx, next, entries, { summary });
  }

  // A "move" of one guest in one half-day. to.kind 'dinner' is written only by book-dinner below
  // (there is no direct "move to this dinner" picker yet) — it never forces, so `forced` stays false.
  // to.kind 'waitlist' also never forces: joining a waitlist costs no seat.
  const move = (guest, slot, to, cause, force = false, approvedBy = null) => {
    const before = guestPlace(trip, guest, slot);
    const forced = force && to.kind === 'activity' && willBeOver(to.activityId);
    next.bookings[guest.id] ??= {};
    next.bookings[guest.id][slot.id] = to.kind === 'leisure' ? { kind: 'leisure' }
      : to.kind === 'dinner' ? { kind: 'dinner', bookingId: to.bookingId }
      : to.kind === 'waitlist' ? { kind: 'waitlist', activityId: to.activityId }
      : { kind: 'activity', activityId: to.activityId };

    // Names are copied in as text, so the journal still reads correctly even if things are renamed later.
    entries.push({
      ...base(), type: 'move', cause,
      forced, approvedBy: forced ? approvedBy : null, // a forced move says who approved it (optional note)
      guestId: guest.id, guestName: names.get(guest.id),
      ...where(trip, slot),
      from: describe(before),
      to: to.kind === 'leisure' ? { kind: 'leisure', label: 'At leisure' }
        : to.kind === 'dinner' ? { kind: 'dinner', bookingId: to.bookingId, label: to.label }
        : to.kind === 'waitlist' ? { kind: 'waitlist', activityId: to.activityId, label: `Waitlist: ${trip.activities.find((a) => a.id === to.activityId).name}` }
        : { kind: 'activity', activityId: to.activityId, label: trip.activities.find((a) => a.id === to.activityId).name },
    });
  };

  // The words and place shared by every line of a roll call action.
  const rollCallAbout = (activity, slot, rollCall) => ({
    rollCallId: rollCall.id, activityId: activity.id, activityLabel: activity.name, ...where(trip, slot),
  });

  // Roll call changes: start it, check a guest in or out, add a vehicle, renumber a vehicle.
  if (ROLLCALL_TYPES.has(changes[0].type)) {
    const activity = trip.activities.find((a) => a.id === changes[0].activityId);
    const slot = trip.slots.find((s) => s.id === activity.slotId);
    const label = (vehicle) => vehicleLabel(next, vehicle);
    const change = changes[0]; // (only check-ins can come in several at once)

    if (change.type === 'rollcall-start') {
      const rollCall = {
        id: newId(), activityId: activity.id, startedAt: at,
        startedBy: { id: ctx.owner.id, name: ctx.owner.name },
        endedAt: null, vehicles: defaultVehicles(trip.defaultVehicles ?? 4), checkins: {}, movedByEnd: [],
      };
      (next.rollCalls ??= []).push(rollCall);
      entries.push({ ...base(), type: 'rollcall-start', ...rollCallAbout(activity, slot, rollCall), vehicles: rollCall.vehicles.map((v) => label(v)) });
      return save(ctx, next, entries, { rollCallId: rollCall.id });
    }

    const rollCall = next.rollCalls.find((r) => r.activityId === activity.id);
    const vehicle = rollCall.vehicles.find((v) => v.id === change.vehicleId);
    const about = rollCallAbout(activity, slot, rollCall);
    const guest = trip.guests.find((g) => g.id === change.guestId);

    if (change.type === 'checkin') {
      const list = rollCall.checkins; // who is in which vehicle
      for (const one of changes) { // one guest, or a whole travel party at once
        const who = trip.guests.find((g) => g.id === one.guestId);
        const into = rollCall.vehicles.find((v) => v.id === one.vehicleId);
        const fromId = list[who.id] ?? null;
        const from = rollCall.vehicles.find((v) => v.id === fromId);
        list[who.id] = into.id;
        entries.push({
          ...base(), type: 'checkin', ...about, guestId: who.id, guestName: names.get(who.id),
          vehicleId: into.id, vehicleLabel: label(into),
          fromVehicleId: fromId, fromVehicleLabel: from ? label(from) : null,
        });
      }
    } else if (change.type === 'checkout') {
      const from = rollCall.vehicles.find((v) => v.id === rollCall.checkins[guest.id]);
      delete rollCall.checkins[guest.id];
      entries.push({ ...base(), type: 'checkout', ...about, guestId: guest.id, guestName: names.get(guest.id), fromVehicleId: from.id, fromVehicleLabel: label(from) });
    } else if (change.type === 'rollcall-end') {
      // End roll call: the guests who did not show up go to At leisure ("moved by End roll call"), and the
      // roll call is closed. The roll call remembers who it moved, so that Re-open roll call can put them back.
      const booked = trip.guests.filter((g) => {
        const booking = trip.bookings[g.id]?.[slot.id];
        return !g.leftAt && booking?.kind === 'activity' && booking.activityId === activity.id;
      });
      const checkedInCount = booked.filter((g) => rollCall.checkins[g.id]).length;
      rollCall.endedAt = at;
      rollCall.endedBy = { id: ctx.owner.id, name: ctx.owner.name };
      rollCall.movedByEnd = [...new Set([...(rollCall.movedByEnd ?? []), ...change.moveGuestIds])];
      entries.push({
        ...base(), type: 'rollcall-end', ...about, movedGuestIds: change.moveGuestIds,
        checkedInCount, movedCount: change.moveGuestIds.length, keptCount: booked.length - checkedInCount - change.moveGuestIds.length,
      });
      for (const id of change.moveGuestIds) move(trip.guests.find((g) => g.id === id), slot, { kind: 'leisure' }, 'end-roll-call');
    } else if (change.type === 'rollcall-reopen') {
      // Re-open roll call: the roll call is open again, with its vehicles and check-ins. Everybody End roll call moved to
      // At leisure, and who is still At leisure, goes back on the tour, as far as there are places (a tour that filled up
      // meanwhile keeps its places: those who do not fit stay At leisure and the journal says so).
      const stillAway = (rollCall.movedByEnd ?? [])
        .map((id) => trip.guests.find((g) => g.id === id))
        .filter((g) => g && guestPlace(trip, g, slot).kind === 'leisure')
        .sort(alphabetical(names));
      const room = activity.capacity === null ? stillAway.length : Math.max(0, activity.capacity - countIn(trip, activity));
      const putBack = stillAway.slice(0, room);
      const leftOut = stillAway.slice(room);
      entries.push({
        ...base(), type: 'rollcall-reopen', ...about,
        previousEndedAt: rollCall.endedAt, previousEndedBy: rollCall.endedBy ?? null, previousMovedByEnd: [...(rollCall.movedByEnd ?? [])], // so Undo can close it again exactly as it was
        putBackIds: putBack.map((g) => g.id), leftOutNames: leftOut.map((g) => names.get(g.id)),
      });
      rollCall.endedAt = null;
      delete rollCall.endedBy;
      rollCall.movedByEnd = (rollCall.movedByEnd ?? []).filter((id) => !putBack.some((g) => g.id === id));
      for (const guest of putBack) move(guest, slot, { kind: 'activity', activityId: activity.id }, 'reopen-roll-call');
    } else if (change.type === 'vehicle-add') {
      const added = { id: newId(), number: Math.max(0, ...rollCall.vehicles.map((v) => v.number)) + 1 };
      rollCall.vehicles.push(added);
      entries.push({ ...base(), type: 'vehicle-add', ...about, vehicleId: added.id, vehicleLabel: label(added) });
    } else {
      const fromLabel = label(vehicle);
      const fromNumber = vehicle.number;
      vehicle.number = change.number;
      entries.push({ ...base(), type: 'vehicle-number', ...about, vehicleId: vehicle.id, fromNumber, toNumber: change.number, fromLabel, toLabel: label(vehicle) });
    }
    return save(ctx, next, entries, {});
  }

  // Settings changes (step 7): destinations and activities. Each is made on its own.
  if (SETTINGS_TYPES.has(changes[0].type)) {
    const change = changes[0];

    if (change.type === 'add-activity' || change.type === 'edit-activity') {
      const slot = trip.slots.find((s) => s.id === (change.type === 'add-activity' ? change.slotId : trip.activities.find((a) => a.id === change.activityId).slotId));
      const destination = trip.destinations.find((d) => d.id === slot.destinationId);
      const name = change.name.trim();
      const meeting = String(change.meeting ?? '').trim() || null;
      const startsAt = change.startTime ? localToInstant(slot.date, change.startTime, destination.timeZone) : null;

      if (change.type === 'add-activity') {
        const activity = { id: newId(), slotId: slot.id, name, meeting, startsAt, capacity: change.capacity, cancelled: false };
        next.activities.push(activity);
        entries.push({ ...base(), type: 'add-activity', activityId: activity.id, activityLabel: name, ...where(trip, slot) });
      } else {
        const activity = next.activities.find((a) => a.id === change.activityId);
        const from = { name: activity.name, meeting: activity.meeting, capacity: activity.capacity, startsAt: activity.startsAt };
        const to = { name, meeting, capacity: change.capacity, startsAt };
        Object.assign(activity, to);
        entries.push({ ...base(), type: 'edit-activity', activityId: activity.id, ...where(trip, slot), from, to });
      }
      return save(ctx, next, entries, {});
    }

    if (change.type === 'add-restaurant' || change.type === 'edit-restaurant') {
      const existing = change.type === 'edit-restaurant' ? next.restaurants.find((r) => r.id === change.restaurantId) : null;
      const destination = change.type === 'add-restaurant'
        ? trip.destinations.find((d) => d.id === change.destinationId)
        : trip.destinations.find((d) => d.id === existing.destinationId);
      const name = change.name.trim();
      const seatings = [...change.seatings].sort();
      // Only the fields for the chosen mode are kept; the other mode's fields are null, so a restaurant
      // never carries stale numbers from a mode it is no longer in. Strict mode's tables keep their
      // stable ids across an edit where their size did not change (see reconcileTables) — a booking
      // (step 2a) references a table by id, so an edit must not silently orphan it.
      const fields = change.mode === 'flexible'
        ? { mode: 'flexible', seatsPerSeating: change.seatsPerSeating, maxTableSize: change.maxTableSize, tables: null }
        : { mode: 'strict', seatsPerSeating: null, maxTableSize: null, tables: reconcileTables(existing?.tables, change.tableSizes) };
      // A restaurant is destination-level, not tied to one half-day, so it is shown in the Journal by
      // the destination's own name and time zone, like edit-destination below.
      const destWhere = { slotId: null, slotLabel: destination.name, place: { name: destination.name, timeZone: destination.timeZone } };

      if (change.type === 'add-restaurant') {
        const restaurant = { id: newId(), destinationId: destination.id, name, seatings, ...fields };
        next.restaurants.push(restaurant);
        entries.push({ ...base(), type: 'add-restaurant', restaurantId: restaurant.id, restaurantLabel: name, ...destWhere });
      } else {
        const from = { name: existing.name, seatings: existing.seatings, mode: existing.mode, seatsPerSeating: existing.seatsPerSeating, maxTableSize: existing.maxTableSize, tables: existing.tables };
        const to = { name, seatings, ...fields };
        Object.assign(existing, to);
        entries.push({ ...base(), type: 'edit-restaurant', restaurantId: existing.id, ...destWhere, from, to });
      }
      return save(ctx, next, entries, {});
    }

    // edit-destination and replace-destination: change the destination's own name, country, time zone.
    const destination = next.destinations.find((d) => d.id === change.destinationId);
    const from = { name: destination.name, country: destination.country, timeZone: destination.timeZone };
    const to = { name: change.name.trim(), country: String(change.country ?? '').trim(), timeZone: change.timeZone };
    // A destination-level change is not tied to one half-day: shown with the destination's own (old) name and time.
    const destWhere = { slotId: null, slotLabel: from.name, place: { name: from.name, timeZone: from.timeZone } };

    if (change.type === 'replace-destination') {
      // A rare fix: wrong destination altogether. Its tours are cancelled (as Cancel tour does) and everybody on
      // them goes to At leisure, all in this one action, before the destination's own name/country/zone change.
      const slotIds = new Set(trip.slots.filter((s) => s.destinationId === destination.id).map((s) => s.id));
      const activeTours = trip.activities.filter((a) => slotIds.has(a.slotId) && !a.cancelled);
      let cancelledCount = 0;
      let movedCount = 0;
      for (const activity of activeTours) {
        const slot = trip.slots.find((s) => s.id === activity.slotId);
        const swept = everyoneOnActivity(trip, activity, slot.id); // booked AND waitlisted: nobody stays waiting on a cancelled tour
        next.activities.find((a) => a.id === activity.id).cancelled = true;
        entries.push({ ...base(), type: 'cancel-tour', activityId: activity.id, activityLabel: activity.name, guestCount: swept.length, ...where(trip, slot) });
        cancelledCount += 1;
        movedCount += swept.length;
        for (const guest of swept) move(guest, slot, { kind: 'leisure' }, 'replace-destination');
      }
      entries.push({ ...base(), type: 'replace-destination', destinationId: destination.id, from, to, cancelledCount, movedCount, ...destWhere });
    } else {
      entries.push({ ...base(), type: 'edit-destination', destinationId: destination.id, from, to, ...destWhere });
    }
    Object.assign(destination, to);
    return save(ctx, next, entries, {});
  }

  // Booking a dinner table (Phase 3 step 2a/2b). Never rejected for "no room" — dinnerFit decides
  // Confirmed vs. Special request; either way the table is created and the guests are moved onto it.
  // One 'book-dinner' entry (the table itself) plus one 'move' entry per guest (reusing move() above,
  // so Undo, the Journal's guest-name search and per-guest history all come from the existing,
  // tested machinery instead of a second, parallel implementation).
  if (changes[0].type === 'book-dinner') {
    const change = changes[0];
    const slot = trip.slots.find((s) => s.id === change.slotId);
    const restaurant = trip.restaurants.find((r) => r.id === change.restaurantId);
    // A specific table chosen on the "By table" grid (step 2b): book onto it directly, even
    // deliberately oversized ("force a bigger table"), instead of letting dinnerFit search for one.
    const { status, tableIds } = change.tableId
      ? { status: change.guestIds.length <= restaurant.tables.find((t) => t.id === change.tableId).size ? 'confirmed' : 'special-request', tableIds: [change.tableId] }
      : dinnerFit(trip, restaurant, slot, change.seating, change.guestIds.length);
    const booking = { id: newId(), slotId: slot.id, restaurantId: restaurant.id, seating: change.seating, tableIds, status };
    next.dinnerBookings.push(booking);
    entries.push({
      ...base(), type: 'book-dinner', bookingId: booking.id, restaurantId: restaurant.id,
      restaurantLabel: restaurant.name, seating: change.seating, status, ...where(trip, slot),
    });
    const label = `${restaurant.name}, ${change.seating}`;
    for (const guestId of change.guestIds) {
      move(trip.guests.find((g) => g.id === guestId), slot, { kind: 'dinner', bookingId: booking.id, label }, 'book-dinner');
    }
    return save(ctx, next, entries, { status });
  }

  // Adding guests to an EXISTING table (Phase 3 step 2b) — never creates a new dinnerBooking. The
  // table's status is recomputed fresh from its new total occupancy (dinnerAddFit), the same "never
  // accumulate, always re-derive" principle as dinnerCountIn itself.
  if (changes[0].type === 'add-to-dinner-table') {
    const change = changes[0];
    const originalBooking = trip.dinnerBookings.find((b) => b.id === change.bookingId);
    const slot = trip.slots.find((s) => s.id === originalBooking.slotId);
    const restaurant = trip.restaurants.find((r) => r.id === originalBooking.restaurantId);
    const fromStatus = originalBooking.status;
    const { status: toStatus } = dinnerAddFit(trip, restaurant, originalBooking, change.guestIds.length);
    const booking = next.dinnerBookings.find((b) => b.id === change.bookingId);
    booking.status = toStatus;
    entries.push({
      ...base(), type: 'add-to-dinner-table', bookingId: booking.id, restaurantId: restaurant.id,
      restaurantLabel: restaurant.name, seating: booking.seating, fromStatus, toStatus, ...where(trip, slot),
    });
    const label = `${restaurant.name}, ${booking.seating}`;
    for (const guestId of change.guestIds) {
      move(trip.guests.find((g) => g.id === guestId), slot, { kind: 'dinner', bookingId: booking.id, label }, 'add-to-dinner-table');
    }
    return save(ctx, next, entries, { status: toStatus });
  }

  // Moving a whole table to another restaurant/seating (Phase 3 step 2c) — every current guest of
  // one table, moved together. Creates a fresh table at the destination, exactly like book-dinner
  // (change.tableId works the same way); the source table gets no special treatment at all — once
  // every one of its guests has moved off it, it is already "empty" by the same live dinnerCountIn
  // check every other screen already uses, so it simply stops showing up, the same ghost-table rule
  // step 2b relies on. Nothing here deletes it.
  if (changes[0].type === 'move-dinner-table') {
    const change = changes[0];
    const sourceBooking = trip.dinnerBookings.find((b) => b.id === change.bookingId);
    const slot = trip.slots.find((s) => s.id === sourceBooking.slotId);
    const restaurant = trip.restaurants.find((r) => r.id === change.restaurantId);
    const sourceRestaurant = trip.restaurants.find((r) => r.id === sourceBooking.restaurantId);
    const guestIds = trip.guests
      .filter((g) => !g.leftAt && trip.bookings[g.id]?.[slot.id]?.bookingId === sourceBooking.id)
      .map((g) => g.id);
    const { status, tableIds } = change.tableId
      ? { status: guestIds.length <= restaurant.tables.find((t) => t.id === change.tableId).size ? 'confirmed' : 'special-request', tableIds: [change.tableId] }
      : dinnerFit(trip, restaurant, slot, change.seating, guestIds.length, sourceBooking.id);
    const booking = { id: newId(), slotId: slot.id, restaurantId: restaurant.id, seating: change.seating, tableIds, status };
    next.dinnerBookings.push(booking);
    entries.push({
      ...base(), type: 'move-dinner-table', bookingId: booking.id, restaurantId: restaurant.id,
      restaurantLabel: restaurant.name, seating: change.seating, status,
      fromRestaurantLabel: sourceRestaurant.name, fromSeating: sourceBooking.seating, ...where(trip, slot),
    });
    const label = `${restaurant.name}, ${change.seating}`;
    for (const guestId of guestIds) {
      move(trip.guests.find((g) => g.id === guestId), slot, { kind: 'dinner', bookingId: booking.id, label }, 'move-dinner-table');
    }
    return save(ctx, next, entries, { status });
  }

  // Guests and travel parties (step 7c/7d): each made on its own.
  if (GUEST_TYPES.has(changes[0].type)) {
    const change = changes[0];

    if (change.type === 'create-party') {
      // At least 2 guests, each leaving their old travel party (if any), form a brand new one together.
      // No type is asked: a fresh party just says "Travelling with ..." until the owner gives it one (rare).
      const partyGuests = change.guestIds.map((id) => next.guests.find((g) => g.id === id));
      const fromPartyIds = Object.fromEntries(partyGuests.map((g) => [g.id, g.partyId]));
      const party = { id: newId(), ref: '', type: '' };
      next.parties.push(party);
      for (const g of partyGuests) g.partyId = party.id;
      entries.push({
        ...base(), type: 'create-party', ...guestWhere, guestIds: change.guestIds,
        guestNames: partyGuests.map((g) => names.get(g.id)), fromPartyIds, toPartyId: party.id,
      });
      return save(ctx, next, entries, {});
    }

    const guest = next.guests.find((g) => g.id === change.guestId);
    const guestName = names.get(guest.id); // the name as it was BEFORE this change (a rename still reads right)

    if (change.type === 'edit-guest') {
      const from = { first: guest.first, last: guest.last, seat: guest.seat ?? null };
      guest.first = change.first.trim();
      guest.last = change.last.trim();
      guest.seat = String(change.seat ?? '').trim() || null;
      entries.push({ ...base(), type: 'edit-guest', ...guestWhere, guestId: guest.id, guestName, from, to: { first: guest.first, last: guest.last, seat: guest.seat } });
    } else if (change.type === 'guest-left') {
      guest.leftAt = at;
      entries.push({ ...base(), type: 'guest-left', ...guestWhere, guestId: guest.id, guestName });
    } else if (change.type === 'guest-return') {
      const previousLeftAt = guest.leftAt; // the exact moment they left, kept so Undo of THIS action puts it back precisely
      guest.leftAt = null;
      entries.push({ ...base(), type: 'guest-return', ...guestWhere, guestId: guest.id, guestName, previousLeftAt });
    } else if (change.type === 'make-solo') {
      const fromPartyId = guest.partyId;
      const party = { id: newId(), ref: '', type: 'Solo' };
      next.parties.push(party);
      guest.partyId = party.id;
      entries.push({ ...base(), type: 'make-solo', ...guestWhere, guestId: guest.id, guestName, fromPartyId, toPartyId: party.id });
    } else {
      // join-party: leaves their current travel party (which may now be down to one person, shown as "solo"
      // automatically) and joins another. No type is asked: if the target was travelling solo, its old
      // "Solo" label no longer fits a group, so it is cleared (shown as "Travelling with ...", not "Solo with").
      const fromPartyId = guest.partyId;
      const party = next.parties.find((p) => p.id === change.partyId);
      const otherMembers = trip.guests.filter((g) => g.partyId === party.id);
      const otherMemberNames = otherMembers.map((g) => names.get(g.id));
      const fromType = party.type;
      if (change.newType) party.type = change.newType.trim();
      else if (otherMembers.length <= 1) party.type = '';
      guest.partyId = party.id;
      entries.push({ ...base(), type: 'join-party', ...guestWhere, guestId: guest.id, guestName, fromPartyId, toPartyId: party.id, fromType, toType: party.type, otherMemberNames });
    }
    return save(ctx, next, entries, {});
  }

  // The trip itself (step 9): archive, un-archive, delete, reinstate. Each made on its own. Not tied to
  // one half-day, so it uses the same "local, right now" place as guest and travel party changes.
  if (TRIP_TYPES.has(changes[0].type)) {
    const change = changes[0];
    if (change.type === 'archive-trip') {
      next.archivedAt = at;
      entries.push({ ...base(), type: 'archive-trip', ...guestWhere });
    } else if (change.type === 'unarchive-trip') {
      entries.push({ ...base(), type: 'unarchive-trip', ...guestWhere, previousArchivedAt: trip.archivedAt });
      next.archivedAt = null;
    } else if (change.type === 'delete-trip') {
      next.deletedAt = at;
      entries.push({ ...base(), type: 'delete-trip', ...guestWhere });
    } else {
      entries.push({ ...base(), type: 'reinstate-trip', ...guestWhere, previousDeletedAt: trip.deletedAt });
      next.deletedAt = null;
    }
    return save(ctx, next, entries, {});
  }

  // The trip's own name. Not tied to one half-day, so it uses the same "local, right now" place as
  // guest, travel party and other trip-level changes.
  if (TRIP_INFO_TYPES.has(changes[0].type)) {
    const from = trip.name;
    const to = changes[0].name.trim();
    next.name = to;
    entries.push({ ...base(), type: 'rename-trip', ...guestWhere, from, to });
    return save(ctx, next, entries, {});
  }

  for (const change of changes) {
    if (change.type === 'move') {
      const approvedBy = String(change.approvedBy ?? '').trim().slice(0, 60) || null;
      move(trip.guests.find((g) => g.id === change.guestId), trip.slots.find((s) => s.id === change.slotId), change.to, null, Boolean(change.force), approvedBy);
      continue;
    }

    // Cancel tour: everyone on it (booked AND waitlisted) goes to At leisure, and the tour stays
    // visible as Cancelled. Nobody should stay waiting for a tour that no longer runs.
    const activity = trip.activities.find((a) => a.id === change.activityId);
    const slot = trip.slots.find((s) => s.id === activity.slotId);
    const swept = everyoneOnActivity(trip, activity, slot.id);
    next.activities.find((a) => a.id === activity.id).cancelled = true;
    entries.push({
      ...base(), type: 'cancel-tour', activityId: activity.id, activityLabel: activity.name,
      guestCount: swept.length, ...where(trip, slot),
    });
    for (const guest of swept) move(guest, slot, { kind: 'leisure' }, 'cancel-tour');
  }

  return save(ctx, next, entries, {});
}

// Takes back ONE journal line of the action being undone, and writes the line that says so.
function undoEntry(next, entry, base, entries) {
  const rollCall = entry.rollCallId ? (next.rollCalls ?? []).find((r) => r.id === entry.rollCallId) : null;
  const about = entry.rollCallId
    ? { rollCallId: entry.rollCallId, activityId: entry.activityId, activityLabel: entry.activityLabel, slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place }
    : {};

  if (entry.type === 'cancel-tour') {
    next.activities.find((a) => a.id === entry.activityId).cancelled = false; // the tour is back
    return;
  }

  if (entry.type === 'archive-trip') {
    next.archivedAt = null;
    entries.push({ ...base(), type: 'unarchive-trip', cause: 'undo', slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place });
    return;
  }
  if (entry.type === 'unarchive-trip') {
    next.archivedAt = entry.previousArchivedAt;
    entries.push({ ...base(), type: 'archive-trip', cause: 'undo', slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place });
    return;
  }
  if (entry.type === 'delete-trip') {
    next.deletedAt = null;
    entries.push({ ...base(), type: 'reinstate-trip', cause: 'undo', slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place });
    return;
  }
  if (entry.type === 'reinstate-trip') {
    next.deletedAt = entry.previousDeletedAt;
    entries.push({ ...base(), type: 'delete-trip', cause: 'undo', slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place });
    return;
  }
  if (entry.type === 'rename-trip') {
    next.name = entry.from;
    entries.push({ ...base(), type: 'rename-trip', cause: 'undo', slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place, from: entry.to, to: entry.from });
    return;
  }

  if (entry.type === 'rollcall-start') {
    next.rollCalls = next.rollCalls.filter((r) => r.id !== entry.rollCallId); // as if it was never started
    entries.push({ ...base(), type: 'rollcall-remove', cause: 'undo', ...about });
    return;
  }
  if (entry.type === 'rollcall-end') {
    rollCall.endedAt = null; // the roll call is open again (the guests it moved are put back by their own lines)
    delete rollCall.endedBy;
    rollCall.movedByEnd = (rollCall.movedByEnd ?? []).filter((id) => !entry.movedGuestIds?.includes(id));
    entries.push({ ...base(), type: 'rollcall-reopen', cause: 'undo', ...about });
    return;
  }
  if (entry.type === 'rollcall-reopen') {
    rollCall.endedAt = entry.previousEndedAt; // closed again, as End roll call left it (the guests put back are moved back by their own lines)
    if (entry.previousEndedBy) rollCall.endedBy = entry.previousEndedBy;
    rollCall.movedByEnd = entry.previousMovedByEnd;
    entries.push({ ...base(), type: 'rollcall-close', cause: 'undo', ...about });
    return;
  }
  if (entry.type === 'checkin' || entry.type === 'checkout') {
    // Back to where the guest was before: in the vehicle they came from, or not in any (on the list).
    const before = entry.fromVehicleId; // (a check-out remembers the vehicle the guest came out of in the same field)
    const beforeLabel = entry.fromVehicleLabel;
    const after = entry.type === 'checkin' ? entry.vehicleId : null;
    const afterLabel = entry.type === 'checkin' ? entry.vehicleLabel : null;
    if (before) rollCall.checkins[entry.guestId] = before; else delete rollCall.checkins[entry.guestId];
    entries.push(before
      ? { ...base(), type: 'checkin', cause: 'undo', ...about, guestId: entry.guestId, guestName: entry.guestName, vehicleId: before, vehicleLabel: beforeLabel, fromVehicleId: after, fromVehicleLabel: afterLabel }
      : { ...base(), type: 'checkout', cause: 'undo', ...about, guestId: entry.guestId, guestName: entry.guestName, fromVehicleId: entry.vehicleId, fromVehicleLabel: entry.vehicleLabel });
    return;
  }
  if (entry.type === 'vehicle-add') {
    rollCall.vehicles = rollCall.vehicles.filter((v) => v.id !== entry.vehicleId);
    entries.push({ ...base(), type: 'vehicle-remove', cause: 'undo', ...about, vehicleId: entry.vehicleId, vehicleLabel: entry.vehicleLabel });
    return;
  }
  if (entry.type === 'vehicle-number') {
    rollCall.vehicles.find((v) => v.id === entry.vehicleId).number = entry.fromNumber;
    entries.push({ ...base(), type: 'vehicle-number', cause: 'undo', ...about, vehicleId: entry.vehicleId, fromNumber: entry.toNumber, toNumber: entry.fromNumber, fromLabel: entry.toLabel, toLabel: entry.fromLabel });
    return;
  }
  if (entry.type === 'edit-destination' || entry.type === 'replace-destination') {
    // Puts the destination's own fields back (a replace-destination's cancelled tours and moved guests are put
    // back by their own lines, elsewhere in this same batch).
    const destination = next.destinations.find((d) => d.id === entry.destinationId);
    Object.assign(destination, entry.from);
    entries.push({
      ...base(), type: 'edit-destination', cause: 'undo', destinationId: entry.destinationId,
      slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place, from: entry.to, to: entry.from,
    });
    return;
  }
  if (entry.type === 'add-activity') {
    next.activities = next.activities.filter((a) => a.id !== entry.activityId); // as if it was never added
    entries.push({ ...base(), type: 'activity-remove', cause: 'undo', activityId: entry.activityId, activityLabel: entry.activityLabel, slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place });
    return;
  }
  if (entry.type === 'edit-activity') {
    const activity = next.activities.find((a) => a.id === entry.activityId);
    Object.assign(activity, entry.from);
    entries.push({
      ...base(), type: 'edit-activity', cause: 'undo', activityId: entry.activityId,
      slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place, from: entry.to, to: entry.from,
    });
    return;
  }
  if (entry.type === 'add-restaurant') {
    next.restaurants = next.restaurants.filter((r) => r.id !== entry.restaurantId); // as if it was never added
    entries.push({ ...base(), type: 'restaurant-remove', cause: 'undo', restaurantId: entry.restaurantId, restaurantLabel: entry.restaurantLabel, slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place });
    return;
  }
  if (entry.type === 'edit-restaurant') {
    const restaurant = next.restaurants.find((r) => r.id === entry.restaurantId);
    Object.assign(restaurant, entry.from);
    entries.push({
      ...base(), type: 'edit-restaurant', cause: 'undo', restaurantId: entry.restaurantId,
      slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place, from: entry.to, to: entry.from,
    });
    return;
  }
  // The table itself; each guest who was on it is put back by their own 'move' entry, undone
  // separately (see doApply's book-dinner handling — the guest moves are pushed after this entry,
  // so they are undone BEFORE it, in reverse order, and this only ever removes an empty table).
  if (entry.type === 'book-dinner') {
    next.dinnerBookings = next.dinnerBookings.filter((b) => b.id !== entry.bookingId);
    entries.push({ ...base(), type: 'dinner-remove', cause: 'undo', bookingId: entry.bookingId, restaurantLabel: entry.restaurantLabel, slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place });
    return;
  }
  // The table's status, put back to what it was before (the guests who were added are put back by
  // their own 'move' entries, undone separately — same ordering guarantee as book-dinner above).
  if (entry.type === 'add-to-dinner-table') {
    next.dinnerBookings.find((b) => b.id === entry.bookingId).status = entry.fromStatus;
    entries.push({
      ...base(), type: 'add-to-dinner-table', cause: 'undo', bookingId: entry.bookingId,
      restaurantLabel: entry.restaurantLabel, seating: entry.seating, fromStatus: entry.toStatus, toStatus: entry.fromStatus,
      slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place,
    });
    return;
  }
  // The destination table created by the move; every guest who was on it is put back on the SOURCE
  // table by their own 'move' entry, undone separately (pushed after this one, so undone BEFORE it,
  // in reverse order — same ordering guarantee as book-dinner above). This only ever removes an
  // already-empty table.
  if (entry.type === 'move-dinner-table') {
    next.dinnerBookings = next.dinnerBookings.filter((b) => b.id !== entry.bookingId);
    entries.push({ ...base(), type: 'dinner-remove', cause: 'undo', bookingId: entry.bookingId, restaurantLabel: entry.restaurantLabel, slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place });
    return;
  }
  if (entry.type === 'edit-guest') {
    const guest = next.guests.find((g) => g.id === entry.guestId);
    Object.assign(guest, entry.from);
    entries.push({ ...base(), type: 'edit-guest', cause: 'undo', slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place, guestId: entry.guestId, guestName: entry.guestName, from: entry.to, to: entry.from });
    return;
  }
  if (entry.type === 'guest-left') {
    next.guests.find((g) => g.id === entry.guestId).leftAt = null;
    entries.push({ ...base(), type: 'guest-return', cause: 'undo', slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place, guestId: entry.guestId, guestName: entry.guestName });
    return;
  }
  if (entry.type === 'guest-return') {
    next.guests.find((g) => g.id === entry.guestId).leftAt = entry.previousLeftAt; // the exact original moment, restored
    entries.push({ ...base(), type: 'guest-left', cause: 'undo', slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place, guestId: entry.guestId, guestName: entry.guestName });
    return;
  }
  if (entry.type === 'make-solo') {
    next.guests.find((g) => g.id === entry.guestId).partyId = entry.fromPartyId;
    next.parties = next.parties.filter((p) => p.id !== entry.toPartyId); // the fresh solo party is removed, as if never made
    entries.push({ ...base(), type: 'party-remove', cause: 'undo', slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place, guestId: entry.guestId, guestName: entry.guestName });
    return;
  }
  if (entry.type === 'join-party') {
    next.guests.find((g) => g.id === entry.guestId).partyId = entry.fromPartyId;
    const party = next.parties.find((p) => p.id === entry.toPartyId);
    if (party) party.type = entry.fromType; // put its type back too, if joining had changed it
    entries.push({
      ...base(), type: 'join-party', cause: 'undo', slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place,
      guestId: entry.guestId, guestName: entry.guestName,
      fromPartyId: entry.toPartyId, toPartyId: entry.fromPartyId, fromType: entry.toType, toType: entry.fromType,
    });
    return;
  }
  if (entry.type === 'create-party') {
    for (const id of entry.guestIds) next.guests.find((g) => g.id === id).partyId = entry.fromPartyIds[id];
    next.parties = next.parties.filter((p) => p.id !== entry.toPartyId); // the fresh party is removed, as if never made
    entries.push({ ...base(), type: 'party-remove', cause: 'undo', slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place, guestIds: entry.guestIds, guestNames: entry.guestNames });
    return;
  }

  // A move: put the guest back where they were. "Nothing chosen yet" is put back as nothing.
  const row = (next.bookings[entry.guestId] ??= {});
  if (entry.from.kind === 'blank') delete row[entry.slotId];
  else if (entry.from.kind === 'leisure') row[entry.slotId] = { kind: 'leisure' };
  else if (entry.from.kind === 'dinner') row[entry.slotId] = { kind: 'dinner', bookingId: entry.from.bookingId };
  else if (entry.from.kind === 'waitlist') row[entry.slotId] = { kind: 'waitlist', activityId: entry.from.activityId };
  else if (entry.from.kind === 'unknown') row[entry.slotId] = { kind: 'unknown', raw: entry.from.raw };
  else row[entry.slotId] = { kind: 'activity', activityId: entry.from.activityId };

  entries.push({
    ...base(), type: 'move', cause: 'undo',
    guestId: entry.guestId, guestName: entry.guestName,
    slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place,
    from: entry.to, to: entry.from,
  });
}

// Saves the changed trip and its journal entries together. If that fails, nothing changed.
async function save(ctx, next, entries, extra) {
  try {
    await ctx.commit(next, entries);
  } catch (error) {
    return fail(`Could not save on this phone (${error.message}). Nothing was changed.`);
  }
  return { ok: true, entries, ...extra };
}

// Everyone tied to an activity right now — confirmed AND waitlisted — who must be swept to leisure
// when the tour itself goes away (cancel-tour, replace-destination): nobody should stay "waiting" for
// a tour that no longer runs. Shared so the two call sites (which already independently duplicated
// the plain "who's booked on it" collection) cannot drift apart on whether waitlisted guests move too.
function everyoneOnActivity(trip, activity, slotId) {
  const guests = [];
  for (const guest of trip.guests) {
    if (guest.leftAt) continue;
    const booking = trip.bookings[guest.id]?.[slotId];
    if ((booking?.kind === 'activity' || booking?.kind === 'waitlist') && booking.activityId === activity.id) guests.push(guest);
  }
  return guests;
}

// Where a change happened: the half-day, and the place with its time zone (the journal shows
// times in the local time of that place, e.g. "14:32 Kyoto time").
function where(trip, slot) {
  const destination = trip.destinations.find((d) => d.id === slot.destinationId);
  return { slotId: slot.id, slotLabel: slotLabel(trip, slot), place: { name: destination.name, timeZone: destination.timeZone } };
}

// A guest's place before a change, as text for the journal. The dinner case matters even though
// nothing here directly offers "move to this dinner": the ordinary Move sheet (move.js) is a
// generic entry point into any slot booking, so a dinner-booked guest moved through it must be
// described truthfully (not as "nothing chosen") — and undone correctly, see undoEntry's fallback.
function describe(place) {
  if (place.kind === 'activity') return { kind: 'activity', activityId: place.activity.id, label: place.activity.name };
  if (place.kind === 'leisure') return { kind: 'leisure', label: 'At leisure' };
  if (place.kind === 'dinner') return { kind: 'dinner', bookingId: place.booking.id, label: `${place.restaurant.name}, ${place.booking.seating}` };
  if (place.kind === 'waitlist') return { kind: 'waitlist', activityId: place.activity.id, label: `Waitlist: ${place.activity.name}` };
  if (place.kind === 'unknown') return { kind: 'unknown', raw: place.raw, label: `"${place.raw}" (unknown activity)` };
  return { kind: 'blank', label: 'Nothing chosen yet' };
}
