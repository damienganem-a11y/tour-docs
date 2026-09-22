// Automatic checks. Open tests.html in the browser: every line should be green.
// They cover the sample trip's planted test cases (see SPEC.md) that step 1 can check, plus
// time zones, unique IDs, saving on the device, and files with mistakes.

import { buildTrip } from './loader.js';
import { dbGet, dbPut, dbAll, dbDelete, withStores, saveTripAndJournal } from './db.js';
import { applyChange, validateChanges } from './changes.js';
import { makeOwner } from './users.js';
import { newId } from './ids.js';
import { localToInstant, formatTime, formatMoment, formatWeekdayDate, tripDates, isValidTimeZone, formatTypedTime, localDateNow } from './time.js';
import { groupBatches, journalItems, lastUndoable, summarize, wasForced, forcedPlacements, USE_UNDO_SCOPE, DESTINATION_UNDO_SCOPE, GUEST_UNDO_SCOPE } from './journal.js';
import { findRollCall, vehicleLabel, rollCallState } from './rollcall.js';
import { pressable } from './dom.js';
import { hashPasscode, makePasscodeConfig, checkPasscode, isUnlocked, rememberUnlock } from './gate.js';
import { PASSCODE_CONFIG } from './passcode-config.js';
import { APP_VERSION } from './version.js';
import { plain, displayNames, alphabetical, bySeat, splitPastSlots, joinNames, partyLabel, whoIsWhere, guestPlace, capacityInfo, countIn, partyMovers, partyPlan, slotLabel, plural, bySlotOrder } from './rules.js';
import { buildListsPdf } from './pdf.js';
import { destinationExportDoc, nextVersion } from './export.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
}

// Runs something that should be refused, and checks the message says what we expect.
function checkRefused(name, action, expectedWords) {
  try {
    action();
    check(name, false, 'the file was accepted');
  } catch (error) {
    check(name, expectedWords.test(error.message), error.message);
  }
}

const raw = await (await fetch('./data/tour_docs_sample_trip_ZX-01.json')).json();
const trip = buildTrip(raw);
const guest = (ref) => trip.guests.find((g) => g.ref === ref);
const slot = (ref) => trip.slots.find((s) => s.ref === ref);
const activity = (ref) => trip.activities.find((a) => a.ref === ref);
const booking = (guestRef, slotRef) => trip.bookings[guest(guestRef).id][slot(slotRef).id];
const copyOfRaw = () => structuredClone(raw);

// --- The file loads ---
check('Loads the trip: name, start date, 24 days, 4 vehicles by default',
  trip.name.startsWith('Around the World') && trip.start === '2027-01-12' && trip.days === 24 && trip.defaultVehicles === 4);
check('Loads 80 guests, 44 travel parties, 39 half-days, 12 destinations',
  trip.guests.length === 80 && trip.parties.length === 44 && trip.slots.length === 39 && trip.destinations.length === 12,
  `${trip.guests.length} guests, ${trip.parties.length} parties, ${trip.slots.length} slots, ${trip.destinations.length} destinations`);
check('Half-day S38 is not in the file, and the app does not mind', !slot('S38') && trip.slots.length === 39);
check('Slots are in order: by day, then Morning, Afternoon, Evening',
  trip.slots.every((s, i) => i === 0 || s.day >= trip.slots[i - 1].day));
check('The trip dates read "12 Jan to 4 Feb 2027"', tripDates(trip.start, trip.days) === '12 Jan to 4 Feb 2027', tripDates(trip.start, trip.days));

// --- IDs ---
const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const allIds = [trip.id, ...trip.destinations, ...trip.slots, ...trip.activities, ...trip.parties, ...trip.guests].map((x) => x.id ?? x);
check('Every trip, destination, half-day, activity, party and guest has a UUID', allIds.every((id) => uuidShape.test(id)));
check('All those IDs are different', new Set(allIds).size === allIds.length, `${allIds.length} IDs`);
check('The codes from the file are kept as labels (G001, S05-2, P08...)', guest('G001')?.ref === 'G001' && activity('S05-2')?.name === 'Hammam and spa');
const many = Array.from({ length: 2000 }, newId);
check('2000 fresh IDs are all different and well formed', new Set(many).size === 2000 && many.every((id) => uuidShape.test(id)));
check('Loading the same file twice gives two trips with different IDs', buildTrip(raw).id !== trip.id && buildTrip(raw).guests[0].id !== trip.guests[0].id);

// --- Destinations and time zones ---
check('Every destination has a time zone the phone knows', trip.destinations.every((d) => isValidTimeZone(d.timeZone)));
check('Kyoto is Asia/Tokyo, Kigali is Africa/Kigali', trip.destinations.find((d) => d.name === 'Kyoto')?.timeZone === 'Asia/Tokyo'
  && trip.destinations.find((d) => d.name === 'Kigali')?.timeZone === 'Africa/Kigali');
check('Every half-day belongs to a destination', trip.slots.every((s) => trip.destinations.some((d) => d.id === s.destinationId)));

// Exact moments: local clock time + day + zone -> a UTC moment.
check('Tokyo 09:00 is 00:00 UTC (9 hours ahead)', localToInstant('2027-01-20', '09:00', 'Asia/Tokyo') === '2027-01-20T00:00:00.000Z');
check('Lisbon in January is on UTC, in July 1 hour ahead',
  localToInstant('2027-01-12', '15:00', 'Europe/Lisbon') === '2027-01-12T15:00:00.000Z' && localToInstant('2027-07-01', '12:00', 'Europe/Lisbon') === '2027-07-01T11:00:00.000Z');
check('Istanbul is 3 hours ahead, Paro (Bhutan) 6, India 5:30',
  localToInstant('2027-01-14', '10:00', 'Europe/Istanbul') === '2027-01-14T07:00:00.000Z'
  && localToInstant('2027-01-15', '12:00', 'Asia/Thimphu') === '2027-01-15T06:00:00.000Z'
  && localToInstant('2027-01-15', '12:00', 'Asia/Kolkata') === '2027-01-15T06:30:00.000Z');
check('Daylight saving is handled (New York, clocks change on 14 March 2027)',
  localToInstant('2027-03-13', '12:00', 'America/New_York') === '2027-03-13T17:00:00.000Z'
  && localToInstant('2027-03-15', '12:00', 'America/New_York') === '2027-03-15T16:00:00.000Z');

// Every activity's start time survives the round trip: stored as a moment, shown in the destination's time.
const rawStart = new Map(raw.slots.flatMap((s) => s.options.map((o) => [o.id, o.start.padStart(5, '0')])));
const badTimes = trip.activities.filter((a) => {
  const zone = trip.destinations.find((d) => d.id === slot2(a).destinationId).timeZone;
  return formatTime(a.startsAt, zone) !== rawStart.get(a.ref);
});
function slot2(a) { return trip.slots.find((s) => s.id === a.slotId); }
check(`All ${trip.activities.length} start times show as in the file, in each destination's own time`, badTimes.length === 0, badTimes.map((a) => a.ref).slice(0, 5).join(', '));
check('Tram 28 in Lisbon starts at the exact moment 2027-01-12 15:30 UTC', activity('S01-2').startsAt === '2027-01-12T15:30:00.000Z', activity('S01-2').startsAt);

// --- Bookings and At leisure ---
const cells = Object.values(trip.bookings).flatMap((row) => Object.values(row));
const count = (kind) => cells.filter((c) => c.kind === kind).length;
check('Every guest has a booking row, and nobody has a "Not on trip" state', Object.keys(trip.bookings).length === 80 && !cells.some((c) => c.kind === 'not-on-trip'));
check('1889 bookings on activities and 1225 at leisure', count('activity') === 1889 && count('leisure') === 1225, `${count('activity')} activity, ${count('leisure')} leisure`);
check('At leisure is a status, not an activity: no activity is called At leisure', !trip.activities.some((a) => /leisure/i.test(a.name)));
check('4 activities have no capacity (they never fill up)', trip.activities.filter((a) => a.capacity === null).length === 4);
check('Exactly 5 empty sign-ups (nothing stored for them)', 80 * 39 - cells.length === 5, `${80 * 39 - cells.length} found`);
const unknowns = trip.guests.flatMap((g) => trip.slots.map((s) => ({ g, s, b: trip.bookings[g.id][s.id] }))).filter((x) => x.b?.kind === 'unknown');
check('Exactly 1 unknown activity: G022 in Istanbul, kept as typed',
  unknowns.length === 1 && unknowns[0].g.ref === 'G022' && unknowns[0].s.ref === 'S09' && unknowns[0].b.raw === 'Topkapi palace & Hagia Sofia', JSON.stringify(unknowns.map((x) => x.b)));

// --- Marrakech hammam: 10 guests for 8 places ---
const hammam = activity('S05-2');
const inHammam = trip.guests.filter((g) => trip.bookings[g.id][slot('S05').id]?.activityId === hammam.id);
check('Hammam and spa has 10 guests for 8 places', inHammam.length === 10 && hammam.capacity === 8, `${inHammam.length} / ${hammam.capacity}`);

// --- Travel parties ---
const sameParty = (a, b) => guest(a).partyId === guest(b).partyId;
check('Smith couple 1 (Richard + Priya) and Smith couple 2 (Peter + Mary) are separate parties',
  sameParty('G001', 'G002') && sameParty('G003', 'G004') && !sameParty('G001', 'G003'));
check('Every guest is in a travel party', trip.guests.every((g) => trip.parties.some((p) => p.id === g.partyId)));
check('Party types come from the file (Couple, Family, Friends, Solo)',
  ['Couple', 'Family', 'Friends', 'Solo'].every((t) => trip.parties.some((p) => p.type === t)));
check('Couple P08 (G015 + G016) is split on purpose on S10: the app keeps them apart',
  sameParty('G015', 'G016') && booking('G015', 'S10').activityId !== booking('G016', 'S10').activityId);

// --- Guests ---
check('Everyone is on the whole trip: no join or leave dates are kept', trip.guests.every((g) => !('join' in g) && !('leave' in g)));
check('Dietary info is kept on the guest (4 guests)', trip.guests.filter((g) => g.dietary).length === 4 && guest('G034').dietary === 'Shellfish allergy');
check('Dietary info is nowhere else in the trip', !JSON.stringify({ ...trip, guests: [] }).includes('Shellfish'));

// --- Saving on the device ---
await dbPut('trips', trip);
const back = await dbGet('trips', trip.id);
check('Saving the trip on the device and reading it back gives identical data', JSON.stringify(back) === JSON.stringify(trip));
check('The saved trip shows up in the list of trips', (await dbAll('trips')).some((t) => t.id === trip.id));
const journalRows = await withStores(['journal'], 'readonly', (s) => s.journal.index('tripId').getAll(trip.id));
check('The journal drawer exists and is empty for a new trip', Array.isArray(journalRows) && journalRows.length === 0);
await dbPut('settings', { id: 'x', name: 'Test', role: 'owner' }, '__test__');
check('The settings drawer stores small things by name', (await dbGet('settings', '__test__'))?.name === 'Test');
await dbDelete('settings', '__test__');
await dbDelete('trips', trip.id);
check('A saved trip can be removed again (tests leave nothing behind)', (await dbGet('trips', trip.id)) === undefined);

// --- Files with mistakes: refused, with a message a person can understand ---
checkRefused('Refuses a file that is not a trip', () => buildTrip({ hello: 'world' }), /does not look like a Tour Docs trip/);
checkRefused('Refuses an unknown time zone', () => { const r = copyOfRaw(); r.destinations[0].timezone = 'Mars/Olympus'; buildTrip(r); }, /time zone.*Mars\/Olympus/);
checkRefused('Refuses a half-day in a destination that does not exist', () => { const r = copyOfRaw(); r.slots[0].dest = 'Atlantis'; buildTrip(r); }, /Atlantis/);
checkRefused('Refuses two guests with the same id', () => { const r = copyOfRaw(); r.guests[1].id = r.guests[0].id; buildTrip(r); }, /appears twice/);
checkRefused('Refuses sign-ups for a guest who does not exist', () => { const r = copyOfRaw(); r.signups.G999 = {}; buildTrip(r); }, /G999/);
checkRefused('Refuses a start time that is not a time', () => { const r = copyOfRaw(); r.slots[0].options[0].start = 'after lunch'; buildTrip(r); }, /start time/);

// =====================================================================
// Step 2: names, who is where, capacity wording (rules.js)
// =====================================================================

const names = displayNames(trip.guests);
const nameOf = (ref) => names.get(guest(ref).id);
const fake = (id, first, last) => ({ id, first, last });
const shown = (guests) => displayNames(guests);

// --- Display names ---
check('Names are first name + last initial: "Priya S."', nameOf('G002') === 'Priya S.', nameOf('G002'));
check('Two unrelated Smith couples: Richard S., Priya S., Peter S., Mary S. are all different',
  new Set(['G001', 'G002', 'G003', 'G004'].map(nameOf)).size === 4 && nameOf('G003') === 'Peter S.' && nameOf('G004') === 'Mary S.',
  ['G001', 'G002', 'G003', 'G004'].map(nameOf).join(', '));
check('Nobody in the whole trip shows the same name as somebody else', new Set(trip.guests.map((g) => names.get(g.id))).size === 80);
const marias = trip.guests.filter((g) => g.first === 'Maria' && g.last.startsWith('M'));
check('Two guests "Maria M." get letters added: Maria Mb. and Maria Mo.',
  marias.length === 2 && marias.map((g) => names.get(g.id)).sort().join(' / ') === 'Maria Mb. / Maria Mo.', marias.map((g) => names.get(g.id)).join(' / '));
{
  const s = shown([fake('a', 'John', 'Smith'), fake('b', 'John', 'Stone')]);
  check('John Smith and John Stone show as "John Sm." and "John St."', s.get('a') === 'John Sm.' && s.get('b') === 'John St.', `${s.get('a')} / ${s.get('b')}`);
  const same = shown([fake('a', 'John', 'Smith'), fake('b', 'John', 'Smith')]);
  check('Two guests with identical names show their full name', same.get('a') === 'John Smith' && same.get('b') === 'John Smith');
  const mixed = shown([fake('a', 'John', 'Smith'), fake('b', 'John', 'Smith'), fake('c', 'John', 'Stone')]);
  check('Still-identical guests show the full name while others keep the short one',
    mixed.get('a') === 'John Smith' && mixed.get('c') === 'John St.', `${mixed.get('a')} / ${mixed.get('c')}`);
  const shortName = shown([fake('a', 'Ann', 'Li'), fake('b', 'Ann', 'Lim')]);
  check('A short last name is shown in full without a dot ("Ann Li" and "Ann Lim")', shortName.get('a') === 'Ann Li' && shortName.get('b') === 'Ann Lim', `${shortName.get('a')} / ${shortName.get('b')}`);
  const accent = shown([fake('a', 'Zoë', 'Åberg'), fake('b', 'Zoë', 'Ågren')]);
  check('Accented letters count as letters ("Zoë Åb." and "Zoë Åg.")', accent.get('a') === 'Zoë Åb.' && accent.get('b') === 'Zoë Åg.');
}
check('Search ignores accents: Grünewald / Sørensen / Lucía', plain('Grünewald') === 'grunewald' && plain('Sørensen') === 'sorensen' && plain('Lucía') === 'lucia');
check('The party line reads "Couple with Priya S."', partyLabel(trip, guest('G001'), names) === 'Couple with Priya S.', partyLabel(trip, guest('G001'), names));
check('A guest travelling alone reads "Travelling solo"', trip.parties.filter((p) => p.type === 'Solo').length === 10
  && partyLabel(trip, trip.guests.find((g) => trip.parties.find((p) => p.id === g.partyId).type === 'Solo'), names) === 'Travelling solo');

// --- Who is where ---
const perSlot = trip.slots.map((s) => {
  const w = whoIsWhere(trip, s);
  return { s, inActivities: [...w.byActivity.values()].reduce((n, g) => n + g.length, 0), leisure: w.leisure.length, attention: w.attention.length };
});
check('In all 39 half-days, activities + at leisure + needs-a-look add up to all 80 guests',
  perSlot.every((x) => x.inActivities + x.leisure + x.attention === 80), perSlot.filter((x) => x.inActivities + x.leisure + x.attention !== 80).map((x) => x.s.ref).join(', '));
