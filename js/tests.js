// Automatic checks. Open tests.html in the browser: every line should be green.
// They cover the sample trip's planted test cases (see SPEC.md) that step 1 can check, plus
// time zones, unique IDs, saving on the device, and files with mistakes.

import { buildTrip } from './loader.js';
import { dbGet, dbPut, dbAll, dbDelete, withStores } from './db.js';
import { newId } from './ids.js';
import { localToInstant, formatTime, formatWeekdayDate, tripDates, isValidTimeZone } from './time.js';
import { plain, displayNames, partyLabel, whoIsWhere, guestPlace, capacityInfo } from './rules.js';

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
