// The "rehearsal trip": a tiny fictional trip that starts TODAY, on the clock of this phone, so the reminders, the alerts and the notifications can be tried
// in real time (owner's request, 4 Oct 2026). Everything is relative to the moment it is loaded:
//   - a tour about 75 minutes from now (its "one hour before" reminder arrives in about 15 minutes, its roll-call alert 15 minutes after it starts),
//   - tours tomorrow (their "evening before" reminder is at 19:00 today),
//   - an evening with two restaurants and nobody booked (the dinner alert is at 15:00).
// Pure: it gives the trip file's content (the same shape as the sample trips); trips.js loads it like any other file. Fictional names only.

import { addDays } from './time.js';

const pad = (n) => String(n).padStart(2, '0');
const clock = (minutes) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

// "now" as { date: 'YYYY-MM-DD', minutes: minutes since midnight } on the clock of `timeZone`.
function wallNow(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function rehearsalTrip(now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const wall = wallNow(now, timeZone);
  // The first tour starts in about 75 minutes (rounded up to 5). Too close to midnight: the rehearsal starts tomorrow morning instead.
  let first = Math.ceil((wall.minutes + 75) / 5) * 5;
  let day1 = wall.date;
  if (first > 21 * 60) { first = 9 * 60; day1 = addDays(wall.date, 1); }
  const day2 = addDays(day1, 1); const day3 = addDays(day1, 2);
  const slot = (id, day, date, half, options) => ({ id, day, date, dest: 'Rehearsal City', country: 'France', dest_index: 1, half, timezone: timeZone, options });
  const tour = (id, name, start, meeting, cap, extra = {}) => ({ id, name, short: '', start, meeting, cap, duration: 'About 1 hour', difficulty: 'easy', difficulty_note: 'A gentle walk on flat ground.',
    description: `Today, we try the reminders for real. ${name} is a rehearsal: nothing here is a real tour.`, bring: 'Nothing: this is a test.', accessibility: 'Level ground, no steps, no lift needed.', ...extra });
  const slots = [
    slot('S01', 1, day1, 'Afternoon', [tour('S01-1', 'Rehearsal: harbour walk', clock(first), 'Hotel lobby', 3), tour('S01-2', 'Rehearsal: market visit', clock(first), 'Market gate', 3)]),
    slot('S02', 1, day1, 'Evening', []),
    slot('S03', 2, day2, 'Morning', [tour('S03-1', 'Rehearsal: old town walk', '09:00', 'Hotel lobby', 10)]),
    slot('S04', 2, day2, 'Afternoon', [tour('S04-1', 'Rehearsal: boat trip', '14:00', 'The pier', 10)]),
    slot('S05', 2, day2, 'Evening', []),
    slot('S06', 3, day3, 'Morning', [tour('S06-1', 'Rehearsal: farewell coffee', '10:00', 'Hotel lobby', null)]),
  ];
  const guests = [
    ['G001', 'Alma', 'Lindqvist', 'P01', 'Couple'], ['G002', 'Bruno', 'Lindqvist', 'P01', 'Couple'], ['G003', 'Chloe', 'Marchetti', 'P02', 'Couple'],
    ['G004', 'Dario', 'Marchetti', 'P02', 'Couple'], ['G005', 'Elena', 'Fischer', 'P03', 'Solo'], ['G006', 'Farid', 'Haddad', 'P04', 'Solo'],
  ].map(([id, first, last, party, ptype]) => ({ id, first, last, party, ptype, seat: '', notes: '', dietary: '' }));
  const pick = (index, a, b) => (index % 2 === 0 ? a : b);
  const signups = Object.fromEntries(guests.map((g, i) => [g.id, {
    S01: pick(i, 'Rehearsal: harbour walk', 'Rehearsal: market visit'), S02: 'At leisure', S03: 'Rehearsal: old town walk', S04: i < 4 ? 'Rehearsal: boat trip' : 'At leisure', S05: 'At leisure', S06: 'Rehearsal: farewell coffee',
  }]));
  return {
    trip: { code: 'TEST-01', name: 'Rehearsal trip (starts today, fictional)', start: day1, days: 3, default_vehicles: 1 },
    destinations: [{ index: 1, name: 'Rehearsal City', country: 'France', timezone: timeZone, first_day: 1, last_day: 3, photo: '', facts: ['This city exists only to test the reminders.', 'A reminder is sent by a timer on a server, even when your phone is shut.', 'Good rehearsals make calm trips.'] }],
    guests, slots, signups,
  };
}