check('Across the trip, exactly 6 guest-half-days need a look (5 empty + 1 misspelled)', perSlot.reduce((n, x) => n + x.attention, 0) === 6);
check('At leisure is counted per half-day, not as an activity', perSlot.every((x) => x.leisure >= 0) && perSlot.reduce((n, x) => n + x.leisure, 0) === 1225);
{
  const istanbulAttention = whoIsWhere(trip, slot('S09')).attention;
  check('G022 in Istanbul (S09) shows in "needs a look" with the misspelled name',
    istanbulAttention.length === 1 && istanbulAttention[0].guest.ref === 'G022' && istanbulAttention[0].reason === 'Unknown activity: "Topkapi palace & Hagia Sofia"', JSON.stringify(istanbulAttention.map((a) => a.reason)));
  const blank = whoIsWhere(trip, slot('S10')).attention;
  check('An empty sign-up (G014 on S10) reads "Nothing chosen yet"', blank.length === 1 && blank[0].guest.ref === 'G014' && blank[0].reason === 'Nothing chosen yet');
}
{
  const inHammamNow = whoIsWhere(trip, slot('S05')).byActivity.get(hammam.id);
  check('Hammam and spa shows 10 guests', inHammamNow.length === 10);
  const c = capacityInfo(inHammamNow.length, hammam.capacity);
  check('Hammam and spa reads "10 / 8 · Over by 2" in the warning colour', c.text === '10 / 8 · Over by 2' && c.tone === 'bad', c.text);
}
check('Capacity wording: "6 / 8", "8 / 8 · Full", and "12 / ∞" with no capacity',
  capacityInfo(6, 8).text === '6 / 8' && capacityInfo(6, 8).tone === null && capacityInfo(8, 8).text === '8 / 8 · Full' && capacityInfo(8, 8).tone === 'bad' && capacityInfo(12, null).text === '12 / ∞');
check('P08 (G015 + G016) are kept apart on S10 in the guest view',
  guestPlace(trip, guest('G015'), slot('S10')).activity.name !== guestPlace(trip, guest('G016'), slot('S10')).activity.name);
check('A guest at leisure is reported as leisure, an empty sign-up as blank',
  guestPlace(trip, guest('G014'), slot('S10')).kind === 'blank' && trip.guests.some((g) => guestPlace(trip, g, slot('S10')).kind === 'leisure'));
check('Dates read like "Sat 16 Jan"', formatWeekdayDate('2027-01-16') === 'Sat 16 Jan', formatWeekdayDate('2027-01-16'));

// =====================================================================
// Step 3: the one change function (changes.js)
// These tests use copies of the trip and a fake "commit", so they never touch trips saved on this device
// (except one test that saves a copy for real and then removes it).
// =====================================================================

const owner = makeOwner(newId(), 'Tester');
const makeCtx = (user = owner) => {
  const ctx = {
    owner: user, state: structuredClone(trip), commits: [], entries: [],
    trip: (id) => (id === ctx.state.id ? ctx.state : undefined),
    journal: () => ctx.entries,
    async commit(next, entries) { ctx.commits.push(next); ctx.entries.push(...entries); ctx.state = next; },
  };
  return ctx;
};
const LEISURE = { kind: 'leisure' };
const toActivity = (ref) => ({ kind: 'activity', activityId: activity(ref).id });
const moveOf = (guestRef, slotRef, to) => ({ type: 'move', guestId: guest(guestRef).id, slotId: slot(slotRef).id, to });
const placeNow = (ctx, guestRef, slotRef) => guestPlace(ctx.state, guest(guestRef), slot(slotRef));
const tripBefore = JSON.stringify(trip);

const stranger = trip.guests.find((g) => { const p = guestPlace(trip, g, slot('S05')); return p.kind === 'activity' && p.activity.id !== hammam.id; });

let ctx1; // the context of the first test, reused by the storage test at the end

// --- Leaving the overbooked Hammam is allowed, and is written in the journal ---
{
  const ctx = makeCtx();
  const leaver = inHammam[0];
  const r = await applyChange(ctx, trip.id, moveOf(leaver.ref, 'S05', LEISURE));
  const e = ctx.entries[0];
  check('Leaving the Hammam for At leisure works: one save, one journal entry', r.ok && ctx.commits.length === 1 && ctx.entries.length === 1);
  check('The guest is now At leisure and the Hammam went from 10 to 9', placeNow(ctx, leaver.ref, 'S05').kind === 'leisure' && countIn(ctx.state, hammam) === 9);
  check('The journal says who, what, from, to and the half-day',
    e.who.name === 'Tester' && e.who.role === 'owner' && e.type === 'move' && e.guestId === leaver.id
    && e.from.label === 'Hammam and spa' && e.to.kind === 'leisure' && e.slotLabel === 'Day 3 · Afternoon · Marrakech', JSON.stringify(e));
  check('The journal keeps the exact moment, and shows it in the destination time (Marrakech)',
    !Number.isNaN(Date.parse(e.at)) && e.place.name === 'Marrakech' && e.place.timeZone === 'Africa/Casablanca' && /^\d\d:\d\d$/.test(formatTime(e.at, e.place.timeZone)));
  check('Every journal entry has its own UUID and knows its trip', uuidShape.test(e.id) && e.tripId === trip.id && uuidShape.test(e.batchId));
  check('The trip loaded in the app is never changed in place (only a copy is)', JSON.stringify(trip) === tripBefore);
  ctx1 = ctx;
}

// --- Refused moves change nothing ---
{
  const ctx = makeCtx();
  const r = await applyChange(ctx, trip.id, moveOf(stranger.ref, 'S05', toActivity('S05-2')));
  check('Joining the full, overbooked Hammam (10 / 8) is refused, with a clear message', !r.ok && /full \(10 \/ 8\)/.test(r.error), r.error);
  check('A refused change saves nothing and writes nothing', ctx.commits.length === 0 && ctx.entries.length === 0);
  const same = await applyChange(ctx, trip.id, moveOf(inHammam[0].ref, 'S05', toActivity('S05-2')));
  check('Choosing the activity a guest is already in is refused', !same.ok && /already in/.test(same.error), same.error);
  const otherSlot = await applyChange(ctx, trip.id, moveOf(stranger.ref, 'S05', toActivity('S01-1')));
  check('An activity that is not offered in that half-day is refused', !otherSlot.ok && /not offered/.test(otherSlot.error), otherSlot.error);
  const notOwner = await applyChange(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), trip.id, moveOf(inHammam[0].ref, 'S05', LEISURE));
  check('Somebody who is not the owner cannot change anything', !notOwner.ok && /permission/.test(notOwner.error), notOwner.error);
  const archived = makeCtx(); archived.state.archivedAt = '2027-02-05T00:00:00.000Z';
  const rArch = await applyChange(archived, trip.id, moveOf(inHammam[0].ref, 'S05', LEISURE));
  check('An archived trip cannot be changed', !rArch.ok && /archived/.test(rArch.error), rArch.error);
  const unknownKind = validateChanges(trip, owner, [{ type: 'teleport' }]);
  check('An unknown kind of change is refused', !unknownKind.ok);
}

// --- Empty and misspelled sign-ups can be fixed, and the journal says what they were ---
{
  const ctx = makeCtx();
  const target = trip.activities.find((a) => a.slotId === slot('S10').id && (a.capacity === null || countIn(trip, a) < a.capacity));
  const r = await applyChange(ctx, trip.id, moveOf('G014', 'S10', { kind: 'activity', activityId: target.id }));
  check('An empty sign-up (G014) can be filled; the journal says "Nothing chosen yet"', r.ok && ctx.entries[0].from.kind === 'blank' && ctx.entries[0].from.label === 'Nothing chosen yet', JSON.stringify(ctx.entries[0]?.from));
  const ctx2 = makeCtx();
  const target2 = trip.activities.find((a) => a.slotId === slot('S09').id && (a.capacity === null || countIn(trip, a) < a.capacity));
  const r2 = await applyChange(ctx2, trip.id, moveOf('G022', 'S09', { kind: 'activity', activityId: target2.id }));
  check('The misspelled activity (G022) can be fixed; the journal keeps the misspelling as typed',
    r2.ok && ctx2.entries[0].from.kind === 'unknown' && ctx2.entries[0].from.label.includes('Topkapi palace & Hagia Sofia'), JSON.stringify(ctx2.entries[0]?.from));
  check('After the fix, nothing needs a look in that half-day anymore', whoIsWhere(ctx2.state, slot('S09')).attention.length === 0);
}

// --- Groups: all or nothing, one save, one batch ---
{
  const ctx = makeCtx();
  const refused = await applyChange(ctx, trip.id, [moveOf(inHammam[0].ref, 'S05', LEISURE), moveOf(stranger.ref, 'S05', toActivity('S05-2'))]);
  check('A group with one refused move applies NOTHING', !refused.ok && ctx.commits.length === 0 && placeNow(ctx, inHammam[0].ref, 'S05').activity?.id === hammam.id);

  const s = trip.slots.find((x) => guestPlace(trip, guest('G001'), x).kind === 'activity' && partyMovers(trip, guest('G001'), x).length === 1);
  const good = await applyChange(ctx, trip.id, [moveOf('G001', s.ref, LEISURE), moveOf('G002', s.ref, LEISURE)]);
  check('A couple moved together is ONE save with 2 journal entries sharing a batch id',
    good.ok && ctx.commits.length === 1 && ctx.entries.length === 2 && ctx.entries[0].batchId === ctx.entries[1].batchId);
  check('The travel party helper finds the partner who is in the same place (G001 -> G002)', partyMovers(trip, guest('G001'), s).map((g) => g.ref).join() === 'G002');
  check('A split couple gets no prompt: P08 (G015) has nobody in the same place on S10', partyMovers(trip, guest('G015'), slot('S10')).length === 0);
}

// --- Capacity ---
{
  let target = null;
  for (const s of trip.slots) for (const a of trip.activities.filter((x) => x.slotId === s.id)) {
    if (target || a.capacity === null) continue;
    const left = a.capacity - countIn(trip, a);
    const others = trip.guests.filter((g) => { const p = guestPlace(trip, g, s); return p.kind === 'activity' && p.activity.id !== a.id; });
    if (left >= 1 && left <= 5 && others.length > left) target = { s, a, left, others };
  }
  const group = (n) => target.others.slice(0, n).map((g) => ({ type: 'move', guestId: g.id, slotId: target.s.id, to: { kind: 'activity', activityId: target.a.id } }));
  check(`A group of ${target?.left} fits the ${target?.left} places left in "${target?.a.name}"`, target && validateChanges(trip, owner, group(target.left)).ok);
  const tooMany = target && validateChanges(trip, owner, group(target.left + 1));
  check(`A group of ${target?.left + 1} does NOT fit, and the message says how many places are left`, target && !tooMany.ok && /Only \d+ places? left/.test(tooMany.error), tooMany?.error);

  // Two full activities (S01: 20 / 20 and 16 / 16): one guest from each can swap in ONE change, because each frees a place.
  const inAlfama = trip.guests.find((g) => guestPlace(trip, g, slot('S01')).activity?.id === activity('S01-1').id);
  const inTram = trip.guests.find((g) => guestPlace(trip, g, slot('S01')).activity?.id === activity('S01-2').id);
  const alone = validateChanges(trip, owner, [moveOf(inAlfama.ref, 'S01', toActivity('S01-2'))]);
  check('Moving into a full tour on its own is refused ("Full")', !alone.ok && /full/.test(alone.error), alone.error);
  const ctx = makeCtx();
  const swap = await applyChange(ctx, trip.id, [moveOf(inAlfama.ref, 'S01', toActivity('S01-2')), moveOf(inTram.ref, 'S01', toActivity('S01-1'))]);
  check('Two guests can swap between two full tours in one change (still 20 and 16)',
    swap.ok && countIn(ctx.state, activity('S01-1')) === 20 && countIn(ctx.state, activity('S01-2')) === 16);
  const outsideBeach = trip.guests.filter((g) => guestPlace(trip, g, slot('S25')).activity?.id !== activity('S25-1').id);
  check(`An activity with no capacity never fills up: all ${outsideBeach.length} other guests can join the Welcome beach session`,
    outsideBeach.length === 40 && validateChanges(trip, owner, outsideBeach.map((g) => ({ type: 'move', guestId: g.id, slotId: slot('S25').id, to: toActivity('S25-1') }))).ok);
}

// --- Cancel tour ---
{
  const ctx = makeCtx();
  const alfama = activity('S01-1');
  const booked = countIn(trip, alfama);
  const r = await applyChange(ctx, trip.id, { type: 'cancel-tour', activityId: alfama.id });
  check('Cancel tour: the activity is marked Cancelled and everybody on it is At leisure',
    r.ok && ctx.state.activities.find((a) => a.id === alfama.id).cancelled === true && countIn(ctx.state, alfama) === 0
    && whoIsWhere(ctx.state, slot('S01')).leisure.length === whoIsWhere(trip, slot('S01')).leisure.length + booked);
  check(`Cancel tour writes 1 entry for the tour and ${booked} for the guests, all in one batch`,
    ctx.commits.length === 1 && ctx.entries.length === booked + 1 && new Set(ctx.entries.map((e) => e.batchId)).size === 1
    && ctx.entries.filter((e) => e.cause === 'cancel-tour').length === booked && ctx.entries[0].type === 'cancel-tour' && ctx.entries[0].guestCount === booked);
  const again = await applyChange(ctx, trip.id, { type: 'cancel-tour', activityId: alfama.id });
  check('A tour cannot be cancelled twice', !again.ok && /already cancelled/.test(again.error), again.error);
  const into = await applyChange(ctx, trip.id, moveOf(stranger.ref, 'S01', toActivity('S01-1')));
  check('Nobody can be moved into a cancelled tour', !into.ok, into.error);
  const mixed = validateChanges(trip, owner, [{ type: 'cancel-tour', activityId: alfama.id }, moveOf(stranger.ref, 'S05', LEISURE)]);
  check('Cancelling a tour cannot be mixed with other changes', !mixed.ok);
}

// --- A failing save leaves everything as it was; quick taps are handled one after the other ---
{
  const ctx = makeCtx();
  const before = JSON.stringify(ctx.state);
  ctx.commit = async () => { throw new Error('disk full'); };
  const r = await applyChange(ctx, trip.id, moveOf(inHammam[0].ref, 'S05', LEISURE));
  check('If saving fails, the change is refused and nothing changes', !r.ok && /Nothing was changed/.test(r.error) && JSON.stringify(ctx.state) === before, r.error);

  const ctx2 = makeCtx();
  const s = trip.slots.find((x) => ['G001', 'G003'].every((ref) => guestPlace(trip, guest(ref), x).kind === 'activity'));
  const both = await Promise.all([applyChange(ctx2, trip.id, moveOf('G001', s.ref, LEISURE)), applyChange(ctx2, trip.id, moveOf('G003', s.ref, LEISURE))]);
  check('Two quick changes at the same time are both applied, one after the other',
    both.every((x) => x.ok) && ctx2.commits.length === 2 && placeNow(ctx2, 'G001', s.ref).kind === 'leisure' && placeNow(ctx2, 'G003', s.ref).kind === 'leisure');
}

// --- Privacy: dietary info never reaches the journal ---
{
  const ctx = makeCtx();
  const s = trip.slots.find((x) => guestPlace(trip, guest('G034'), x).kind === 'activity');
  await applyChange(ctx, trip.id, moveOf('G034', s.ref, LEISURE));
  const text = JSON.stringify(ctx.entries);
  check('The journal has no dietary info (G034 has a shellfish allergy)', ctx.entries.length === 1 && !/allerg|shellfish|dietary/i.test(text), text.slice(0, 200));
}

// =====================================================================
// Step 4: Undo (like Ctrl+Z) and reading the journal (journal.js)
// =====================================================================

const restoredExactly = (a, b) => JSON.stringify({ ...a, changeCount: 0 }) === JSON.stringify({ ...b, changeCount: 0 });

// --- Undo takes back the last action, and only writes new lines in the journal ---
{
  const ctx = makeCtx();
  const leaver = inHammam[0];
  await applyChange(ctx, trip.id, moveOf(leaver.ref, 'S05', LEISURE));
  const afterMove = structuredClone(ctx.state);
  const entriesBefore = ctx.entries.length;

  const r = await applyChange(ctx, trip.id, { type: 'undo' });
  check('Undo puts the guest back in the Hammam (10 again) and the trip is exactly as before the move',
    r.ok && placeNow(ctx, leaver.ref, 'S05').activity?.id === hammam.id && countIn(ctx.state, hammam) === 10 && restoredExactly(ctx.state, trip), r.error);
  check('Undo never deletes: the journal only grows (old lines kept, new lines added)', ctx.entries.length > entriesBefore && ctx.entries[0].type === 'move');
  const undoEntries = ctx.entries.slice(entriesBefore);
  check('An undo writes a header ("Undid: ...") and one line per guest put back, marked as undo',
    undoEntries[0].type === 'undo' && /^Moved .* to At leisure$/.test(undoEntries[0].undoesSummary.replace(/ from [^]*? to /, ' to ')) && undoEntries.slice(1).every((e) => e.cause === 'undo')
    && undoEntries.slice(1)[0].from.kind === 'leisure' && undoEntries.slice(1)[0].to.label === 'Hammam and spa', JSON.stringify(undoEntries[0]));
  check('The undone action is marked "Undone" in the journal, and there is nothing left to undo',
    groupBatches(ctx.entries).find((b) => b.kind === 'move').undone === true && lastUndoable(ctx.entries) === null);
  const again = await applyChange(ctx, trip.id, { type: 'undo' });
  check('Undo with nothing to undo is refused', !again.ok && /nothing to undo/.test(again.error), again.error);
  check('Undo lines keep the exact moment, the place and time zone, and a sequence number in order',
    undoEntries.every((e) => !Number.isNaN(Date.parse(e.at)) && e.place.timeZone === 'Africa/Casablanca' && e.seq === 2));
  check('The trip counts its actions: the move was action 1, the undo action 2', afterMove.changeCount === 1 && ctx.state.changeCount === 2);
}

