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
//   { type: 'move', guestId, slotId, to: { kind: 'activity', activityId } | { kind: 'leisure' }, force?, approvedBy? }
//       force: true lets a move go into a full tour (the dispatcher has authority; owner only). The journal
//       then says "forced", with the optional note approvedBy ("Approved by Sam").
//   { type: 'cancel-tour', activityId }        everybody on it goes to At leisure, it stays as "Cancelled"
//   { type: 'undo' }                           takes back the last action of the trip (like Ctrl+Z)
//   Roll call (see rollcall.js), each one on its own:
//   { type: 'rollcall-start', activityId }
//   { type: 'checkin', activityId, guestId, vehicleId }      the guest goes into that vehicle (or moves to it)
//   { type: 'checkout', activityId, guestId }                the guest comes out of the vehicle: back on the list
//   { type: 'vehicle-add', activityId }                      the next vehicle number (V5, V6...)
//   { type: 'vehicle-number', activityId, vehicleId, number }
//   (Several 'checkin' changes for the same roll call may be made together: a travel party checked in at once.)
// applyChange() accepts one change or a list. A list is all-or-nothing: if any one of them is
// not allowed, none are applied. (Moving a couple together is a list of two moves.)
//
// Undo never deletes anything from the journal: it writes new entries saying what was taken back.
// Privacy: journal entries never contain dietary info.

import { newId } from './ids.js';
import { canUser } from './users.js';
import { displayNames, guestPlace, countIn, slotLabel, plural } from './rules.js';
import { lastUndoable, summarize } from './journal.js';
import { findRollCall, vehicleLabel, defaultVehicles } from './rollcall.js';

// The changes that belong to a roll call. Each one is made on its own (never mixed with others).
const ROLLCALL_TYPES = new Set(['rollcall-start', 'checkin', 'checkout', 'vehicle-add', 'vehicle-number']);

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
  // Cancelling a tour, undoing and roll call changes are made on their own. The one exception: several
  // check-ins together (a travel party checked into the same vehicle at once).
  const allCheckins = changes.every((c) => c.type === 'checkin');
  if (changes.some((c) => c.type === 'cancel-tour' || c.type === 'undo' || ROLLCALL_TYPES.has(c.type)) && changes.length > 1 && !allCheckins) {
    return fail('Cancelling a tour, undoing and roll call changes are changes of their own.');
  }
  if (changes[0].type === 'undo') return validateUndo(trip, journal);
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
    } else {
      return fail('Choose an activity or At leisure.');
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
function validateUndo(trip, journal) {
  const target = lastUndoable(journal);
  if (!target) return fail('There is nothing to undo.');

  for (const entry of target.entries) {
    if (entry.type === 'cancel-tour') {
      const activity = trip.activities.find((a) => a.id === entry.activityId);
      if (!activity || !activity.cancelled) return fail(`"${entry.activityLabel}" is not cancelled anymore, so this cannot be undone.`);
    }
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
  if (rollCall.endedAt) return fail('This roll call has ended.');
  const vehicle = rollCall.vehicles.find((v) => v.id === change.vehicleId);
  const names = displayNames(trip.guests);
  const guest = trip.guests.find((g) => g.id === change.guestId);

  if (change.type === 'checkin') {
    if (!guest) return fail('That guest is not in this trip.');
    if (!vehicle) return fail('That vehicle does not exist.');
    if (trip.bookings[guest.id]?.[activity.slotId]?.activityId !== activity.id) return fail(`${names.get(guest.id)} is not booked on "${activity.name}".`);
    if (rollCall.checkins[guest.id] === vehicle.id) return fail(`${names.get(guest.id)} is already in ${vehicleLabel(trip, vehicle)}.`);
  } else if (change.type === 'checkout') {
    if (!guest) return fail('That guest is not in this trip.');
    if (!rollCall.checkins[guest.id]) return fail(`${names.get(guest.id)} is not in a vehicle.`);
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
  if (entry.type === 'vehicle-add' && !rollCall.vehicles.some((v) => v.id === entry.vehicleId)) return 'This action cannot be undone: that vehicle is gone.';
  if (entry.type === 'vehicle-number' && rollCall.vehicles.find((v) => v.id === entry.vehicleId)?.number !== entry.toNumber) return 'This action cannot be undone: that vehicle has another number now.';
  return null;
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

  // Undo: take back the last action of the trip, and write what was taken back.
  if (changes[0].type === 'undo') {
    const target = lastUndoable(journal);
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
        endedAt: null, vehicles: defaultVehicles(trip.defaultVehicles ?? 4), checkins: {},
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
      for (const one of changes) { // one check-in, or a whole travel party at once
        const who = trip.guests.find((g) => g.id === one.guestId);
        const into = rollCall.vehicles.find((v) => v.id === one.vehicleId);
        const fromId = rollCall.checkins[who.id] ?? null;
        const from = rollCall.vehicles.find((v) => v.id === fromId);
        rollCall.checkins[who.id] = into.id;
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

  // A "move" of one guest in one half-day.
  const move = (guest, slot, to, cause, force = false, approvedBy = null) => {
    const before = guestPlace(trip, guest, slot);
    const forced = force && to.kind === 'activity' && willBeOver(to.activityId);
    next.bookings[guest.id] ??= {};
    next.bookings[guest.id][slot.id] = to.kind === 'leisure' ? { kind: 'leisure' } : { kind: 'activity', activityId: to.activityId };

    // Names are copied in as text, so the journal still reads correctly even if things are renamed later.
    entries.push({
      ...base(), type: 'move', cause,
      forced, approvedBy: forced ? approvedBy : null, // a forced move says who approved it (optional note)
      guestId: guest.id, guestName: names.get(guest.id),
      ...where(trip, slot),
      from: describe(before),
      to: to.kind === 'leisure' ? { kind: 'leisure', label: 'At leisure' }
        : { kind: 'activity', activityId: to.activityId, label: trip.activities.find((a) => a.id === to.activityId).name },
    });
  };

  for (const change of changes) {
    if (change.type === 'move') {
      const approvedBy = String(change.approvedBy ?? '').trim().slice(0, 60) || null;
      move(trip.guests.find((g) => g.id === change.guestId), trip.slots.find((s) => s.id === change.slotId), change.to, null, Boolean(change.force), approvedBy);
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

  if (entry.type === 'rollcall-start') {
    next.rollCalls = next.rollCalls.filter((r) => r.id !== entry.rollCallId); // as if it was never started
    entries.push({ ...base(), type: 'rollcall-remove', cause: 'undo', ...about });
    return;
  }
  if (entry.type === 'checkin' || entry.type === 'checkout') {
    // Back to where the guest was before: in the vehicle they came from, or on the list.
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

  // A move: put the guest back where they were. "Nothing chosen yet" is put back as nothing.
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
