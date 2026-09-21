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
//   { type: 'undo' }                           takes back the last action of the trip (like Ctrl+Z)
// applyChange() accepts one change or a list. A list is all-or-nothing: if any one of them is
// not allowed, none are applied. (Moving a couple together is a list of two moves.)
//
// Undo never deletes anything from the journal: it writes new entries saying what was taken back.
// Privacy: journal entries never contain dietary info.

import { newId } from './ids.js';
import { canUser } from './users.js';
import { displayNames, guestPlace, countIn, slotLabel, plural } from './rules.js';
import { lastUndoable, summarize } from './journal.js';

const fail = (error) => ({ ok: false, error });

// ---------- 1. Checking changes (changes nothing) ----------

// Returns { ok: true } or { ok: false, error: 'plain-language reason' }.
// The screens also use this to grey out choices that would not be allowed.
// journal: the trip's journal entries (only Undo needs them).
export function validateChanges(trip, user, changes, journal = []) {
  if (!canUser(user, 'change')) return fail('You do not have permission to change bookings.');
  if (!trip) return fail('This trip is not on this phone.');
  if (trip.archivedAt) return fail('This trip is archived. Un-archive it to change it.');
  if (!Array.isArray(changes) || changes.length === 0) return fail('There is nothing to change.');

  const names = displayNames(trip.guests);
  if (changes.some((c) => c.type === 'cancel-tour' || c.type === 'undo') && changes.length > 1) {
    return fail('Cancelling a tour and undoing are changes of their own.');
  }
  if (changes[0].type === 'undo') return validateUndo(trip, journal);

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

// Undo is only possible if the trip still looks the way that action left it. (It always does, as the
// last action is the last thing that happened; this check protects against surprises.)
function validateUndo(trip, journal) {
  const target = lastUndoable(journal);
  if (!target) return fail('There is nothing to undo.');

  for (const entry of target.entries) {
    if (entry.type === 'cancel-tour') {
      const activity = trip.activities.find((a) => a.id === entry.activityId);
      if (!activity || !activity.cancelled) return fail(`"${entry.activityLabel}" is not cancelled anymore, so this cannot be undone.`);
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

// Is a guest's place (from guestPlace) the one a journal entry describes ({ kind, activityId, raw })?
function isPlace(place, spec) {
  if (spec.kind === 'activity') return place.kind === 'activity' && place.activity.id === spec.activityId;
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

  // Every action gets the next number in the trip's own order (`seq`), so the journal keeps its order even
  // when two actions happen in the same millisecond. (Journals from before this had no numbers: they count as 0.)
  const lastSeq = Math.max(trip.changeCount ?? 0, ...journal.map((e) => e.seq ?? 0));
  next.changeCount = lastSeq + 1;

  const base = () => ({
    id: newId(), tripId: trip.id, at,
    seq: next.changeCount, n: entries.length, // n = this entry's place inside its action
    who: { id: ctx.owner.id, name: ctx.owner.name, role: ctx.owner.role },
    source: 'app',                          // later: 'colleague request', 'whatsapp'...
    batchId,
  });

  // Undo: take back the last action of the trip, and write what was taken back.
  if (changes[0].type === 'undo') {
    const target = lastUndoable(journal);
    const summary = summarize(target);
    const [firstEntry] = target.entries;
    entries.push({
      ...base(), type: 'undo', undoesBatchId: target.batchId, undoesSummary: summary,
      slotId: firstEntry.slotId, slotLabel: firstEntry.slotLabel, place: firstEntry.place,
    });

    for (const entry of [...target.entries].reverse()) {
      if (entry.type === 'cancel-tour') {
        next.activities.find((a) => a.id === entry.activityId).cancelled = false; // the tour is back
        continue;
      }
      // Put the guest back where they were. "Nothing chosen yet" is put back as nothing.
      const row = (next.bookings[entry.guestId] ??= {});
      if (entry.from.kind === 'blank') delete row[entry.slotId];
      else if (entry.from.kind === 'leisure') row[entry.slotId] = { kind: 'leisure' };
      else if (entry.from.kind === 'unknown') row[entry.slotId] = { kind: 'unknown', raw: entry.from.raw };
      else row[entry.slotId] = { kind: 'activity', activityId: entry.from.activityId };

      entries.push({
        ...base(), type: 'move', cause: 'undo',
        guestId: entry.guestId, guestName: entry.guestName,
        slotId: entry.slotId, slotLabel: entry.slotLabel, place: entry.place,
        from: entry.to, to: entry.from,
      });
    }
    return save(ctx, next, entries, { summary });
  }

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

  return save(ctx, next, entries, {});
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