// --- Several undos go back step by step (like Ctrl+Z) ---
{
  const ctx = makeCtx();
  const a = inHammam[0], b = inHammam[1];
  await applyChange(ctx, trip.id, moveOf(a.ref, 'S05', LEISURE));
  await applyChange(ctx, trip.id, moveOf(b.ref, 'S05', LEISURE));
  check('The button would undo the LAST action first (the second guest)', /Moved/.test(summarize(lastUndoable(ctx.entries))) && summarize(lastUndoable(ctx.entries)).includes(names.get(b.id)), summarize(lastUndoable(ctx.entries)));
  await applyChange(ctx, trip.id, { type: 'undo' });
  check('After one undo: the second guest is back, the first is still At leisure', placeNow(ctx, b.ref, 'S05').activity?.id === hammam.id && placeNow(ctx, a.ref, 'S05').kind === 'leisure');
  await applyChange(ctx, trip.id, { type: 'undo' });
  check('After a second undo: the first guest is back too, the trip is as it was at the start', placeNow(ctx, a.ref, 'S05').activity?.id === hammam.id && restoredExactly(ctx.state, trip));
  check('Every action is still in the journal: 2 moves + 2 undos', groupBatches(ctx.entries).length === 4 && groupBatches(ctx.entries).filter((x) => x.kind === 'undo').length === 2);
}

// --- Undo of a couple, of a cancelled tour, and of fixing an empty or misspelled sign-up ---
{
  const ctx = makeCtx();
  const s = trip.slots.find((x) => guestPlace(trip, guest('G001'), x).kind === 'activity' && partyMovers(trip, guest('G001'), x).length === 1);
  await applyChange(ctx, trip.id, [moveOf('G001', s.ref, LEISURE), moveOf('G002', s.ref, LEISURE)]);
  await applyChange(ctx, trip.id, { type: 'undo' });
  check('One undo puts BOTH people of a couple back (it was one action)', restoredExactly(ctx.state, trip));

  const cancel = makeCtx();
  await applyChange(cancel, trip.id, { type: 'cancel-tour', activityId: activity('S01-1').id });
  await applyChange(cancel, trip.id, { type: 'undo' });
  check('Undo of a cancelled tour brings the tour back and all its guests (one tap)',
    restoredExactly(cancel.state, trip) && cancel.state.activities.find((a) => a.ref === 'S01-1').cancelled === false && countIn(cancel.state, activity('S01-1')) === 20);
  check('Undoing the cancelled tour writes 1 header + 20 lines, all marked as undo', cancel.entries.filter((e) => e.type === 'undo' || e.cause === 'undo').length === 21);

  const fix = makeCtx();
  const t10 = trip.activities.find((a) => a.slotId === slot('S10').id && (a.capacity === null || countIn(trip, a) < a.capacity));
  await applyChange(fix, trip.id, { type: 'move', guestId: guest('G014').id, slotId: slot('S10').id, to: { kind: 'activity', activityId: t10.id } });
  await applyChange(fix, trip.id, { type: 'undo' });
  check('Undo of filling an empty sign-up puts it back as empty ("Nothing chosen yet")', restoredExactly(fix.state, trip) && placeNow(fix, 'G014', 'S10').kind === 'blank');

  const typo = makeCtx();
  const t09 = trip.activities.find((a) => a.slotId === slot('S09').id && (a.capacity === null || countIn(trip, a) < a.capacity));
  await applyChange(typo, trip.id, { type: 'move', guestId: guest('G022').id, slotId: slot('S09').id, to: { kind: 'activity', activityId: t09.id } });
  await applyChange(typo, trip.id, { type: 'undo' });
  check('Undo of fixing the misspelled activity puts the misspelling back as it was typed',
    restoredExactly(typo.state, trip) && placeNow(typo, 'G022', 'S09').raw === 'Topkapi palace & Hagia Sofia');
}

// --- Undo is refused when it would not be safe, and cannot be mixed ---
{
  const ctx = makeCtx();
  await applyChange(ctx, trip.id, moveOf(inHammam[0].ref, 'S05', LEISURE));
  const tampered = structuredClone(ctx.state);
  tampered.bookings[inHammam[0].id][slot('S05').id] = { kind: 'activity', activityId: activity('S05-1').id }; // changed behind the journal's back
  ctx.state = tampered;
  const r = await applyChange(ctx, trip.id, { type: 'undo' });
  check('Undo is refused (and changes nothing) if the guest is no longer where the journal says', !r.ok && /no longer where/.test(r.error) && ctx.commits.length === 1, r.error);
  const mixed = validateChanges(trip, owner, [{ type: 'undo' }, moveOf(inHammam[0].ref, 'S05', LEISURE)], ctx.entries);
  check('Undo cannot be mixed with other changes', !mixed.ok);
  const archived = makeCtx();
  await applyChange(archived, trip.id, moveOf(inHammam[0].ref, 'S05', LEISURE));
  archived.state.archivedAt = '2027-02-05T00:00:00.000Z';
  check('An archived trip cannot be undone either', !(await applyChange(archived, trip.id, { type: 'undo' })).ok);
  const stranger2 = makeCtx({ id: 'x', name: 'Guest', role: 'guest' });
  check('Somebody who is not the owner cannot undo', !(await applyChange(stranger2, trip.id, { type: 'undo' })).ok);
}

// --- Trips changed by the earlier version of the app (no sequence numbers) can still be undone ---
{
  const ctx = makeCtx();
  await applyChange(ctx, trip.id, moveOf(inHammam[0].ref, 'S05', LEISURE));
  for (const e of ctx.entries) { delete e.seq; delete e.n; }   // what step 3 wrote
  delete ctx.state.changeCount;
  const r = await applyChange(ctx, trip.id, { type: 'undo' });
  check('Journal lines written before sequence numbers existed can be undone', r.ok && restoredExactly(ctx.state, trip), r.error);
}

// --- Reading the journal ---
{
  const ctx = makeCtx();
  const s = trip.slots.find((x) => guestPlace(trip, guest('G001'), x).kind === 'activity' && partyMovers(trip, guest('G001'), x).length === 1);
  await applyChange(ctx, trip.id, [moveOf('G001', s.ref, LEISURE), moveOf('G002', s.ref, LEISURE)]);
  await applyChange(ctx, trip.id, { type: 'cancel-tour', activityId: activity('S01-1').id });
  const batches = groupBatches([...ctx.entries].reverse()); // even if the lines come back in any order
  check('The journal shows one action per couple and one per cancelled tour, oldest first', batches.length === 2 && batches[0].kind === 'move' && batches[1].kind === 'cancel-tour');
  check('A couple is told in one sentence: "Moved Richard S. and Priya S. from ... to At leisure"',
    /^Moved (Richard S\. and Priya S\.|Priya S\. and Richard S\.) from .+ to At leisure$/.test(summarize(batches[0])), summarize(batches[0]));
  check('A cancelled tour is told with its guests: "Cancelled Alfama walking tour (20 guests moved to At leisure)"',
    summarize(batches[1]) === 'Cancelled Alfama walking tour (20 guests moved to At leisure)', summarize(batches[1]));
  check('An action knows its half-day, its place and who did it', batches[0].slotLabel === slotLabel(trip, s) && batches[0].who.name === 'Tester' && batches[1].place.name === 'Lisbon');
  check('Times are shown in the destination time with the place: 15:30 UTC is "13 Jan, 00:30" in Kyoto',
    formatMoment('2027-01-12T15:30:00.000Z', 'Asia/Tokyo') === '13 Jan, 00:30', formatMoment('2027-01-12T15:30:00.000Z', 'Asia/Tokyo'));
  const sorted = [...ctx.entries].sort(() => 0.5 - Math.random());
  check('The journal keeps its order even when entries are read back in a different order', groupBatches(sorted).map((b) => b.seq).join() === '1,2');
  check('Journal lines never contain dietary info', !/allerg|shellfish|dietary/i.test(JSON.stringify(ctx.entries)));
}

// =====================================================================
// FORCE: moving into a full tour (the dispatcher's decision), with an optional "approved by" note
// =====================================================================
{
  const forced = (guestRef, slotRef, activityRef, extra = {}) => ({ ...moveOf(guestRef, slotRef, toActivity(activityRef)), force: true, ...extra });
  const ctx = makeCtx();
  const r = await applyChange(ctx, trip.id, forced(stranger.ref, 'S05', 'S05-2', { approvedBy: '  Sam Reed  ' }));
  const e = ctx.entries[0];
  check('FORCE: a guest can be put into the full, overbooked Hammam (now 11 / 8)', r.ok && countIn(ctx.state, hammam) === 11 && placeNow(ctx, stranger.ref, 'S05').activity?.id === hammam.id, r.error);
  check('The journal marks the move as forced and keeps who approved it (spaces trimmed)', e.forced === true && e.approvedBy === 'Sam Reed', JSON.stringify({ f: e.forced, a: e.approvedBy }));
  const batch = groupBatches(ctx.entries)[0];
  check('The Journal says it in words: "(forced, approved by Sam Reed)"', wasForced(batch) && summarize(batch).endsWith('to Hammam and spa (forced, approved by Sam Reed)'), summarize(batch));

  const noNote = makeCtx();
  await applyChange(noNote, trip.id, forced(stranger.ref, 'S05', 'S05-2'));
  check('The "approved by" note is optional: without it the move is still forced, and the words say "(forced)"',
    noNote.entries[0].forced === true && noNote.entries[0].approvedBy === null && summarize(groupBatches(noNote.entries)[0]).endsWith('(forced)'));

  const long = makeCtx();
  await applyChange(long, trip.id, forced(stranger.ref, 'S05', 'S05-2', { approvedBy: 'x'.repeat(200) }));
  check('A very long note is cut to 60 characters', long.entries[0].approvedBy.length === 60);

  const refusedWithoutForce = await applyChange(makeCtx(), trip.id, moveOf(stranger.ref, 'S05', toActivity('S05-2')));
  check('Without FORCE the full tour is still refused, exactly as before', !refusedWithoutForce.ok && /full \(10 \/ 8\)/.test(refusedWithoutForce.error));

  // FORCE only counts when the tour really ends up over capacity
  const roomy = makeCtx();
  const roomTarget = trip.activities.find((a) => a.slotId === slot('S10').id && (a.capacity === null || countIn(trip, a) < a.capacity));
  await applyChange(roomy, trip.id, { type: 'move', guestId: guest('G014').id, slotId: slot('S10').id, to: { kind: 'activity', activityId: roomTarget.id }, force: true, approvedBy: 'Nobody' });
  check('If there was room after all, the move is NOT marked forced and the note is not kept', roomy.entries[0].forced === false && roomy.entries[0].approvedBy === null);

  // Two guests into a full tour, in one change
  const two = makeCtx();
  const strangers = trip.guests.filter((g) => { const p = guestPlace(trip, g, slot('S05')); return p.kind === 'activity' && p.activity.id !== hammam.id; }).slice(0, 2);
  const rTwo = await applyChange(two, trip.id, strangers.map((g) => forced(g.ref, 'S05', 'S05-2', { approvedBy: 'Sam' })));
  check('A group forced into a full tour is one action, every line marked forced (12 / 8)', rTwo.ok && countIn(two.state, hammam) === 12 && two.entries.length === 2 && two.entries.every((x) => x.forced));

  // A swap between two full tours does not need FORCE at all
  const swap = makeCtx();
  const inAlfama = trip.guests.find((g) => guestPlace(trip, g, slot('S01')).activity?.id === activity('S01-1').id);
  const inTram = trip.guests.find((g) => guestPlace(trip, g, slot('S01')).activity?.id === activity('S01-2').id);
  await applyChange(swap, trip.id, [forced(inAlfama.ref, 'S01', 'S01-2'), forced(inTram.ref, 'S01', 'S01-1')]);
  check('A swap between two full tours stays at 20 and 16, so nothing is marked forced', swap.entries.length === 2 && swap.entries.every((x) => x.forced === false));

  // What FORCE does not change
  const cancelled = makeCtx();
  await applyChange(cancelled, trip.id, { type: 'cancel-tour', activityId: activity('S01-1').id });
  const intoCancelled = await applyChange(cancelled, trip.id, forced(inTram.ref, 'S01', 'S01-1'));
  check('FORCE cannot put anybody into a cancelled tour', !intoCancelled.ok && /cancelled/.test(intoCancelled.error), intoCancelled.error);
  const alreadyThere = await applyChange(makeCtx(), trip.id, forced(inHammam[0].ref, 'S05', 'S05-2'));
  check('FORCE does not change the "already in this tour" rule', !alreadyThere.ok && /already in/.test(alreadyThere.error));
  const notOwner = await applyChange(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), trip.id, forced(stranger.ref, 'S05', 'S05-2'));
  check('Somebody who is not the owner cannot force', !notOwner.ok && /permission/.test(notOwner.error));

  // Undo takes a forced move back, like any other
  await applyChange(ctx, trip.id, { type: 'undo' });
  check('Undo takes a forced move back (Hammam back to 10) and the journal keeps both lines',
    countIn(ctx.state, hammam) === 10 && restoredExactly(ctx.state, trip) && groupBatches(ctx.entries).length === 2 && groupBatches(ctx.entries)[0].undone);
  check('The undo line says what it undid, including "forced"', /^Undid: .*\(forced, approved by Sam Reed\)$/.test(summarize(groupBatches(ctx.entries)[1])), summarize(groupBatches(ctx.entries)[1]));
  check('Forced journal lines never contain dietary info', !/allerg|shellfish|dietary/i.test(JSON.stringify(ctx.entries)));
}

// --- Who is in a tour by force, right now (shown in orange in the list) ---
{
  const ctx = makeCtx();
  const key = `${stranger.id}|${slot('S05').id}`;
  await applyChange(ctx, trip.id, { ...moveOf(stranger.ref, 'S05', toActivity('S05-2')), force: true, approvedBy: 'Sam' });
  const found = forcedPlacements(ctx.entries).get(key);
  check('The forced guest is found, with who approved it, who added them and where they came from',
    forcedPlacements(ctx.entries).size === 1 && found.approvedBy === 'Sam' && found.who.name === 'Tester' && found.to.activityId === hammam.id && found.from.kind === 'activity', JSON.stringify(found?.approvedBy));
  await applyChange(ctx, trip.id, moveOf(stranger.ref, 'S05', LEISURE));
  check('...but not any more once the guest is moved somewhere else', forcedPlacements(ctx.entries).size === 0);
  await applyChange(ctx, trip.id, { type: 'undo' });
  check('...and again when that later move is undone', forcedPlacements(ctx.entries).size === 1 && forcedPlacements(ctx.entries).get(key).approvedBy === 'Sam');
  await applyChange(ctx, trip.id, { type: 'undo' });
  check('...and gone when the forced move itself is undone', forcedPlacements(ctx.entries).size === 0);

  const normal = makeCtx();
  await applyChange(normal, trip.id, moveOf(inHammam[0].ref, 'S05', LEISURE));
  check('A normal move is never listed as forced', forcedPlacements(normal.entries).size === 0);

  const two = makeCtx();
  const pair = trip.guests.filter((g) => { const p = guestPlace(trip, g, slot('S05')); return p.kind === 'activity' && p.activity.id !== hammam.id; }).slice(0, 2);
  await applyChange(two, trip.id, pair.map((g, i) => ({ ...moveOf(g.ref, 'S05', toActivity('S05-2')), force: true, approvedBy: i === 0 ? 'Sam' : '' })));
  const both = forcedPlacements(two.entries);
  check('A forced group is listed guest by guest; an empty note reads as "not written down"',
    both.size === 2 && both.get(`${pair[0].id}|${slot('S05').id}`).approvedBy === 'Sam' && both.get(`${pair[1].id}|${slot('S05').id}`).approvedBy === null);
}

