// Automatic checks. Open tests.html in the browser: every line should be green.
// They cover the sample trip's planted test cases (see SPEC.md) that step 1 can check, plus
// time zones, unique IDs, saving on the device, and files with mistakes.

import { buildTrip } from './loader.js';
import { dbGet, dbPut, dbAll, dbDelete, withStores, saveTripAndJournal } from './db.js';
import { applyChange, validateChanges } from './changes.js';
import { makeOwner } from './users.js';
import { newId } from './ids.js';
import { localToInstant, formatTime, formatWeekdayDate, tripDates, isValidTimeZone } from './time.js';
import { plain, displayNames, partyLabel, whoIsWhere, guestPlace, capacityInfo, countIn, partyMovers } from './rules.js';

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
    owner: user, state: structuredClone(trip), commits: [], journal: [],
    trip: (id) => (id === ctx.state.id ? ctx.state : undefined),
    async commit(next, entries) { ctx.commits.push(next); ctx.journal.push(...entries); ctx.state = next; },
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
  const e = ctx.journal[0];
  check('Leaving the Hammam for At leisure works: one save, one journal entry', r.ok && ctx.commits.length === 1 && ctx.journal.length === 1);
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
  check('A refused change saves nothing and writes nothing', ctx.commits.length === 0 && ctx.journal.length === 0);
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
  check('An empty sign-up (G014) can be filled; the journal says "Nothing chosen yet"', r.ok && ctx.journal[0].from.kind === 'blank' && ctx.journal[0].from.label === 'Nothing chosen yet', JSON.stringify(ctx.journal[0]?.from));
  const ctx2 = makeCtx();
  const target2 = trip.activities.find((a) => a.slotId === slot('S09').id && (a.capacity === null || countIn(trip, a) < a.capacity));
  const r2 = await applyChange(ctx2, trip.id, moveOf('G022', 'S09', { kind: 'activity', activityId: target2.id }));
  check('The misspelled activity (G022) can be fixed; the journal keeps the misspelling as typed',
    r2.ok && ctx2.journal[0].from.kind === 'unknown' && ctx2.journal[0].from.label.includes('Topkapi palace & Hagia Sofia'), JSON.stringify(ctx2.journal[0]?.from));
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
    good.ok && ctx.commits.length === 1 && ctx.journal.length === 2 && ctx.journal[0].batchId === ctx.journal[1].batchId);
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
    ctx.commits.length === 1 && ctx.journal.length === booked + 1 && new Set(ctx.journal.map((e) => e.batchId)).size === 1
    && ctx.journal.filter((e) => e.cause === 'cancel-tour').length === booked && ctx.journal[0].type === 'cancel-tour' && ctx.journal[0].guestCount === booked);
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
  const text = JSON.stringify(ctx.journal);
  check('The journal has no dietary info (G034 has a shellfish allergy)', ctx.journal.length === 1 && !/allerg|shellfish|dietary/i.test(text), text.slice(0, 200));
}

// --- The trip and its journal entries are saved together, on the device ---
{
  await saveTripAndJournal(ctx1.state, ctx1.journal);
  const savedTrip = await dbGet('trips', ctx1.state.id);
  const savedJournal = await withStores(['journal'], 'readonly', (s) => s.journal.index('tripId').getAll(ctx1.state.id));
  check('The changed trip and its journal entry are both on the device', JSON.stringify(savedTrip) === JSON.stringify(ctx1.state) && savedJournal.length === 1 && savedJournal[0].id === ctx1.journal[0].id);
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
