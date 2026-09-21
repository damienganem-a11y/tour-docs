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
//   { type: 'move', guestId, slotId, to: { kind: 'activity', activityId } | { kind: 'leisure' } }
//   { type: 'cancel-tour', activityId }        everybody on it goes to At leisure, it stays as "Cancelled"
// applyChange() accepts one change or a list. A list is all-or-nothing: if any one of them is
// not allowed, none are applied. (Moving a couple together is a list of two moves.)
//
// Privacy: journal entries never contain dietary info.

import { newId } from './ids.js';
import { canUser } from './users.js';
import { displayNames, guestPlace, countIn, slotLabel } from './rules.js';

const fail = (error) => ({ ok: false, error });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- 1. Checking changes (changes nothing) ----------

// Returns { ok: true } or { ok: false, error: 'plain-language reason' }.
// The screens also use this to grey out choices that would not be allowed.
export function validateChanges(trip, user, changes) {
  if (!canUser(user, 'change')) return fail('You do not have permission to change bookings.');
  if (!trip) return fail('This trip is not on this phone.');
  if (trip.archivedAt) return fail('This trip is archived. Un-archive it to change it.');
  if (!Array.isArray(changes) || changes.length === 0) return fail('There is nothing to change.');

  const names = displayNames(trip.guests);
  if (changes.some((c) => c.type === 'cancel-tour') && changes.length > 1) {
    return fail('Cancelling a tour is a change of its own.');
  }

  const seen = new Set();     // the same guest cannot be changed twice in the same half-day
  const flows = new Map();    // activityId -> { activity, joining, leaving }, to check capacity below
  const flow = (activity) => {
    if (!flows.has(activity.id)) flows.set(activity.id, { activity, joining: 0, leaving: 0 });
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
    } else {
      return fail('Choose an activity or At leisure.');
    }
    if (here.kind === 'activity') flow(here.activity).leaving++;
  }

  // Capacity: for every activity that gains guests, will they all fit?
  // An activity with no capacity never fills up. Guests leaving in the same change free their places.
  for (const { activity, joining, leaving } of flows.values()) {
    if (joining === 0 || activity.capacity === null) continue;

    const now = countIn(trip, activity);
    const room = activity.capacity - (now - leaving);
    if (joining > room) {
      if (room <= 0) return fail(`"${activity.name}" is full (${now} / ${activity.capacity}).`);
      return fail(`Only ${plural(room, 'place')} left in "${activity.name}", but ${joining} would join.`);
    }
  }
  return { ok: true };
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
  const check = validateChanges(trip, ctx.owner, changes);
  if (!check.ok) return check;

  // Work on a copy. The real trip is only replaced once the copy is safely saved, so a failed
  // save can never leave the screen and the phone disagreeing.
  const next = structuredClone(trip);
  const names = displayNames(trip.guests);
  const batchId = newId();                  // links changes made together (a couple, a cancelled tour)
  const at = new Date().toISOString();      // the exact moment
  const entries = [];

  const base = () => ({
    id: newId(), tripId: trip.id, at,
    who: { id: ctx.owner.id, name: ctx.owner.name, role: ctx.owner.role },
    source: 'app',                          // later: 'colleague request', 'whatsapp'...
    batchId,
  });

  // A "move" of one guest in one half-day.
  const move = (guest, slot, to, cause) => {
    const before = guestPlace(trip, guest, slot);
    next.bookings[guest.id] ??= {};
    next.bookings[guest.id][slot.id] = to.kind === 'leisure' ? { kind: 'leisure' } : { kind: 'activity', activityId: to.activityId };

    // Names are copied in as text, so the journal still reads correctly even if things are renamed later.
    entries.push({
      ...base(), type: 'move', cause,
      guestId: guest.id, guestName: names.get(guest.id),
      ...where(trip, slot),
      from: describe(before),
      to: to.kind === 'leisure' ? { kind: 'leisure', label: 'At leisure' }
        : { kind: 'activity', activityId: to.activityId, label: trip.activities.find((a) => a.id === to.activityId).name },
    });
  };

  for (const change of changes) {
    if (change.type === 'move') {
      move(trip.guests.find((g) => g.id === change.guestId), trip.slots.find((s) => s.id === change.slotId), change.to, null);
      continue;
    }

    // Cancel tour: everyone on it goes to At leisure, and the tour stays visible as Cancelled.
    const activity = trip.activities.find((a) => a.id === change.activityId);
    const slot = trip.slots.find((s) => s.id === activity.slotId);
    const booked = trip.guests.filter((g) => trip.bookings[g.id]?.[slot.id]?.activityId === activity.id);
    next.activities.find((a) => a.id === activity.id).cancelled = true;
    entries.push({
      ...base(), type: 'cancel-tour', activityId: activity.id, activityLabel: activity.name,
      guestCount: booked.length, ...where(trip, slot),
    });
    for (const guest of booked) move(guest, slot, { kind: 'leisure' }, 'cancel-tour');
  }

  try {
    await ctx.commit(next, entries);
  } catch (error) {
    return fail(`Could not save on this phone (${error.message}). Nothing was changed.`);
  }
  return { ok: true, entries };
}

// Where a change happened: the half-day, and the place with its time zone (the journal shows
// times in the local time of that place, e.g. "14:32 Kyoto time").
function where(trip, slot) {
  const destination = trip.destinations.find((d) => d.id === slot.destinationId);
  return { slotId: slot.id, slotLabel: slotLabel(trip, slot), place: { name: destination.name, timeZone: destination.timeZone } };
}

// A guest's place before a change, as text for the journal.
function describe(place) {
  if (place.kind === 'activity') return { kind: 'activity', activityId: place.activity.id, label: place.activity.name };
  if (place.kind === 'leisure') return { kind: 'leisure', label: 'At leisure' };
  if (place.kind === 'unknown') return { kind: 'unknown', raw: place.raw, label: `"${place.raw}" (unknown activity)` };
  return { kind: 'blank', label: 'Nothing chosen yet' };
}