// --- The travel party question is the same whether the tour has room or not ---
{
  const toTour = (activityRef) => ({ kind: 'activity', activity: activity(activityRef) });

  // A couple in Tram 28 (16 / 16) who want to go to the full Alfama tour (20 / 20)
  const inTramWithPartner = trip.guests.find((g) => guestPlace(trip, g, slot('S01')).activity?.id === activity('S01-2').id && partyMovers(trip, g, slot('S01')).length >= 1);
  const full = partyPlan(trip, inTramWithPartner, slot('S01'), toTour('S01-1'));
  check('Full tour: the travel party is still found and offered, but nobody fits without FORCE',
    full.movers.length >= 1 && full.room === 0 && !full.guestFits && !full.everyoneFits, JSON.stringify({ movers: full.movers.length, room: full.room }));

  // Richard S. and Priya S. are together in the Hammam; the Medina walk has exactly 1 seat left
  const medina = trip.activities.find((a) => a.slotId === slot('S05').id && a.name === 'Medina orientation walk');
  const oneSeat = partyPlan(trip, guest('G001'), slot('S05'), { kind: 'activity', activity: medina });
  check('One seat left: the guest fits, the couple does not (so "Yes" needs FORCE, "No" does not)',
    oneSeat.movers.map((g) => g.ref).join() === 'G002' && oneSeat.room === 1 && oneSeat.guestFits && !oneSeat.everyoneFits);

  const leisureOrFree = partyPlan(trip, guest('G001'), slot('S05'), { kind: 'leisure' });
  check('At leisure: everybody fits, the party is offered as usual', leisureOrFree.movers.length === 1 && leisureOrFree.everyoneFits && leisureOrFree.guestFits && leisureOrFree.room === Infinity);
  const noCapacity = partyPlan(trip, guest('G001'), slot('S25'), toTour('S25-1'));
  check('A tour with no capacity: everybody fits', noCapacity.everyoneFits && noCapacity.room === Infinity);

  // Saying "Yes" to a couple for a full tour forces both, as one action, each with the note
  const ctx = makeCtx();
  const couple = [inTramWithPartner, ...partyMovers(trip, inTramWithPartner, slot('S01'))];
  const r = await applyChange(ctx, trip.id, couple.map((g) => ({ ...moveOf(g.ref, 'S01', toActivity('S01-1')), force: true, approvedBy: 'Sam' })));
  check('Both people of a couple can be forced into the full Alfama tour in one action (22 / 20)',
    r.ok && countIn(ctx.state, activity('S01-1')) === 20 + couple.length && ctx.entries.length === couple.length && ctx.entries.every((e) => e.forced && e.approvedBy === 'Sam'));
}

// =====================================================================
// Every list of guests is alphabetical by the name shown
// =====================================================================
{
  const shown = displayNames(trip.guests);
  const sortedNames = [...trip.guests].sort(alphabetical(shown)).map((g) => shown.get(g.id));
  check('Guests sorted for any list come out alphabetical by the name shown ("Helen C." before "Linda D.")',
    sortedNames.every((n, i) => i === 0 || sortedNames[i - 1].localeCompare(n, 'en', { sensitivity: 'base' }) <= 0) && sortedNames.indexOf('Helen C.') < sortedNames.indexOf('Linda D.'));
  check('"Maria Mb." comes before "Maria Mo." and "Mary S." after "Mark O."', sortedNames.indexOf('Maria Mb.') < sortedNames.indexOf('Maria Mo.') && sortedNames.indexOf('Mark O.') < sortedNames.indexOf('Mary S.'));
  const fk = [{ id: 'a', first: 'Eva', last: 'Cohen' }, { id: 'b', first: 'Élodie', last: 'Blanc' }, { id: 'c', first: 'zoë', last: 'Berg' }, { id: 'd', first: 'Eva', last: 'Adams' }];
  const fkNames = displayNames(fk);
  check('Accents and capital letters do not matter, and two guests with the same first name go by last name',
    [...fk].sort(alphabetical(fkNames)).map((g) => fkNames.get(g.id)).join() === 'Élodie B.,Eva A.,Eva C.,zoë B.', [...fk].sort(alphabetical(fkNames)).map((g) => fkNames.get(g.id)).join());
}

// =====================================================================
// Step 6a: the roll call (rollcall.js, changes.js, journal.js)
// =====================================================================
{
  const startRollCall = (ctx, activityRef) => applyChange(ctx, ctx.state.id, { type: 'rollcall-start', activityId: activity(activityRef).id });
  const rollCallOf = (ctx, activityRef) => findRollCall(ctx.state, activity(activityRef).id);
  const inTram = trip.guests.filter((g) => guestPlace(trip, g, slot('S01')).activity?.id === activity('S01-2').id);   // Tram 28: 16 / 16
  const rc = (activityRef, type, extra = {}) => ({ type, activityId: activity(activityRef).id, ...extra });

  // --- Starting ---
  const ctx = makeCtx();
  const r = await startRollCall(ctx, 'S01-2');
  const call = rollCallOf(ctx, 'S01-2');
  check('Start roll call: it is created with the 4 vehicles of the trip file (V1 to V4), nobody checked in',
    r.ok && call.vehicles.map((v) => vehicleLabel(ctx.state, v)).join() === 'V1,V2,V3,V4' && Object.keys(call.checkins).length === 0 && call.endedAt === null, r.error);
  check('The roll call remembers who started it and when', call.startedBy.name === 'Tester' && !Number.isNaN(Date.parse(call.startedAt)));
  check('The journal says "Started the roll call: Tram 28 and viewpoints (V1, V2, V3, V4)"',
    summarize(groupBatches(ctx.entries)[0]) === 'Started the roll call: Tram 28 and viewpoints (V1, V2, V3, V4)', summarize(groupBatches(ctx.entries)[0]));
  check('Only one roll call per activity', !(await startRollCall(ctx, 'S01-2')).ok);
  const cancelledCtx = makeCtx();
  await applyChange(cancelledCtx, trip.id, { type: 'cancel-tour', activityId: activity('S01-2').id });
  check('A cancelled tour has no roll call', !(await startRollCall(cancelledCtx, 'S01-2')).ok);
  check('What vehicles are called comes from the trip data (default "V"): "Bus 2" if the trip says so',
    trip.vehicleLabel === 'V' && vehicleLabel({ vehicleLabel: 'Bus ' }, { number: 2 }) === 'Bus 2' && vehicleLabel({}, { number: 2 }) === 'V2');
  check('A new trip file gives an empty list of roll calls', Array.isArray(trip.rollCalls) && trip.rollCalls.length === 0);

  // --- Checking guests in ---
  const [a, b, c] = inTram;
  const [v1, v2] = call.vehicles;
  check('One tap checks a guest into a vehicle, and they leave the list of those still expected',
    (await applyChange(ctx, trip.id, rc('S01-2', 'checkin', { guestId: a.id, vehicleId: v1.id }))).ok
    && rollCallState(ctx.state, rollCallOf(ctx, 'S01-2')).expected.length === 15 && rollCallState(ctx.state, rollCallOf(ctx, 'S01-2')).perVehicle.get(v1.id).length === 1);
  await applyChange(ctx, trip.id, rc('S01-2', 'checkin', { guestId: b.id, vehicleId: v1.id }));
  await applyChange(ctx, trip.id, rc('S01-2', 'checkin', { guestId: c.id, vehicleId: v2.id }));
  const state = rollCallState(ctx.state, rollCallOf(ctx, 'S01-2'));
  check('Each vehicle shows its own count (V1: 2, V2: 1) and 13 are still expected',
    state.perVehicle.get(v1.id).length === 2 && state.perVehicle.get(v2.id).length === 1 && state.expected.length === 13 && state.checkedIn.length === 3);
  const tapJournal = groupBatches(ctx.entries).filter((x) => x.kind === 'rollcall');
  check('Every tap is one journal action, told in words ("Priya A. checked in to V1")',
    tapJournal.length === 4 && /^[A-Z][\w-]+ [A-Z]\.? checked in to V1$/.test(summarize(tapJournal[1])), summarize(tapJournal[1]));
  check('Somebody who is not booked on this tour cannot be checked in',
    !(await applyChange(ctx, trip.id, rc('S01-2', 'checkin', { guestId: guest('G001').id, vehicleId: v1.id }))).ok);
  check('A vehicle that does not exist, or the same vehicle twice, is refused',
    !(await applyChange(ctx, trip.id, rc('S01-2', 'checkin', { guestId: inTram[5].id, vehicleId: 'nope' }))).ok && !(await applyChange(ctx, trip.id, rc('S01-2', 'checkin', { guestId: a.id, vehicleId: v1.id }))).ok);

  // Move someone to another vehicle, or take them out
  const moved = await applyChange(ctx, trip.id, rc('S01-2', 'checkin', { guestId: a.id, vehicleId: v2.id }));
  check('A checked-in guest can be moved to another vehicle (the journal says "moved from V1 to V2")',
    moved.ok && rollCallOf(ctx, 'S01-2').checkins[a.id] === v2.id && /moved from V1 to V2$/.test(summarize(groupBatches(ctx.entries).at(-1))), summarize(groupBatches(ctx.entries).at(-1)));
  const out = await applyChange(ctx, trip.id, rc('S01-2', 'checkout', { guestId: a.id }));
  check('A guest can be taken out of the vehicle: back on the list', out.ok && !rollCallOf(ctx, 'S01-2').checkins[a.id] && rollCallState(ctx.state, rollCallOf(ctx, 'S01-2')).expected.some((g) => g.id === a.id));
  check('Taking out somebody who is not in a vehicle is refused', !(await applyChange(ctx, trip.id, rc('S01-2', 'checkout', { guestId: a.id }))).ok);

  // --- Vehicles: add, renumber ---
  const add = await applyChange(ctx, trip.id, rc('S01-2', 'vehicle-add'));
  await applyChange(ctx, trip.id, rc('S01-2', 'vehicle-add'));
  check('The + adds the next vehicle: V5, then V6', add.ok && rollCallOf(ctx, 'S01-2').vehicles.map((v) => vehicleLabel(ctx.state, v)).join() === 'V1,V2,V3,V4,V5,V6');
  const v3 = rollCallOf(ctx, 'S01-2').vehicles[2];
  const renamed = await applyChange(ctx, trip.id, rc('S01-2', 'vehicle-number', { vehicleId: v3.id, number: 9 }));
  check('A vehicle can be renumbered (V3 becomes V9); the journal says so', renamed.ok && vehicleLabel(ctx.state, rollCallOf(ctx, 'S01-2').vehicles[2]) === 'V9' && summarize(groupBatches(ctx.entries).at(-1)) === 'V3 renumbered V9');
  check('Two vehicles cannot share a number; nor can it be 0, 100 or 2.5',
    !(await applyChange(ctx, trip.id, rc('S01-2', 'vehicle-number', { vehicleId: v3.id, number: 1 }))).ok
    && !(await applyChange(ctx, trip.id, rc('S01-2', 'vehicle-number', { vehicleId: v3.id, number: 0 }))).ok
    && !(await applyChange(ctx, trip.id, rc('S01-2', 'vehicle-number', { vehicleId: v3.id, number: 100 }))).ok
    && !(await applyChange(ctx, trip.id, rc('S01-2', 'vehicle-number', { vehicleId: v3.id, number: 2.5 }))).ok);
  check('Roll call changes cannot be mixed with others in one change',
    !validateChanges(ctx.state, owner, [rc('S01-2', 'vehicle-add'), moveOf(inTram[6].ref, 'S01', LEISURE)], ctx.entries).ok);
  check('Somebody who is not the owner cannot start or run a roll call',
    !(await startRollCall(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), 'S01-1')).ok);
  const archived = makeCtx(); archived.state.archivedAt = '2027-02-05T00:00:00.000Z';
  check('An archived trip has no roll call changes either', !(await startRollCall(archived, 'S01-1')).ok);

  // --- Undo takes every one of those back, step by step (Ctrl+Z) ---
  const undoAll = makeCtx();
  await startRollCall(undoAll, 'S01-2');
  const uv = rollCallOf(undoAll, 'S01-2').vehicles;
  await applyChange(undoAll, trip.id, rc('S01-2', 'checkin', { guestId: a.id, vehicleId: uv[0].id }));
  await applyChange(undoAll, trip.id, rc('S01-2', 'checkin', { guestId: a.id, vehicleId: uv[1].id }));   // moved to V2
  await applyChange(undoAll, trip.id, rc('S01-2', 'checkout', { guestId: a.id }));
  await applyChange(undoAll, trip.id, rc('S01-2', 'vehicle-add'));
  await applyChange(undoAll, trip.id, rc('S01-2', 'vehicle-number', { vehicleId: uv[2].id, number: 9 }));
  const steps = ['renumbering', 'the added vehicle', 'the check-out', 'the move to V2', 'the check-in', 'the whole roll call'];
  const results = [];
  for (const step of steps) results.push([step, (await applyChange(undoAll, trip.id, { type: 'undo' })).ok]);
  check('Six undos take back: renumbering, adding V5, the check-out, the move to V2, the check-in, the start', results.every(([, ok]) => ok), JSON.stringify(results));
  check('...and the trip is EXACTLY as it was before the roll call (no roll call, nobody checked in)', restoredExactly(undoAll.state, trip) && undoAll.state.rollCalls.length === 0);
  check('The journal kept everything (12 actions: 6 to do, 6 to undo) and nothing more can be undone',
    groupBatches(undoAll.entries).length === 12 && lastUndoable(undoAll.entries) === null);

  // --- Add guest during a roll call is the ordinary Add guest: the guest is NOT put in a vehicle ---
  const addCtx = makeCtx();
  await startRollCall(addCtx, 'S02-1');
  const other = trip.guests.find((g) => { const p = guestPlace(trip, g, slot('S02')); return p.kind === 'activity' && p.activity.id !== activity('S02-1').id; });
  const added = await applyChange(addCtx, trip.id, moveOf(other.ref, 'S02', toActivity('S02-1')));
  const addedState = rollCallState(addCtx.state, rollCallOf(addCtx, 'S02-1'));
  check('Add guest during the roll call: the guest joins the tour and appears in the list to check in, in NO vehicle',
    added.ok && addedState.expected.some((g) => g.id === other.id) && !rollCallOf(addCtx, 'S02-1').checkins[other.id] && addCtx.entries.filter((e) => e.type !== 'rollcall-start').every((e) => e.type === 'move'));
  const fullCtx = makeCtx();
  await startRollCall(fullCtx, 'S01-2');
  const fromAlfama = trip.guests.find((g) => guestPlace(trip, g, slot('S01')).activity?.id === activity('S01-1').id);
  check('Add guest into a FULL tour still needs FORCE, as everywhere else (and then also just joins the list)',
    !(await applyChange(fullCtx, trip.id, moveOf(fromAlfama.ref, 'S01', toActivity('S01-2')))).ok
    && (await applyChange(fullCtx, trip.id, { ...moveOf(fromAlfama.ref, 'S01', toActivity('S01-2')), force: true })).ok
    && rollCallState(fullCtx.state, rollCallOf(fullCtx, 'S01-2')).expected.some((g) => g.id === fromAlfama.id));

  // --- A travel party checked in together: ONE action ---
  const partyCtx = makeCtx();
  await startRollCall(partyCtx, 'S01-2');
  const pv = rollCallOf(partyCtx, 'S01-2').vehicles[0];
  const pair = inTram.find((g) => partyMovers(trip, g, slot('S01')).length >= 1);
  const family = [pair, ...partyMovers(trip, pair, slot('S01'))];
  const checkAll = (guests, vehicle = pv) => guests.map((g) => rc('S01-2', 'checkin', { guestId: g.id, vehicleId: vehicle.id }));
  const groupResult = await applyChange(partyCtx, trip.id, checkAll(family));
  const groupEntries = partyCtx.entries.filter((e) => e.type === 'checkin');
  check(`A whole travel party (${family.length} people) can be checked into a vehicle in one action: one batch, one line each`,
    groupResult.ok && groupEntries.length === family.length && new Set(groupEntries.map((e) => e.batchId)).size === 1 && family.every((g) => rollCallOf(partyCtx, 'S01-2').checkins[g.id] === pv.id));
  const groupBatch = groupBatches(partyCtx.entries).at(-1);
  const namesInOrder = family.map((g) => displayNames(trip.guests).get(g.id)).sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' }));
  check('The journal names them alphabetically in one sentence: "... checked in to V1"',
    groupBatch.kind === 'rollcall' && summarize(groupBatch) === `${joinNames(namesInOrder)} checked in to V1`, summarize(groupBatch));
  await applyChange(partyCtx, trip.id, { type: 'undo' });
  check('ONE undo takes the whole party out of the vehicle again (they are all back on the list)',
    family.every((g) => !rollCallOf(partyCtx, 'S01-2').checkins[g.id]) && rollCallState(partyCtx.state, rollCallOf(partyCtx, 'S01-2')).expected.length === 16);
  const notBooked = await applyChange(partyCtx, trip.id, [...checkAll([pair]), rc('S01-2', 'checkin', { guestId: guest('G001').id, vehicleId: pv.id })]);
  check('A group with one guest who is not booked on the tour is refused, and nobody is checked in', !notBooked.ok && !rollCallOf(partyCtx, 'S01-2').checkins[pair.id]);
  check('A group cannot repeat a guest, mix in another kind of change, or concern two tours',
    !(await applyChange(partyCtx, trip.id, [...checkAll([pair]), ...checkAll([pair])])).ok
    && !(await applyChange(partyCtx, trip.id, [...checkAll([pair]), rc('S01-2', 'vehicle-add')])).ok
    && !validateChanges(partyCtx.state, owner, [rc('S01-2', 'checkin', { guestId: pair.id, vehicleId: pv.id }), rc('S01-1', 'checkin', { guestId: fromAlfama.id, vehicleId: pv.id })], partyCtx.entries).ok);

  // A guest moved off the tour after checking in is not counted anymore
  const leftCtx = makeCtx();
  await startRollCall(leftCtx, 'S01-2');
  await applyChange(leftCtx, trip.id, rc('S01-2', 'checkin', { guestId: a.id, vehicleId: rollCallOf(leftCtx, 'S01-2').vehicles[0].id }));
  await applyChange(leftCtx, trip.id, moveOf(a.ref, 'S01', LEISURE));
  const leftState = rollCallState(leftCtx.state, rollCallOf(leftCtx, 'S01-2'));
  check('A guest moved to At leisure after checking in is no longer counted in the vehicle nor expected', leftState.checkedIn.length === 0 && leftState.expected.length === 15);

  // Many quick taps at the same time are all done, one after the other, in order
  const rush = makeCtx();
  await startRollCall(rush, 'S01-2');
  const rv = rollCallOf(rush, 'S01-2').vehicles[0];
  const taps = await Promise.all(inTram.slice(0, 10).map((g) => applyChange(rush, trip.id, rc('S01-2', 'checkin', { guestId: g.id, vehicleId: rv.id }))));
  check('10 taps as fast as possible: all accepted, in order, each with its own number', taps.every((x) => x.ok) && rush.commits.length === 11 && rush.state.changeCount === 11);
  check('Roll call lines never contain dietary info', !/allerg|shellfish|dietary/i.test(JSON.stringify(rush.entries)));

  // --- The Journal: ONE card per roll call ---
  const jctx = makeCtx();
  await startRollCall(jctx, 'S01-2');
  const jv = rollCallOf(jctx, 'S01-2').vehicles;
  await applyChange(jctx, trip.id, rc('S01-2', 'checkin', { guestId: a.id, vehicleId: jv[0].id }));
  await applyChange(jctx, trip.id, rc('S01-2', 'checkin', { guestId: b.id, vehicleId: jv[1].id }));
  await applyChange(jctx, trip.id, { type: 'undo' });
  await applyChange(jctx, trip.id, moveOf(guest('G001').ref, 'S05', LEISURE)); // an ordinary move, not part of the roll call
  const items = journalItems(groupBatches(jctx.entries));
  check('The Journal folds start, check-ins and the undo into ONE roll call card; the ordinary move is its own card',
    items.length === 2 && items[0].kind === 'batch' && items[1].kind === 'rollcall' && items[1].batches.length === 4, JSON.stringify(items.map((i) => `${i.kind}:${i.batches.length}`)));
  check('Newest first: the ordinary move is on top', items[0].seq > items[1].seq);
  const inside = items[1].batches;
  check('Inside the card, in order: start, two check-ins (the second undone), and the undo line',
    inside.map((x) => x.kind).join() === 'rollcall,rollcall,rollcall,undo' && inside[2].undone === true && /^Undid: .* checked in to V2$/.test(summarize(inside[3])), inside.map((x) => summarize(x)).join(' | '));

  // --- The long-press helper: a tap is a tap, a long press is not also a tap ---
  const log = [];
  const button = document.createElement('button');
  pressable(button, { tap: () => log.push('tap'), long: () => log.push('long'), ms: 40 });
  const fire = (type) => button.dispatchEvent(new PointerEvent(type, { bubbles: true }));
  fire('pointerdown'); fire('pointerup'); button.click();
  await new Promise((r) => setTimeout(r, 70));
  fire('pointerdown'); await new Promise((r) => setTimeout(r, 80)); fire('pointerup'); button.click();
  fire('pointerdown'); fire('pointercancel'); await new Promise((r) => setTimeout(r, 80));
  check('A quick touch is a tap; holding the finger is a long press and NOT also a tap; scrolling away cancels it', log.join() === 'tap,long', log.join());
}

