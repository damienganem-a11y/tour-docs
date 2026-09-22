// Times and dates.
//
// The rule: we STORE exact moments (a UTC time like 2027-01-12T15:00:00.000Z) and DISPLAY them
// in the local time of the destination ("15:00 in Lisbon"). The trip file gives an activity's
// start as a local clock time ("15:00") plus the day and the destination, so on loading we turn
// that into an exact moment (localToInstant), and on screen we turn it back (formatTime).
//
// The browser already knows every time zone and every daylight-saving rule (through Intl),
// so we use it instead of adding a library.

// What a time field should show as the owner types digits into it: the ":" is added automatically
// after the hour, since many phone keyboards (numeric ones especially) have no ":" key.
// "1" -> "1", "18" -> "18", "183" -> "18:3", "18:30" (already formatted, e.g. backspacing) -> "18:30".
export function formatTypedTime(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

// Is this a time zone name the browser knows, such as "Asia/Tokyo"?
export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return typeof timeZone === 'string' && timeZone.length > 0;
  } catch {
    return false;
  }
}

// How far ahead of UTC a time zone is at a given moment, in minutes. Tokyo is +540, Lisbon in winter is 0.
function offsetMinutes(timeZone, instantMs) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(instantMs));
  const part = (type) => Number(parts.find((p) => p.type === type).value);

  // The wall clock in that zone, read as if it were UTC, minus the real UTC moment = the offset.
  const wallClockAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'));
  const wholeSeconds = Math.floor(instantMs / 1000) * 1000;
  return (wallClockAsUtc - wholeSeconds) / 60000;
}

// "2027-01-12" + "15:00" + "Europe/Lisbon"  ->  "2027-01-12T15:00:00.000Z" (the exact moment).
export function localToInstant(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  // First guess: remove the offset as it was at the wall-clock moment. Second pass: remove the
  // offset as it is at that guess, which corrects the result when daylight saving changes nearby.
  const firstGuess = wallClockAsUtc - offsetMinutes(timeZone, wallClockAsUtc) * 60000;
  const exact = wallClockAsUtc - offsetMinutes(timeZone, firstGuess) * 60000;
  return new Date(exact).toISOString();
}

// An exact moment shown as a clock time in a time zone: ("2027-01-12T15:00:00.000Z", "Europe/Lisbon") -> "15:00".
export function formatTime(instant, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(instant));
}

// An exact moment as a short date and time in a time zone:
// ("2027-01-12T15:30:00.000Z", "Asia/Tokyo") -> "13 Jan, 00:30".
export function formatMoment(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(instant));
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('day')} ${part('month')}, ${part('hour')}:${part('minute')}`;
}

// Today's date (e.g. "2027-01-12") in a given time zone. A trip that spans time zones does not have one
// single "today": Kyoto can already be tomorrow while Lisbon is still on today. Used to tell a half-day
// that is over from one that is not (see "Earlier in the trip" on a guest's page).
export function localDateNow(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// ---------- Calendar dates (a day, with no time and no time zone) ----------

// "2027-01-12" plus 23 days -> "2027-02-04"
export function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// "2027-01-12" -> "12 Jan" (or "12 Jan 2027" with the year)
function formatDay(date, withYear) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day))
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });
}

// "2027-01-16" -> "Sat 16 Jan"
export function formatWeekdayDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .formatToParts(new Date(Date.UTC(year, month - 1, day)));
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('weekday')} ${part('day')} ${part('month')}`; // built by hand so the wording is the same on every phone
}

// First and last day of a trip: "12 Jan to 4 Feb 2027".
export function tripDates(start, days) {
  const last = addDays(start, days - 1);
  const sameYear = start.slice(0, 4) === last.slice(0, 4);
  return `${formatDay(start, !sameYear)} to ${formatDay(last, true)}`;
}
