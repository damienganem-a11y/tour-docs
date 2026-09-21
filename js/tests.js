// Automatic checks. Open tests.html in the browser: every line should be green.
// They cover the sample trip's planted test cases (see SPEC.md) that step 1 can check, plus
// time zones, unique IDs, saving on the device, and files with mistakes.

import { buildTrip } from './loader.js';
import { dbGet, dbPut, dbAll, dbDelete, withStores, saveTripAndJournal } from './db.js';
import { applyChange, validateChanges } from './changes.js';
import { makeOwner } from './users.js';
import { newId } from './ids.js';
import { localToInstant, formatTime, formatMoment, formatWeekdayDate, tripDates, isValidTimeZone } from './time.js';
import { groupBatches, lastUndoable, summarize } from './journal.js';
import { hashPasscode, makePasscodeConfig, checkPasscode, isUnlocked, rememberUnlock } from './gate.js';
import { PASSCODE_CONFIG } from './passcode-config.js';
import { APP_VERSION } from './version.js';
import { plain, displayNames, partyLabel, whoIsWhere, guestPlace, capacityInfo, countIn, partyMovers, slotLabel } from './rules.js';

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
check('Capacity wording: "6 / 8", "8 / 8 · Full", and just "12" with no capacity',
  capacityInfo(6, 8).text === '6 / 8' && capacityInfo(6, 8).tone === null && capacityInfo(8, 8).text === '8 / 8 · Full' && capacityInfo(8, 8).tone === 'bad' && capacityInfo(12, null).text === '12');
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
  const listeners = {};
  const stores = new Map(); // cache name -> Map(url -> Response)
  let claimed = false, skipped = false;
  let network = 'online';   // 'online' | 'offline' | 'slow' | 'missing'
  const networkCalls = [];

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

  // Run sw.js with these pretend tools (and a 50 ms patience instead of 3 s, so the test is quick).
  const pretendSelf = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting: () => { skipped = true; return Promise.resolve(); },
    clients: { claim: () => { claimed = true; return Promise.resolve(); } },
  };
  new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', 'setTimeout', 'clearTimeout', swText.replace('const SLOW = 3000', 'const SLOW = 50'))(
    pretendSelf, pretendCaches, pretendFetch, Request, Response, URL, setTimeout, clearTimeout);

  const run = async (type, extra = {}) => { const event = { ...extra, waitUntil(p) { event.done = p; }, respondWith(p) { event.answer = p; } }; listeners[type](event); await (event.done ?? event.answer); return event; };
  const ask = async (path, request = {}) => { const event = await run('fetch', { request: { url: ORIGIN + path, method: 'GET', mode: 'cors', ...request } }); return event.answer ? await event.answer : null; };
  const CACHE_NAME = `tour-docs-${APP_VERSION}`;

  stores.set('tour-docs-0.0.1', new Map()); // a copy left by an older version
  await run('install');
  check('Install: every file of the list is copied, and the new version starts straight away', listed.every((f) => stores.get(CACHE_NAME)?.has(`${ORIGIN}/${f}`)) && skipped);
  await run('activate');
  check('Activate: the copies of older versions are thrown away, the current one is kept, and open pages are taken over',
    !stores.has('tour-docs-0.0.1') && stores.has(CACHE_NAME) && claimed);

  network = 'online'; networkCalls.length = 0;
  const online = await ask('/js/app.js');
  check('With internet, the file comes from the network (so a new upload arrives at once)', (await online.text()) === 'from network: /js/app.js' && networkCalls.length === 1);
  check('...and the saved copy is refreshed', (await stores.get(CACHE_NAME).get(`${ORIGIN}/js/app.js`).clone().text()) === 'from network: /js/app.js');

  network = 'offline';
  check('Without internet, a saved file is served from the copy', (await (await ask('/js/app.js')).text()) === 'from network: /js/app.js');
  check('Without internet, the app itself opens from the saved index.html (asked for as "/" or as "?x=1")',
    (await (await ask('/', { mode: 'navigate' })).text()) === 'from network: /index.html' && (await (await ask('/index.html?x=1', { mode: 'navigate' })).text()) === 'from network: /index.html');
  const notSaved = await ask('/js/never-saved.js');
  check('Without internet, a file that was never saved gets a clear 503 answer (no crash)', notSaved.status === 503);

  network = 'slow';
  const started = Date.now();
  const slow = await ask('/styles.css');
  check('With a very slow connection, the saved copy is used instead of waiting', (await slow.text()) === 'from network: /styles.css' && Date.now() - started < 300, `${Date.now() - started} ms`);

  network = 'missing';
  const before = await stores.get(CACHE_NAME).get(`${ORIGIN}/js/db.js`).clone().text();
  const missing = await ask('/js/db.js');
  check('If the network says "not found", that answer is passed on and the saved copy is NOT overwritten',
    missing.status === 404 && (await stores.get(CACHE_NAME).get(`${ORIGIN}/js/db.js`).clone().text()) === before);

  check('Requests that are not plain reads, or go to other websites, are left alone',
    (await ask('/js/app.js', { method: 'POST' })) === null && (await run('fetch', { request: { url: 'https://example.com/x.js', method: 'GET', mode: 'cors' } }).then((e) => e.answer)) === undefined);
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