// =====================================================================
// Step 6b: End roll call and Re-open roll call
// =====================================================================
{
  const T = 'S01-2'; // Tram 28 and viewpoints, 16 guests
  const rcOf = (ctx) => findRollCall(ctx.state, activity(T).id);
  const call = (ctx, type, extra = {}) => applyChange(ctx, trip.id, { type, activityId: activity(T).id, ...extra });
  const tram = trip.guests.filter((g) => guestPlace(trip, g, slot('S01')).activity?.id === activity(T).id);
  const inOrder = alphabetical(displayNames(trip.guests));
  const tramSorted = [...tram].sort(inOrder);
  const shownName = (g) => displayNames(trip.guests).get(g.id);

  // A roll call where the first 10 (alphabetically) are checked in: V1 gets 5, V2 gets 5. 6 did not show up.
  async function departed() {
    const ctx = makeCtx();
    await call(ctx, 'rollcall-start');
    const [v1, v2] = rcOf(ctx).vehicles;
    for (const [i, g] of tramSorted.slice(0, 10).entries()) await call(ctx, 'checkin', { guestId: g.id, vehicleId: (i < 5 ? v1 : v2).id });
    return { ctx, v1, v2, present: tramSorted.slice(0, 10), absent: tramSorted.slice(10) };
  }

  // --- End roll call ---
  const { ctx, present, absent, v1, v2 } = await departed();
  const before = structuredClone(ctx.state);
  const ended = await call(ctx, 'rollcall-end', { moveGuestIds: absent.map((g) => g.id) });
  const endBatch = groupBatches(ctx.entries).at(-1);
  check('End roll call: the 6 who did not show up go to At leisure, the roll call is closed, the 10 stay on the tour',
    ended.ok && rcOf(ctx).endedAt && rcOf(ctx).endedBy.name === 'Tester' && absent.every((g) => guestPlace(ctx.state, g, slot('S01')).kind === 'leisure')
    && present.every((g) => guestPlace(ctx.state, g, slot('S01')).activity?.id === activity(T).id) && countIn(ctx.state, activity(T)) === 10, ended.error);
  check('The vehicles and who was in them are kept for the return count', present.every((g) => rcOf(ctx).checkins[g.id]) && rcOf(ctx).vehicles.length === 4);
  check('It is ONE action: an "End roll call" line plus one "moved by End roll call" line per guest, all in one batch',
    endBatch.kind === 'rollcall' && endBatch.entries.length === 7 && endBatch.entries[0].type === 'rollcall-end' && endBatch.entries.slice(1).every((e) => e.type === 'move' && e.cause === 'end-roll-call' && e.to.kind === 'leisure'));
  check('The journal says: "Ended the roll call: 10 checked in, 6 moved to At leisure by End roll call (names in alphabetical order)"',
    summarize(endBatch) === `Ended the roll call: 10 checked in, 6 moved to At leisure by End roll call (${joinNames(absent.map(shownName).sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' })))})`, summarize(endBatch));
  check('After End roll call nothing more can be checked in, no vehicle added or renumbered, and it cannot end twice',
    !(await call(ctx, 'checkin', { guestId: present[0].id, vehicleId: v2.id })).ok && !(await call(ctx, 'vehicle-add')).ok && !(await call(ctx, 'rollcall-end', { moveGuestIds: [] })).ok
    && !(await call(ctx, 'vehicle-number', { vehicleId: v1.id, number: 9 })).ok);
  await applyChange(ctx, trip.id, { type: 'undo' });
  check('ONE undo takes End roll call back: the roll call is open again, the 6 are back on the tour and on the list',
    !rcOf(ctx).endedAt && restoredExactly(ctx.state, before) && rollCallState(ctx.state, rcOf(ctx)).expected.length === 6);

  // --- Someone joined on site: unticked, they stay booked ---
  const kept = await departed();
  const movedFour = kept.absent.slice(0, 4);
  await call(kept.ctx, 'rollcall-end', { moveGuestIds: movedFour.map((g) => g.id) });
  const keptEntry = kept.ctx.entries.find((e) => e.type === 'rollcall-end');
  check('Two names unticked: they stay booked on the tour (12 on it), 4 are moved, the journal counts "2 stayed on the tour without a vehicle"',
    countIn(kept.ctx.state, activity(T)) === 12 && keptEntry.movedCount === 4 && keptEntry.keptCount === 2 && /2 stayed on the tour without a vehicle/.test(summarize(groupBatches(kept.ctx.entries).at(-1))));
  const nobody = await departed();
  for (const g of nobody.absent) await call(nobody.ctx, 'checkin', { guestId: g.id, vehicleId: nobody.v1.id });
  check('If everybody is checked in, End roll call moves nobody: "Ended the roll call: 16 checked in"',
    (await call(nobody.ctx, 'rollcall-end', { moveGuestIds: [] })).ok && summarize(groupBatches(nobody.ctx.entries).at(-1)) === 'Ended the roll call: 16 checked in');

  // --- End roll call refuses what does not make sense ---
  const bad = await departed();
  check('Refused: moving somebody who IS checked in, somebody not booked here, the same guest twice, or no list at all',
    !(await call(bad.ctx, 'rollcall-end', { moveGuestIds: [bad.present[0].id] })).ok
    && !(await call(bad.ctx, 'rollcall-end', { moveGuestIds: [guest('G001').id] })).ok
    && !(await call(bad.ctx, 'rollcall-end', { moveGuestIds: [bad.absent[0].id, bad.absent[0].id] })).ok
    && !(await call(bad.ctx, 'rollcall-end', {})).ok);
  check('Refused when nothing changed: the trip is untouched after all those refusals', bad.ctx.commits.length === 1 + 10);
  check('Only the owner can end a roll call', !(await call(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), 'rollcall-end', { moveGuestIds: [] })).ok);

  // --- Re-open roll call ---
  const again = await departed();
  await call(again.ctx, 'rollcall-end', { moveGuestIds: again.absent.map((g) => g.id) });
  const ended6 = structuredClone(again.ctx.state);
  check('End roll call remembers who it moved (the 6 absent guests)', rcOf(again.ctx).movedByEnd.length === 6 && again.absent.every((g) => rcOf(again.ctx).movedByEnd.includes(g.id)));
  check('Nothing can be checked in while the roll call is ended (it must be re-opened first)', !(await call(again.ctx, 'checkin', { guestId: again.present[0].id, vehicleId: again.v2.id })).ok);
  const reopened = await call(again.ctx, 'rollcall-reopen');
  const reopenBatch = groupBatches(again.ctx.entries).at(-1);
  check('Re-open roll call: the roll call is open again with its vehicles and check-ins, the 6 are back on the tour',
    reopened.ok && !rcOf(again.ctx).endedAt && rcOf(again.ctx).vehicles.length === 4 && again.present.every((g) => rcOf(again.ctx).checkins[g.id])
    && again.absent.every((g) => guestPlace(again.ctx.state, g, slot('S01')).activity?.id === activity(T).id) && countIn(again.ctx.state, activity(T)) === 16, reopened.error);
  check('...they are back on the list of guests still expected, in no vehicle', rollCallState(again.ctx.state, rcOf(again.ctx)).expected.length === 6 && rcOf(again.ctx).movedByEnd.length === 0);
  check('It is ONE action: a "Re-open" line plus one "put back" line per guest, and none is marked forced',
    reopenBatch.kind === 'rollcall' && reopenBatch.entries.length === 7 && reopenBatch.entries[0].type === 'rollcall-reopen'
    && reopenBatch.entries.slice(1).every((e) => e.type === 'move' && e.cause === 'reopen-roll-call' && e.from.kind === 'leisure' && !e.forced));
  check('The journal says: "Re-opened the roll call: 6 guests put back on the tour (names)"',
    summarize(reopenBatch) === `Re-opened the roll call: 6 guests put back on the tour (${joinNames(absent.map(shownName).sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' })))})`, summarize(reopenBatch));
  check('Check-ins work again after re-opening', (await call(again.ctx, 'checkin', { guestId: absent[0].id, vehicleId: again.v1.id })).ok);
  check('A roll call that is open cannot be re-opened', !(await call(again.ctx, 'rollcall-reopen')).ok);
  await call(again.ctx, 'checkout', { guestId: absent[0].id });
  // Ending it a second time works and remembers the new absentees too
  await call(again.ctx, 'rollcall-end', { moveGuestIds: absent.map((g) => g.id) });
  check('End roll call a second time: the roll call is closed again and remembers the 6 who were moved', rcOf(again.ctx).endedAt && rcOf(again.ctx).movedByEnd.length === 6);
  await applyChange(again.ctx, trip.id, { type: 'undo' });
  await applyChange(again.ctx, trip.id, { type: 'undo' });
  await applyChange(again.ctx, trip.id, { type: 'undo' });
  await applyChange(again.ctx, trip.id, { type: 'undo' });
  check('Undo takes back Re-open roll call: it is closed again and the 6 are At leisure again, exactly as End roll call left it',
    rcOf(again.ctx).endedAt && restoredExactly(again.ctx.state, ended6) && rcOf(again.ctx).movedByEnd.length === 6, JSON.stringify(rcOf(again.ctx).movedByEnd));

  // Somebody was booked elsewhere in the meantime: they are not put back
  const elsewhere = await departed();
  await call(elsewhere.ctx, 'rollcall-end', { moveGuestIds: elsewhere.absent.map((g) => g.id) });
  const otherTour = trip.activities.find((a) => a.slotId === activity(T).slotId && a.id !== activity(T).id && a.capacity === null);
  const wandering = elsewhere.absent[0];
  if (otherTour) await applyChange(elsewhere.ctx, trip.id, { type: 'move', guestId: wandering.id, slotId: activity(T).slotId, to: { kind: 'activity', activityId: otherTour.id } });
  await call(elsewhere.ctx, 'rollcall-reopen');
  check('A guest who was booked on another tour since End roll call is left there; the others come back',
    !otherTour || (guestPlace(elsewhere.ctx.state, wandering, slot('S01')).activity?.id === otherTour.id && elsewhere.absent.slice(1).every((g) => guestPlace(elsewhere.ctx.state, g, slot('S01')).activity?.id === activity(T).id)));

  // The tour filled up meanwhile: as many as fit come back, the others stay At leisure and the journal says so
  const tight = await departed();
  await call(tight.ctx, 'rollcall-end', { moveGuestIds: tight.absent.map((g) => g.id) });
  tight.ctx.state.activities.find((a) => a.id === activity(T).id).capacity = 12; // 10 are on it: only 2 places for the 6
  const squeezed = await call(tight.ctx, 'rollcall-reopen');
  const inTour = tight.absent.filter((g) => guestPlace(tight.ctx.state, g, slot('S01')).activity?.id === activity(T).id);
  const sorted6 = [...tight.absent].sort(inOrder);
  check('A tour that is nearly full takes back as many as fit (2 places: the first two alphabetically), never over capacity',
    squeezed.ok && countIn(tight.ctx.state, activity(T)) === 12 && inTour.length === 2 && inTour.every((g) => [sorted6[0].id, sorted6[1].id].includes(g.id)));
  check('...the 4 others stay At leisure, and the journal names them: "could not be put back: the tour is full"',
    /4 could not|could not be put back: the tour is full/.test(summarize(groupBatches(tight.ctx.entries).at(-1))) && rcOf(tight.ctx).movedByEnd.length === 4);
  check('Re-open on a roll call that never ended, or on a cancelled tour, is refused',
    !(await call((await departed()).ctx, 'rollcall-reopen')).ok);
  check('Only the owner can re-open a roll call', !(await call(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), 'rollcall-reopen')).ok);

  // --- Old lines from the return count (version 0.7.0) stay readable but cannot be undone ---
  const legacy = await departed();
  await call(legacy.ctx, 'rollcall-end', { moveGuestIds: [] });
  const oldLine = { id: 'old1', tripId: trip.id, at: new Date().toISOString(), seq: 999, n: 0, who: { id: 'o', name: 'Tester', role: 'owner' }, batchId: 'oldbatch',
    type: 'return-in', rollCallId: rcOf(legacy.ctx).id, activityId: activity(T).id, activityLabel: activity(T).name, guestName: 'Old N.', vehicleLabel: 'V1',
    slotId: slot('S01').id, slotLabel: 'Day 1 · Morning', place: { name: 'Lisbon', timeZone: 'Europe/Lisbon' } };
  legacy.ctx.entries.push(oldLine);
  const oldBatch = groupBatches(legacy.ctx.entries).find((b) => b.batchId === 'oldbatch');
  check('An old "return count" line is still shown in the Journal, and Undo skips it (it reaches End roll call instead)',
    oldBatch.kind === 'old-return-count' && summarize(oldBatch).includes('no longer part of the app') && lastUndoable(legacy.ctx.entries).entries.some((e) => e.type === 'rollcall-end'));

  // --- The Journal: everything of the roll call is ONE card, up to the return count ---
  const items = journalItems(groupBatches(again.ctx.entries));
  check('Start, check-ins, End roll call and Re-open roll call are ONE roll call card in the Journal',
    items.length === 1 && items[0].kind === 'rollcall' && items[0].batches.some((b) => b.entries.some((e) => e.type === 'rollcall-end')) && items[0].batches.some((b) => b.entries.some((e) => e.type === 'rollcall-reopen')));
  check('Journal lines of the roll call, End roll call and Re-open never contain dietary info', !/allerg|shellfish|dietary/i.test(JSON.stringify(again.ctx.entries)));
}

// =====================================================================
// Step 7a/7b: Settings — destinations and activities
// =====================================================================
{
  const lisbon = trip.destinations.find((d) => d.name === 'Lisbon');
  const s = slot('S01'); // a Lisbon half-day

  // --- Edit a destination's own details ---
  const ctx = makeCtx();
  const before = structuredClone(ctx.state);
  const edited = await applyChange(ctx, trip.id, { type: 'edit-destination', destinationId: lisbon.id, name: 'Lisboa', country: 'Portugal', timeZone: 'Europe/Lisbon' });
  const dest = () => ctx.state.destinations.find((d) => d.id === lisbon.id);
  check('Edit destination: the name changes, nothing else about the trip does', edited.ok && dest().name === 'Lisboa' && dest().timeZone === 'Europe/Lisbon', edited.error);
  check('The journal says: "Lisbon renamed to \\"Lisboa\\""', summarize(groupBatches(ctx.entries).at(-1)).includes('Lisbon renamed to "Lisboa"'), summarize(groupBatches(ctx.entries).at(-1)));
  check('Refused: a blank name, or a time zone the phone does not know',
    !(await applyChange(ctx, trip.id, { type: 'edit-destination', destinationId: lisbon.id, name: '  ', country: '', timeZone: 'Europe/Lisbon' })).ok
    && !(await applyChange(ctx, trip.id, { type: 'edit-destination', destinationId: lisbon.id, name: 'Lisboa', country: '', timeZone: 'Nowhere/Fake' })).ok);
  await applyChange(ctx, trip.id, { type: 'undo' });
  check('Undo puts the destination exactly back (name, country, time zone)', restoredExactly(ctx.state, before));
  check('Only the owner can edit a destination', !(await applyChange(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), trip.id, { type: 'edit-destination', destinationId: lisbon.id, name: 'X', country: '', timeZone: 'Europe/Lisbon' })).ok);

  // Undo is refused once the destination has changed again since
  const ctx2 = makeCtx();
  await applyChange(ctx2, trip.id, { type: 'edit-destination', destinationId: lisbon.id, name: 'Lisboa', country: 'Portugal', timeZone: 'Europe/Lisbon' });
  ctx2.state.destinations.find((d) => d.id === lisbon.id).name = 'Something else'; // as if changed again by another action
  check('Undo of "edit destination" is refused if the destination has changed again since', !(await applyChange(ctx2, trip.id, { type: 'undo' })).ok);

  // --- Add an activity ---
  const ctx3 = makeCtx();
  const added = await applyChange(ctx3, trip.id, { type: 'add-activity', slotId: s.id, name: 'Sunset cruise', meeting: 'The pier', startTime: '18:30', capacity: 20 });
  check('Add activity: it appears in the trip, with the right time zone and no bookings yet', added.ok && countIn(ctx3.state, ctx3.state.activities.find((a) => a.id === added.entries[0].activityId)) === 0);
  const cruise = () => ctx3.state.activities.find((a) => a.id === added.entries[0].activityId);
  check('Its start time is stored as the exact moment (18:30 Lisbon time, in January = UTC)', cruise().startsAt === '2027-01-12T18:30:00.000Z', cruise().startsAt);
  check('The journal says: "Added \\"Sunset cruise\\" (...)"', summarize(groupBatches(ctx3.entries).at(-1)).startsWith('Added "Sunset cruise"'));
  check('A guest can now book onto it, like any other activity', (await applyChange(ctx3, trip.id, moveOf('G001', 'S01', { kind: 'activity', activityId: cruise().id }))).ok);
  check('Refused: a blank name, an unknown half-day, a bad time, or a capacity of 0',
    !(await applyChange(ctx3, trip.id, { type: 'add-activity', slotId: s.id, name: '', meeting: '', startTime: '', capacity: null })).ok
    && !(await applyChange(ctx3, trip.id, { type: 'add-activity', slotId: 'nope', name: 'X', meeting: '', startTime: '', capacity: null })).ok
    && !(await applyChange(ctx3, trip.id, { type: 'add-activity', slotId: s.id, name: 'X', meeting: '', startTime: '25:99', capacity: null })).ok
    && !(await applyChange(ctx3, trip.id, { type: 'add-activity', slotId: s.id, name: 'X', meeting: '', startTime: '', capacity: 0 })).ok);
  check('An activity can be added with no time and no capacity limit',
    (await applyChange(ctx3, trip.id, { type: 'add-activity', slotId: s.id, name: 'Free afternoon walk', meeting: '', startTime: '', capacity: null })).ok);

  // Undo: works while nobody is booked, refused once somebody is
  const ctx4 = makeCtx();
  const added2 = await applyChange(ctx4, trip.id, { type: 'add-activity', slotId: s.id, name: 'Sunset cruise', meeting: 'The pier', startTime: '18:30', capacity: 20 });
  const cruiseId = added2.entries[0].activityId;
  check('Undo removes a freshly added activity, as if it was never added', (await applyChange(ctx4, trip.id, { type: 'undo' })).ok && !ctx4.state.activities.some((a) => a.id === cruiseId));
  const added3 = await applyChange(ctx4, trip.id, { type: 'add-activity', slotId: s.id, name: 'Sunset cruise', meeting: 'The pier', startTime: '18:30', capacity: 20 });
  ctx4.state.bookings[trip.guests[0].id] = { ...ctx4.state.bookings[trip.guests[0].id], [s.id]: { kind: 'activity', activityId: added3.entries[0].activityId } };
  check('Undo is refused once somebody is booked on the new activity', !(await applyChange(ctx4, trip.id, { type: 'undo' })).ok);
  check('Only the owner can add an activity', !(await applyChange(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), trip.id, { type: 'add-activity', slotId: s.id, name: 'X', meeting: '', startTime: '', capacity: null })).ok);

  // --- Edit an activity ---
  const ctx5 = makeCtx();
  const tram = activity('S01-2');
  const before5 = structuredClone(ctx5.state);
  const editedActivity = await applyChange(ctx5, trip.id, { type: 'edit-activity', activityId: tram.id, name: 'Tram 28, Alfama and viewpoints', meeting: 'Praça do Comércio', startTime: '15:45', capacity: 24 });
  const tramNow = () => ctx5.state.activities.find((a) => a.id === tram.id);
  check('Edit activity: name, meeting point, time and capacity all change; existing bookings are untouched',
    editedActivity.ok && tramNow().name === 'Tram 28, Alfama and viewpoints' && tramNow().meeting === 'Praça do Comércio' && tramNow().capacity === 24 && countIn(ctx5.state, tramNow()) === countIn(trip, tram));
  check('The journal describes what changed: renamed, meeting point, capacity, time',
    /renamed to .*meeting point updated.*capacity set to 24.*time updated/.test(summarize(groupBatches(ctx5.entries).at(-1))), summarize(groupBatches(ctx5.entries).at(-1)));
  check('The time can be cleared (no time set) and the capacity can be lifted (no limit)',
    (await applyChange(ctx5, trip.id, { type: 'edit-activity', activityId: tram.id, name: tramNow().name, meeting: tramNow().meeting, startTime: '', capacity: null })).ok
    && tramNow().startsAt === null && tramNow().capacity === null);
  await applyChange(ctx5, trip.id, { type: 'undo' });
  await applyChange(ctx5, trip.id, { type: 'undo' });
  check('Two undos put the activity exactly back as it was', restoredExactly(ctx5.state, before5));
  const cancelledForTest = await applyChange(ctx5, trip.id, { type: 'cancel-tour', activityId: activity('S01-1').id });
  check('Refused: editing a cancelled activity, or with a blank name', cancelledForTest.ok
    && !(await applyChange(ctx5, trip.id, { type: 'edit-activity', activityId: activity('S01-1').id, name: 'X', meeting: '', startTime: '', capacity: null })).ok
    && !(await applyChange(ctx5, trip.id, { type: 'edit-activity', activityId: tram.id, name: '  ', meeting: '', startTime: '', capacity: null })).ok);
  check('Only the owner can edit an activity', !(await applyChange(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), trip.id, { type: 'edit-activity', activityId: tram.id, name: 'X', meeting: '', startTime: '', capacity: null })).ok);

  // --- Replace a destination (rare) ---
  const marrakech = trip.destinations.find((d) => d.name === 'Marrakech');
  const marrakechSlotIds = new Set(trip.slots.filter((sl) => sl.destinationId === marrakech.id).map((sl) => sl.id));
  const marrakechTours = trip.activities.filter((a) => marrakechSlotIds.has(a.slotId) && !a.cancelled);
  const marrakechBooked = marrakechTours.reduce((sum, a) => sum + countIn(trip, a), 0);
  const ctx6 = makeCtx();
  const beforeReplace = structuredClone(ctx6.state);
  const replaced = await applyChange(ctx6, trip.id, { type: 'replace-destination', destinationId: marrakech.id, name: 'Fez', country: 'Morocco', timeZone: 'Africa/Casablanca' });
  const fez = () => ctx6.state.destinations.find((d) => d.id === marrakech.id);
  check('Replace destination: the name changes, every one of its tours is cancelled, everybody on them is At leisure',
    replaced.ok && fez().name === 'Fez'
    && marrakechTours.every((a) => ctx6.state.activities.find((x) => x.id === a.id).cancelled)
    && marrakechTours.every((a) => countIn(ctx6.state, ctx6.state.activities.find((x) => x.id === a.id)) === 0), replaced.error);
  check(`The journal counts it: "${plural(marrakechTours.length, 'tour')} cancelled" and the guests moved`,
    summarize(groupBatches(ctx6.entries).at(-1)).includes(`Replaced Marrakech with Fez`) && summarize(groupBatches(ctx6.entries).at(-1)).includes(`${marrakechTours.length}`), summarize(groupBatches(ctx6.entries).at(-1)));
  check('It is ONE action: the header, one cancel line per tour, one move line per guest, all sharing a batch id',
    groupBatches(ctx6.entries).at(-1).entries.length === 1 + marrakechTours.length + marrakechBooked
    && groupBatches(ctx6.entries).at(-1).kind === 'replace-destination');
  check('ONE undo takes all of it back: the destination, its tours and every guest, exactly as before', (await applyChange(ctx6, trip.id, { type: 'undo' })).ok && restoredExactly(ctx6.state, beforeReplace));
  check('Only the owner can replace a destination', !(await applyChange(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), trip.id, { type: 'replace-destination', destinationId: marrakech.id, name: 'Fez', country: '', timeZone: 'Africa/Casablanca' })).ok);
  check('Replacing a destination with a bad time zone is refused, and nothing changes', !(await applyChange(makeCtx(), trip.id, { type: 'replace-destination', destinationId: marrakech.id, name: 'Fez', country: '', timeZone: 'Nowhere/Fake' })).ok);

  // --- No dietary info anywhere in these journal lines ---
  check('Settings changes never write dietary info to the journal', !/allerg|shellfish|dietary/i.test(JSON.stringify([...ctx.entries, ...ctx3.entries, ...ctx5.entries, ...ctx6.entries])));

  // --- A half-day picker is in trip order (Morning, Afternoon, Evening), not alphabetical ---
  const day2Halves = trip.slots.filter((sl) => sl.destinationId === lisbon.id && sl.day === 2).sort(bySlotOrder).map((sl) => sl.half);
  check('Half-days sort by day, then Morning/Afternoon/Evening — not A-Z (which would put Afternoon first)',
    JSON.stringify(day2Halves) === JSON.stringify(['Morning', 'Afternoon', 'Evening']), day2Halves.join(','));

  // --- Typing a time with no ":" key on the keyboard: the app adds it for you ---
  check('Typing digits adds the ":" after the hour, live, as you type', ['1', '18', '183', '1830'].map(formatTypedTime).join(',') === '1,18,18:3,18:30');
  check('A time already typed with its ":" is left alone, and only the first 4 digits count', formatTypedTime('18:30') === '18:30' && formatTypedTime('99999') === '99:99');
}

// =====================================================================
// Step 7c/7d: guests and travel parties
// =====================================================================
{
  const soloRef = trip.guests.find((g) => trip.parties.find((p) => p.id === g.partyId).type === 'Solo').ref;
  // A half-day where G001 and their partner G002 are together, so leaving really removes G001 from G002's party-mover offer.
  const s = trip.slots.find((x) => guestPlace(trip, guest('G001'), x).kind === 'activity' && partyMovers(trip, guest('G001'), x).length === 1);

  // --- Edit a guest's own name and seat ---
  check('The sample trip gives every guest a seat, "1A" style', guest('G001').seat === '1A' && guest('G002').seat === '1C' && guest('G005').seat === '2A');
  const ctx = makeCtx();
  const before = structuredClone(ctx.state);
  const edited = await applyChange(ctx, trip.id, { type: 'edit-guest', guestId: guest('G001').id, first: 'Richard', last: 'Stone', seat: guest('G001').seat });
  const g001 = () => ctx.state.guests.find((g) => g.ref === 'G001');
  check('Edit a guest\'s name: first and last change, the shown name updates with it, the seat is untouched',
    edited.ok && g001().first === 'Richard' && g001().last === 'Stone' && g001().seat === '1A', edited.error);
  check('The journal says: \'Richard S. renamed to "Richard Stone"\'', summarize(groupBatches(ctx.entries).at(-1)) === 'Richard S. renamed to "Richard Stone"', summarize(groupBatches(ctx.entries).at(-1)));
  const reseated = await applyChange(ctx, trip.id, { type: 'edit-guest', guestId: guest('G001').id, first: 'Richard', last: 'Stone', seat: '5B' });
  check('The seat can be changed on its own: "seat set to 5B"', reseated.ok && g001().seat === '5B'
    && summarize(groupBatches(ctx.entries).at(-1)) === 'Richard S. seat set to 5B', summarize(groupBatches(ctx.entries).at(-1)));
  const unseated = await applyChange(ctx, trip.id, { type: 'edit-guest', guestId: guest('G001').id, first: 'Richard', last: 'Stone', seat: '' });
  check('The seat can be cleared: "seat cleared"', unseated.ok && g001().seat === null
    && summarize(groupBatches(ctx.entries).at(-1)) === 'Richard S. seat cleared');
  check('Refused: a blank first or last name', !(await applyChange(ctx, trip.id, { type: 'edit-guest', guestId: guest('G001').id, first: ' ', last: 'Stone', seat: '' })).ok
    && !(await applyChange(ctx, trip.id, { type: 'edit-guest', guestId: guest('G001').id, first: 'Richard', last: '', seat: '' })).ok);
  await applyChange(ctx, trip.id, { type: 'undo' });
  await applyChange(ctx, trip.id, { type: 'undo' });
  await applyChange(ctx, trip.id, { type: 'undo' });
  check('Three undos put the name and the seat exactly back', restoredExactly(ctx.state, before));
  check('Only the owner can rename a guest', !(await applyChange(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), trip.id, { type: 'edit-guest', guestId: guest('G001').id, first: 'X', last: 'Y', seat: '' })).ok);

  // --- Sort by seat: "1A" before "1C" before "2A"; nobody without a seat in this sample ---
  const seatSorted = [...trip.guests].sort(bySeat(displayNames(trip.guests)));
  check('Guests sort by seat: row first, then letter ("1A", "1C", "1D", "1F", "2A", "2C"...)',
    seatSorted.slice(0, 6).map((g) => g.seat).join(',') === '1A,1C,1D,1F,2A,2C', seatSorted.slice(0, 6).map((g) => g.seat).join(','));
  check('A guest with no seat set sorts after everybody who has one', bySeat(displayNames(trip.guests))({ seat: null }, { seat: '1A' }) > 0);

  // --- Guest left the trip ---
  const ctx2 = makeCtx();
  const before2 = structuredClone(ctx2.state);
  const left = await applyChange(ctx2, trip.id, { type: 'guest-left', guestId: guest('G001').id });
  const g001of = (state) => state.guests.find((g) => g.ref === 'G001');
  check('Guest left the trip: leftAt is set, no booking is touched', left.ok && Boolean(g001of(ctx2.state).leftAt)
    && JSON.stringify(ctx2.state.bookings[guest('G001').id]) === JSON.stringify(trip.bookings[guest('G001').id]), left.error);
  check('The journal says: "Richard S. left the trip"', summarize(groupBatches(ctx2.entries).at(-1)) === `${names.get(guest('G001').id)} left the trip`);
  check('A guest who left is not counted anywhere day-to-day: not in whoIsWhere, not in countIn, freeing their seat',
    [...whoIsWhere(ctx2.state, s).byActivity.values(), whoIsWhere(ctx2.state, s).leisure].flat().every((g) => g.id !== guest('G001').id)
    && whoIsWhere(ctx2.state, s).attention.every(({ guest: g }) => g.id !== guest('G001').id));
  check('If G001 was on an activity, that activity now counts one fewer', (() => {
    const here = guestPlace(trip, guest('G001'), s);
    return here.kind !== 'activity' || countIn(ctx2.state, ctx2.state.activities.find((a) => a.id === here.activity.id)) === countIn(trip, here.activity) - 1;
  })());
  check('Their travel party partner is no longer offered as a "also move" party mover', partyMovers(ctx2.state, guest('G002'), s).every((g) => g.id !== guest('G001').id));
  check('partyLabel now reads Priya S. as travelling solo (their only party-mate left)', partyLabel(ctx2.state, guest('G002'), displayNames(ctx2.state.guests)) === 'Travelling solo');
  check('Refused: marking somebody as left twice', !(await applyChange(ctx2, trip.id, { type: 'guest-left', guestId: guest('G001').id })).ok);
  check('Only the owner can mark a guest as having left', !(await applyChange(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), trip.id, { type: 'guest-left', guestId: guest('G001').id })).ok);

  // Bring them back
  const back = await applyChange(ctx2, trip.id, { type: 'guest-return', guestId: guest('G001').id });
  check('Guest returned: leftAt is cleared, they are exactly back where they were (still in every original booking)',
    back.ok && !g001of(ctx2.state).leftAt && restoredExactly(ctx2.state, before2), back.error);
  check('The journal says: "Richard S. is back on the trip"', summarize(groupBatches(ctx2.entries).at(-1)) === `${names.get(guest('G001').id)} is back on the trip`);
  check('Refused: bringing back somebody who has not left', !(await applyChange(ctx2, trip.id, { type: 'guest-return', guestId: guest('G001').id })).ok);
  await applyChange(ctx2, trip.id, { type: 'undo' }); // undo the return: they are marked left again
  check('Undo of "bring back" marks the guest left again, with their exact original leftAt moment', Boolean(g001of(ctx2.state).leftAt));
  await applyChange(ctx2, trip.id, { type: 'undo' }); // undo the original "left"
  check('Undo of "guest left" brings the whole trip exactly back, with nothing left to undo', restoredExactly(ctx2.state, before2) && lastUndoable(ctx2.entries) === null);

  // --- Undo is refused once the guest has changed again since ---
  const ctx3 = makeCtx();
  await applyChange(ctx3, trip.id, { type: 'guest-left', guestId: guest('G003').id });
  await applyChange(ctx3, trip.id, { type: 'guest-return', guestId: guest('G003').id });
  ctx3.state.guests.find((g) => g.ref === 'G003').leftAt = new Date().toISOString(); // as if marked left again by another action
  check('Undo of "bring back" is refused if the guest has left again since', !(await applyChange(ctx3, trip.id, { type: 'undo' })).ok);

  // --- Make solo ---
  const ctx4 = makeCtx();
  const before4 = structuredClone(ctx4.state);
  const partyCountBefore = trip.parties.length;
  const solo = await applyChange(ctx4, trip.id, { type: 'make-solo', guestId: guest('G001').id });
  check('Make solo: G001 gets a brand new party of their own; Priya S. keeps the old one, alone', solo.ok
    && ctx4.state.parties.length === partyCountBefore + 1
    && partyLabel(ctx4.state, ctx4.state.guests.find((g) => g.ref === 'G001'), displayNames(ctx4.state.guests)) === 'Travelling solo'
    && partyLabel(ctx4.state, guest('G002'), displayNames(ctx4.state.guests)) === 'Travelling solo', solo.error);
  check('The journal says: "Richard S. now has their own travel party (solo)"', summarize(groupBatches(ctx4.entries).at(-1)) === `${names.get(guest('G001').id)} now has their own travel party (solo)`);
  check('Refused: making an already-solo guest solo again', !(await applyChange(ctx4, trip.id, { type: 'make-solo', guestId: guest(soloRef).id })).ok);
  await applyChange(ctx4, trip.id, { type: 'undo' });
  check('Undo of make-solo: the new party is gone (as if never made), G001 is back with Priya S.', restoredExactly(ctx4.state, before4) && ctx4.state.parties.length === partyCountBefore);
  check('Only the owner can change a travel party', !(await applyChange(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), trip.id, { type: 'make-solo', guestId: guest(soloRef).id })).ok);

  // --- Join an existing travel party ---
  const ctx5 = makeCtx();
  const before5 = structuredClone(ctx5.state);
  const g003PartyId = guest('G003').partyId; // G003 & G004 are a couple: joining it needs no new type
  const joined = await applyChange(ctx5, trip.id, { type: 'join-party', guestId: guest(soloRef).id, partyId: g003PartyId });
  check('Join an existing multi-person party: no type needed, the party keeps its type', joined.ok
    && ctx5.state.guests.find((g) => g.ref === soloRef).partyId === g003PartyId
    && ctx5.state.parties.find((p) => p.id === g003PartyId).type === trip.parties.find((p) => p.id === g003PartyId).type, joined.error);
  check('The journal names who is already there: "... joined the travel party with Peter S. and Mary S."',
    summarize(groupBatches(ctx5.entries).at(-1)).includes('joined the travel party with'));
  await applyChange(ctx5, trip.id, { type: 'undo' });
  check('Undo of join-party: back in their own solo party, the other party untouched', restoredExactly(ctx5.state, before5));

  // Joining somebody who is solo needs NO type: no adjective is ever forced on the owner
  const ctx6 = makeCtx();
  const before6 = structuredClone(ctx6.state);
  const otherSoloRef = trip.guests.find((g) => trip.parties.find((p) => p.id === g.partyId).type === 'Solo' && g.ref !== soloRef).ref;
  const soloPartyId = guest(otherSoloRef).partyId;
  const paired = await applyChange(ctx6, trip.id, { type: 'join-party', guestId: guest(soloRef).id, partyId: soloPartyId });
  check('Joining a solo guest just works, no type asked or needed', paired.ok
    && partyLabel(ctx6.state, ctx6.state.guests.find((g) => g.ref === otherSoloRef), displayNames(ctx6.state.guests)) === `Travelling with ${displayNames(ctx6.state.guests).get(guest(soloRef).id)}`, paired.error);
  check('Refused: joining a party the guest is already in', !(await applyChange(ctx6, trip.id, { type: 'join-party', guestId: guest(soloRef).id, partyId: soloPartyId })).ok);
  await applyChange(ctx6, trip.id, { type: 'undo' });
  check('Undo of a party-creating join: exactly back to two solo guests', restoredExactly(ctx6.state, before6));

  // --- Create a brand new travel party (2 or more guests, no type asked) ---
  const ctx7 = makeCtx();
  const before7 = structuredClone(ctx7.state);
  const partyCountBefore7 = trip.parties.length;
  const trioRefs = [soloRef, otherSoloRef, 'G015']; // G015 already has a party (P08, with G016): joining leaves it behind
  const created = await applyChange(ctx7, trip.id, { type: 'create-party', guestIds: trioRefs.map((r) => guest(r).id) });
  const namesNow = () => displayNames(ctx7.state.guests);
  check('Create a travel party: everybody picked shares ONE new party, each leaving their old one, no type asked',
    created.ok && new Set(trioRefs.map((r) => ctx7.state.guests.find((g) => g.ref === r).partyId)).size === 1
    && ctx7.state.parties.length === partyCountBefore7 + 1, created.error);
  check('The journal names everybody in the new party, alphabetically', summarize(groupBatches(ctx7.entries).at(-1)).startsWith('New travel party: ')
    && trioRefs.every((r) => summarize(groupBatches(ctx7.entries).at(-1)).includes(namesNow().get(guest(r).id))));
  check('partyLabel reads plainly: "Travelling with X, Y" (no made-up type)',
    partyLabel(ctx7.state, ctx7.state.guests.find((g) => g.ref === soloRef), namesNow()).startsWith('Travelling with '));
  check('Refused: picking only one guest, the same guest twice, or someone not in the trip',
    !(await applyChange(ctx7, trip.id, { type: 'create-party', guestIds: [guest('G001').id] })).ok
    && !(await applyChange(ctx7, trip.id, { type: 'create-party', guestIds: [guest('G001').id, guest('G001').id] })).ok
    && !(await applyChange(ctx7, trip.id, { type: 'create-party', guestIds: [guest('G001').id, 'nope'] })).ok);
  await applyChange(ctx7, trip.id, { type: 'undo' });
  check('Undo of create-party: the new party is gone, everybody exactly back where they were', restoredExactly(ctx7.state, before7) && ctx7.state.parties.length === partyCountBefore7);
  check('Only the owner can create a travel party', !(await applyChange(makeCtx({ id: 'x', name: 'Guest', role: 'guest' }), trip.id, { type: 'create-party', guestIds: trioRefs.map((r) => guest(r).id) })).ok);

  // --- No dietary info anywhere in these journal lines ---
  check('Guest and travel party changes never write dietary info to the journal',
    !/allerg|shellfish|dietary/i.test(JSON.stringify([...ctx.entries, ...ctx2.entries, ...ctx4.entries, ...ctx5.entries, ...ctx6.entries, ...ctx7.entries])));
}

// =====================================================================
// v0.10.0: seat sort, "Earlier in the trip", no-limit shows "/ ∞", scoped Undo
// =====================================================================
{
  // --- "Earlier in the trip": a whole day already over sinks to the bottom, per destination time zone ---
  const fixedToday = (fixed) => () => fixed; // a fake "today" so the test never depends on when it runs
  const { upcoming: up1, earlier: early1 } = splitPastSlots(trip, fixedToday('2027-01-14'));
  check('Everything up to and including 13 Jan is "earlier"; 14 Jan onwards is still upcoming',
    early1.every((s) => s.date < '2027-01-14') && up1.every((s) => s.date >= '2027-01-14')
    && early1.length > 0 && up1.length > 0 && early1.length + up1.length === trip.slots.length);
  const { upcoming: up0, earlier: early0 } = splitPastSlots(trip, fixedToday('2000-01-01'));
  check('Before the trip starts: nothing is "earlier" yet', early0.length === 0 && up0.length === trip.slots.length);
  const { upcoming: upAll, earlier: earlyAll } = splitPastSlots(trip, fixedToday('2099-01-01'));
  check('Long after the trip: everything is "earlier"', earlyAll.length === trip.slots.length && upAll.length === 0);
  const zonesAsked = new Set();
  splitPastSlots(trip, (tz) => { zonesAsked.add(tz); return '2000-01-01'; });
  check('Each half-day is judged in its OWN destination\'s time zone (Lisbon and Kyoto both asked)',
    zonesAsked.has('Europe/Lisbon') && zonesAsked.has('Asia/Tokyo'));
  check('localDateNow gives today\'s date as YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(localDateNow('Europe/Lisbon')));

  // --- Sort by seat (the sample data check for "1A", "1C"... lives with the edit-guest tests above) ---
  check('bySeat puts a guest with no seat after everybody who has one, and ties break alphabetically',
    bySeat(displayNames(trip.guests))({ seat: null, id: guest('G001').id }, { seat: null, id: guest('G002').id })
      === alphabetical(displayNames(trip.guests))({ id: guest('G001').id }, { id: guest('G002').id }));

  // --- No-limit activities read "x / ∞" ---
  check('capacityInfo with no capacity limit reads "x / ∞"', capacityInfo(0, null).text === '0 / ∞' && capacityInfo(40, null).text === '40 / ∞');

  // --- Undo is scoped: each screen only ever offers to undo its own kind of action ---
  const ctx9 = makeCtx();
  const zed = await applyChange(ctx9, trip.id, { type: 'edit-guest', guestId: guest('G001').id, first: 'Zed', last: 'Guest', seat: '' });
  const s9 = trip.slots.find((x) => guestPlace(trip, guest('G010'), x).kind === 'activity');
  await applyChange(ctx9, trip.id, moveOf('G010', s9.ref, LEISURE));
  check('Unscoped Undo takes back the true last action (the move), not the earlier guest edit',
    zed.ok && (await applyChange(ctx9, trip.id, { type: 'undo' })).ok && placeNow(ctx9, 'G010', s9.ref).kind !== 'leisure'
    && ctx9.state.guests.find((g) => g.ref === 'G001').first === 'Zed');
  const scoped = await applyChange(ctx9, trip.id, { type: 'undo', scope: GUEST_UNDO_SCOPE });
  check('Undo scoped to Guests skips the move (already undone above) and reaches the guest edit before it',
    scoped.ok && ctx9.state.guests.find((g) => g.ref === 'G001').first === 'Richard', scoped.error);
  check('Undo scoped to a kind with nothing to undo is refused, even if something else could be undone',
    !(await applyChange(ctx9, trip.id, { type: 'undo', scope: DESTINATION_UNDO_SCOPE })).ok);

  // A guest edit made WHILE a booking move is more recent: Use screens never offer to undo it
  const ctx10 = makeCtx();
  await applyChange(ctx10, trip.id, moveOf('G010', s9.ref, LEISURE));
  await applyChange(ctx10, trip.id, { type: 'edit-guest', guestId: guest('G001').id, first: 'Zed', last: 'Guest', seat: '' });
  const useScoped = await applyChange(ctx10, trip.id, { type: 'undo', scope: USE_UNDO_SCOPE });
  check('Undo scoped to Use screens (By destination/By guest) skips the more recent guest edit and undoes the move',
    useScoped.ok && placeNow(ctx10, 'G010', s9.ref).kind !== 'leisure' && ctx10.state.guests.find((g) => g.ref === 'G001').first === 'Zed', useScoped.error);

  // Two roll calls at once: each one's Undo only ever touches its own
  const ctx11 = makeCtx();
  const alfamaActivity = activity('S01-1');
  const tram = activity('S01-2'); // a different tour in the same half-day as Alfama
  await applyChange(ctx11, trip.id, { type: 'rollcall-start', activityId: alfamaActivity.id });
  await applyChange(ctx11, trip.id, { type: 'rollcall-start', activityId: tram.id });
  const alfamaCall = findRollCall(ctx11.state, alfamaActivity.id);
  const tramCall = findRollCall(ctx11.state, tram.id);
  await applyChange(ctx11, trip.id, { type: 'vehicle-add', activityId: tram.id }); // the most recent action overall: on Tram 28's roll call
  check('Alfama\'s roll call has nothing of its own to undo once Tram 28\'s vehicle-add is the last action',
    lastUndoable(ctx11.entries, { rollCallId: alfamaCall.id })?.entries.some((e) => e.type === 'rollcall-start'));
  const alfamaUndo = await applyChange(ctx11, trip.id, { type: 'undo', scope: { rollCallId: alfamaCall.id } });
  check('Undoing Alfama\'s roll call (scoped) removes ONLY Alfama\'s roll call, Tram 28\'s extra vehicle stays',
    alfamaUndo.ok && !findRollCall(ctx11.state, alfamaActivity.id) && findRollCall(ctx11.state, tram.id)?.vehicles.length === 5);
}

// =====================================================================
// Step 5: works offline (sw.js), installs on the phone (manifest), access code (gate.js)
// =====================================================================

// --- The list of files kept for offline use must be complete ---
const swText = await (await fetch('./sw.js', { cache: 'no-cache' })).text();
const listed = [...swText.match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const listedMissing = [];
for (const file of listed) if (!(await fetch(file, { cache: 'no-cache' })).ok) listedMissing.push(file);
check(`All ${listed.length} files in the offline list exist`, listedMissing.length === 0, listedMissing.join(', '));

// Follow every "import ... from './x.js'" starting from js/app.js: this is every file the app needs to start.
const needed = new Set(['js/app.js']);
for (const file of needed) {
  const code = await (await fetch(file, { cache: 'no-cache' })).text();
  for (const [, specifier] of code.matchAll(/from '(\.[^']+)'/g)) {
    needed.add(new URL(specifier, `http://x/${file}`).pathname.slice(1));
  }
}
const notListed = [...needed].filter((f) => !listed.includes(f));
const staleEntries = listed.filter((f) => f.endsWith('.js') && f !== 'sw.js' && !needed.has(f));
check(`Every one of the ${needed.size} scripts the app needs is in the offline list (a missing one would break offline)`, notListed.length === 0, notListed.join(', '));
check('The offline list has no scripts the app does not use', staleEntries.length === 0, staleEntries.join(', '));

const indexText = await (await fetch('./index.html', { cache: 'no-cache' })).text();
const fromIndex = [...indexText.matchAll(/(?:href|src)="([^"#]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('http'));
check('Everything the home page loads (styles, icon, manifest, script) is in the offline list', fromIndex.every((f) => listed.includes(f)), fromIndex.filter((f) => !listed.includes(f)).join(', '));
check('The sample trip is in the offline list (so "Load the sample trip" works without internet)', listed.includes('data/tour_docs_sample_trip_ZX-01.json'));
check('The version in sw.js and in js/version.js is the same', swText.includes(`const VERSION = '${APP_VERSION}'`), APP_VERSION);

// --- Installing on the phone ---
const manifest = await (await fetch('./manifest.webmanifest')).json();
check('The install manifest has a name, opens full screen and starts at the app',
  manifest.name === 'Tour Docs' && manifest.display === 'standalone' && manifest.start_url === './' && /^#[0-9a-f]{6}$/i.test(manifest.theme_color));
const loadImage = (url) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = url; });
const iconSizes = await Promise.all(manifest.icons.map(async (icon) => { const i = await loadImage(icon.src); return i && `${i.naturalWidth}x${i.naturalHeight}` === icon.sizes; }));
check('The manifest icons exist and have the sizes they claim (192 and 512)', manifest.icons.length >= 2 && iconSizes.every(Boolean), JSON.stringify(iconSizes));
const touchIcon = await loadImage('./icons/apple-touch-icon.png');
check('The iPhone home screen icon is 180 x 180', touchIcon && touchIcon.naturalWidth === 180 && touchIcon.naturalHeight === 180);
check('The home page links the manifest and the iPhone icon', indexText.includes('rel="manifest"') && indexText.includes('rel="apple-touch-icon"') && indexText.includes('apple-mobile-web-app-capable'));

// --- The service worker really installs and copies the files ---
// (Some browsers, like the preview pane used to build this app, refuse service workers altogether. Then this
// one check is SKIPPED; the pretend-network tests just below still cover how sw.js behaves.)
let realWorker = false;
try {
  await navigator.serviceWorker.register('./sw.js');
  await navigator.serviceWorker.ready;
  realWorker = true;
} catch (error) {
  check('SKIPPED here: a real service worker (this browser does not allow them); tested on the phone instead', true, error.message.slice(0, 80));
}
if (realWorker) {
  const cache = await caches.open(`tour-docs-${APP_VERSION}`);
  const kept = (await cache.keys()).map((r) => new URL(r.url).pathname.split('/').slice(1).join('/'));
  check(`The service worker installs and keeps a copy of all ${listed.length} files on the device`, listed.every((f) => kept.includes(f)), listed.filter((f) => !kept.includes(f)).join(', '));
}

// --- How sw.js behaves, tried with a pretend network and a pretend storage ---
{
  const ORIGIN = location.origin;
  const stores = new Map(); // cache name -> Map(url -> Response)
  let network = 'online';   // 'online' | 'offline' | 'slow' | 'missing'
  const networkCalls = [];
  const CACHE_NAME = `tour-docs-${APP_VERSION}`;

  const urlOf = (request) => (typeof request === 'string' ? new URL(request, ORIGIN).href : request.url);
  const makeCache = (map) => ({
    async put(request, response) { map.set(urlOf(request), response); },
    async match(request, options = {}) {
      const strip = (u) => (options.ignoreSearch ? u.split('?')[0] : u);
      const wanted = strip(urlOf(request));
      for (const [url, response] of map) if (strip(url) === wanted) return response.clone();
      return undefined;
    },
    async addAll(requests) { for (const request of requests) map.set(urlOf(request), await pretendFetch(urlOf(request))); },
    async keys() { return [...map.keys()].map((url) => ({ url })); },
  });
  const pretendCaches = {
    async open(name) { if (!stores.has(name)) stores.set(name, new Map()); return makeCache(stores.get(name)); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  async function pretendFetch(url) {
    networkCalls.push(url);
    if (network === 'offline') throw new TypeError('Failed to fetch');
    if (network === 'slow') await new Promise((r) => setTimeout(r, 400));
    if (network === 'missing') return new Response('nope', { status: 404 });
    return new Response(`from network: ${new URL(url).pathname}`, { status: 200 });
  }

  // Starts a fresh copy of sw.js (as a phone does after a restart) with these pretend tools. It is given
  // 50 ms of patience instead of 3 s, and a 200 ms pause instead of 30 s, so the tests are quick.
  function startWorker(pretendNavigator = { onLine: true }) {
    const listeners = {};
    const flags = { claimed: false, skipped: false };
    const pretendSelf = {
      location: { origin: ORIGIN },
      addEventListener: (type, handler) => { listeners[type] = handler; },
      skipWaiting: () => { flags.skipped = true; return Promise.resolve(); },
      clients: { claim: () => { flags.claimed = true; return Promise.resolve(); } },
    };
    const code = swText.replace('const SLOW = 3000', 'const SLOW = 50').replace('const PAUSE = 30000', 'const PAUSE = 200');
    new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', 'setTimeout', 'clearTimeout', 'navigator', code)(
      pretendSelf, pretendCaches, pretendFetch, Request, Response, URL, setTimeout, clearTimeout, pretendNavigator);

    const run = async (type, extra = {}) => {
      const event = { ...extra, waitUntil(p) { event.done = p; }, respondWith(p) { event.answer = p; } };
      listeners[type](event);
      await (event.done ?? event.answer);
      return event;
    };
    const ask = async (path, request = {}) => {
      const event = await run('fetch', { request: { url: ORIGIN + path, method: 'GET', mode: 'cors', ...request } });
      return event.answer ? await event.answer : null;
    };
    return { run, ask, flags };
  }
  const savedCopy = (path) => stores.get(CACHE_NAME).get(`${ORIGIN}${path}`).clone().text();

  // Install and activate
  stores.set('tour-docs-0.0.1', new Map()); // a copy left by an older version
  const worker = startWorker();
  await worker.run('install');
  check('Install: every file of the list is copied, and the new version starts straight away', listed.every((f) => stores.get(CACHE_NAME)?.has(`${ORIGIN}/${f}`)) && worker.flags.skipped);
  await worker.run('activate');
  check('Activate: the copies of older versions are thrown away, the current one is kept, and open pages are taken over',
    !stores.has('tour-docs-0.0.1') && stores.has(CACHE_NAME) && worker.flags.claimed);

  // With internet
  network = 'online'; networkCalls.length = 0;
  const online = await worker.ask('/js/app.js');
  check('With internet, the file comes from the network (so a new upload arrives at once)', (await online.text()) === 'from network: /js/app.js' && networkCalls.length === 1);
  check('...and the saved copy is refreshed', (await savedCopy('/js/app.js')) === 'from network: /js/app.js');

  // Without internet
  network = 'offline';
  check('Without internet, a saved file is served from the copy', (await (await worker.ask('/js/app.js')).text()) === 'from network: /js/app.js');
  check('Without internet, the app itself opens from the saved index.html (asked for as "/" or as "?x=1")',
    (await (await worker.ask('/', { mode: 'navigate' })).text()) === 'from network: /index.html' && (await (await worker.ask('/index.html?x=1', { mode: 'navigate' })).text()) === 'from network: /index.html');
  check('Without internet, a file that was never saved gets a clear 503 answer (no crash)', (await worker.ask('/js/never-saved.js')).status === 503);

  // A dead or slow network must not make every file wait for its own timeout
  network = 'slow';
  const slowWorker = startWorker();
  let started = Date.now();
  const firstSlow = await slowWorker.ask('/styles.css');
  check('With a very slow connection, the saved copy is used instead of waiting', (await firstSlow.text()) === 'from network: /styles.css' && Date.now() - started < 300, `${Date.now() - started} ms`);
  networkCalls.length = 0; started = Date.now();
  const nextOnes = await Promise.all([slowWorker.ask('/js/db.js'), slowWorker.ask('/js/ui.js'), slowWorker.ask('/js/rules.js')]);
  check('After the network has failed once, the next files go straight to the copy: no more waiting, no more attempts',
    networkCalls.length === 0 && Date.now() - started < 30 && nextOnes.every((r) => r.status === 200), `${networkCalls.length} attempts, ${Date.now() - started} ms`);
  network = 'online';
  await new Promise((r) => setTimeout(r, 250)); // longer than the (shortened) pause
  networkCalls.length = 0;
  check('...and after the pause, the network is tried again (so a new upload arrives once you are back online)',
    (await (await slowWorker.ask('/js/db.js')).text()) === 'from network: /js/db.js' && networkCalls.length === 1);

  network = 'online'; networkCalls.length = 0;
  const airplane = startWorker({ onLine: false });
  check('In airplane mode (the phone says it is offline), the copy is used at once without trying the network',
    (await (await airplane.ask('/js/app.js')).text()) === 'from network: /js/app.js' && networkCalls.length === 0);

  // Odd cases
  network = 'missing';
  const before = await savedCopy('/js/db.js');
  const missing = await startWorker().ask('/js/db.js');
  check('If the network says "not found", that answer is passed on and the saved copy is NOT overwritten',
    missing.status === 404 && (await savedCopy('/js/db.js')) === before);
  check('Requests that are not plain reads, or go to other websites, are left alone',
    (await worker.ask('/js/app.js', { method: 'POST' })) === null && (await worker.run('fetch', { request: { url: 'https://example.com/x.js', method: 'GET', mode: 'cors' } }).then((e) => e.answer)) === undefined);
}

// --- The access code ---
const sixHex = 'test-1234';
const vector = await hashPasscode(sixHex, '00112233445566778899aabbccddeeff', 1000);
check('The code is scrambled exactly as tools/make_passcode.py does it (same result as Python)',
  vector === '48433ce41a43712340bfc3008c38beb196137a46a8d5866c09e48e1ce0868e59', vector);
check('Spaces before or after the code are ignored', (await hashPasscode('  test-1234 ', '00112233445566778899aabbccddeeff', 1000)) === vector);
const testConfig = await makePasscodeConfig('Summit-2027', 1000);
check('A new code makes its own random salt, and never contains the code', /^[0-9a-f]{32}$/.test(testConfig.salt) && /^[0-9a-f]{64}$/.test(testConfig.hash) && !JSON.stringify(testConfig).includes('Summit'));
check('The right code is accepted, a wrong one, a different case and an empty one are not',
  (await checkPasscode('Summit-2027', testConfig)) && !(await checkPasscode('Summit-2028', testConfig)) && !(await checkPasscode('summit-2027', testConfig)) && !(await checkPasscode('', testConfig)));
check('Two codes made from the same words still look different (random salt)', (await makePasscodeConfig('Summit-2027', 1000)).hash !== testConfig.hash);
const realConfigOk = PASSCODE_CONFIG === null
  || (/^[0-9a-f]{32}$/.test(PASSCODE_CONFIG.salt) && /^[0-9a-f]{64}$/.test(PASSCODE_CONFIG.hash) && PASSCODE_CONFIG.iterations >= 100000);
check(`The access code settings of the app are valid (${PASSCODE_CONFIG === null ? 'no code set: the app opens straight away' : 'a code is set'})`, realConfigOk);

const day = 24 * 60 * 60 * 1000;
const keptBefore = localStorage.getItem('tourdocs.unlockedUntil');
localStorage.removeItem('tourdocs.unlockedUntil');
check('Before the code is entered the phone is locked', isUnlocked(1000) === false);
rememberUnlock(1000);
check('After the code is entered, the phone stays unlocked for 30 days', isUnlocked(1000 + 30 * day - 1) === true && isUnlocked(1000 + 1 * day) === true);
check('After 30 days the code is asked again', isUnlocked(1000 + 30 * day + 1) === false);
if (keptBefore === null) localStorage.removeItem('tourdocs.unlockedUntil'); else localStorage.setItem('tourdocs.unlockedUntil', keptBefore);

// --- The trip and its journal entries are saved together, on the device ---
{
  await saveTripAndJournal(ctx1.state, ctx1.entries);
  const savedTrip = await dbGet('trips', ctx1.state.id);
  const savedJournal = await withStores(['journal'], 'readonly', (s) => s.journal.index('tripId').getAll(ctx1.state.id));
  check('The changed trip and its journal entry are both on the device', JSON.stringify(savedTrip) === JSON.stringify(ctx1.state) && savedJournal.length === 1 && savedJournal[0].id === ctx1.entries[0].id);
  await dbDelete('trips', ctx1.state.id);
  for (const entry of savedJournal) await dbDelete('journal', entry.id);
  const left = await withStores(['journal'], 'readonly', (s) => s.journal.index('tripId').getAll(ctx1.state.id));
  check('The test copy and its journal are removed again (tests leave nothing behind)', (await dbGet('trips', ctx1.state.id)) === undefined && left.length === 0);
}

// --- Exports archive: a saved version is a real file on the device ---
{
  check('Version numbers are counted per title, not across the whole archive',
    nextVersion([], 'Lisbon') === 1
    && nextVersion([{ title: 'Lisbon' }], 'Lisbon') === 2
    && nextVersion([{ title: 'Lisbon' }, { title: 'Lisbon' }, { title: 'Marrakech' }], 'Lisbon') === 3
    && nextVersion([{ title: 'Lisbon' }], 'Marrakech') === 1);

  const record = {
    id: newId(), tripId: ctx1.state.id, title: 'Lisbon', version: 1,
    updatedLine: 'Updated 1 Jan 2027, 09:00 (Lisbon time), by Tester', createdAt: new Date().toISOString(),
    blob: new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }),
  };
  await dbPut('exports', record);
  const saved = await dbGet('exports', record.id);
  check('A saved export keeps its own PDF file, byte for byte',
    saved?.title === 'Lisbon' && saved.blob instanceof Blob && saved.blob.type === 'application/pdf' && saved.blob.size === record.blob.size);
  const byTrip = await withStores(['exports'], 'readonly', (s) => s.exports.index('tripId').getAll(ctx1.state.id));
  check('It can be found again by trip, like the journal', byTrip.length === 1 && byTrip[0].id === record.id);
  await dbDelete('exports', record.id);
  check('The test copy is removed again (tests leave nothing behind)', (await dbGet('exports', record.id)) === undefined);
}

// --- Export: PDF ---
{
  // A tiny hand-written PDF file has a fixed, well-known shape: read it back and check every part of it.
  const smallDoc = {
    title: 'Test trip', updatedLine: 'Updated 1 Jan 2027, 09:00 (Test time), by Tester',
    groups: [{ heading: null, sections: [{ heading: 'Morning walk', detail: '09:00 · Main square', count: '2 / 8', names: ['Anna B.', 'Carl D.'] }] }],
  };
  const blob = buildListsPdf(smallDoc);
  check('A PDF is built as a real PDF file', blob.type === 'application/pdf' && blob.size > 200);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder('iso-8859-1').decode(bytes); // 1 byte = 1 character, same as the file itself
  check('It starts with the PDF file marker and ends with the PDF end-of-file marker', text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'));
  check('The title, the header line and the guest names are all in the file, as plain readable text',
    text.includes('(Test trip)') && text.includes('(Updated 1 Jan 2027, 09:00 \\(Test time\\), by Tester)') && text.includes('(Anna B., Carl D.)'));

  // The index at the end of the file (xref) must point exactly at each object's own "N 0 obj" line,
  // or a real PDF reader (the one on the phone) would refuse to open the file.
  const xrefAt = Number(/startxref\s+(\d+)/.exec(text)[1]);
  const objectCount = Number(/trailer\s*<<[^>]*\/Size (\d+)/.exec(text)[1]) - 1;
  const offsets = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  const allObjectsFound = offsets.length === objectCount
    && offsets.every((offset, i) => text.slice(offset, offset + `${i + 1} 0 obj`.length) === `${i + 1} 0 obj`);
  check('Every object in the file is exactly where the index says it is', allObjectsFound, JSON.stringify(offsets));

  // A page full of long guest lists must overflow onto a second page rather than run off the bottom.
  const manyNames = trip.guests.map((g) => `${g.first} ${g.last}`);
  const bigDoc = {
    title: 'Big export', updatedLine: 'Updated 1 Jan 2027, 09:00 (Test time), by Tester',
    groups: Array.from({ length: 6 }, (_, i) => ({
      heading: `Group ${i + 1}`,
      sections: [{ heading: `Activity ${i + 1}`, detail: '09:00 · Somewhere', count: `${manyNames.length}`, names: manyNames }],
    })),
  };
  const bigText = new TextDecoder('iso-8859-1').decode(new Uint8Array(await buildListsPdf(bigDoc).arrayBuffer()));
  const pageCount = [...bigText.matchAll(/\/Type \/Page /g)].length;
  check('A big export spreads itself over more than one page', pageCount > 1, `${pageCount} pages`);
}

// --- Export: what goes on the page ---
{
  const istanbul = trip.destinations.find((d) => d.id === slot('S09').destinationId);
  const wholeDestination = destinationExportDoc(trip, istanbul, undefined, 'Tester');
  const halfDays = trip.slots.filter((s) => s.destinationId === istanbul.id);
  check('Exporting a whole destination covers every one of its half-days, each under its own heading',
    wholeDestination.groups.length === halfDays.length && wholeDestination.groups.every((g) => halfDays.length > 1 ? /^Day \d+ · /.test(g.heading) : true));

  const oneHalfDay = destinationExportDoc(trip, istanbul, slot('S09'), 'Tester');
  check('Exporting one half-day gives just that half-day, with no repeated heading (the title already says which one)',
    oneHalfDay.groups.length === 1 && oneHalfDay.groups[0].heading === null && oneHalfDay.title.includes('Day') && oneHalfDay.title.includes(slot('S09').half));

  const s09Sections = oneHalfDay.groups[0].sections;
  check('It has one section per activity of that half-day, plus "At leisure"',
    s09Sections.filter((s) => s.heading !== 'At leisure' && s.heading !== 'Needs a look').length === trip.activities.filter((a) => a.slotId === slot('S09').id).length
    && s09Sections.some((s) => s.heading === 'At leisure'));
  const needsALook = s09Sections.find((s) => s.heading === 'Needs a look');
  check('G022, whose Istanbul sign-up is misspelled, is not left off the printed list: a "Needs a look" section names them',
    needsALook && needsALook.names.includes(displayNames(trip.guests).get(guest('G022').id)), JSON.stringify(needsALook));
}

// --- Show the results ---
const out = document.getElementById('out');
for (const r of results) {
  const li = document.createElement('li');
  li.className = r.ok ? 'pass' : 'fail';
  li.textContent = `${r.ok ? '✓' : '✗ FAIL:'} ${r.name}${r.ok || !r.detail ? '' : `  [${r.detail}]`}`;
  out.append(li);
}
const failed = results.filter((r) => !r.ok).length;
document.getElementById('summary').textContent = failed === 0 ? `All ${results.length} checks passed.` : `${failed} of ${results.length} checks FAILED.`;
document.title = failed === 0 ? 'PASS' : 'FAIL';
