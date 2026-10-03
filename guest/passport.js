// The virtual passport (the guest app): one stamp per destination, given when the group's first day there begins IN THAT PLACE'S OWN TIME ZONE.
// Pure and small, so the leader's tests can check it: no page, no network.

// What day is it in a time zone, as "2027-08-29"? `now` is a Date (or, to pretend, a plain "YYYY-MM-DD" string that is simply returned).
export function dayIn(timeZone, now = new Date()) {
  if (typeof now === 'string') return now;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// For each destination of the sheet: is its stamp given yet? ("2027-08-29" strings compare in date order.) `now` as for dayIn.
// Returns [{ ...destination, given: boolean, today: "YYYY-MM-DD" }], in trip order.
export function passportState(destinations, now = new Date()) {
  return (destinations ?? []).map((d) => {
    const today = dayIn(d.tz || 'UTC', now);
    return { ...d, today, given: today >= d.firstDate };
  });
}

// A small stable number from a text, so each destination keeps its own tilt and colour from one visit to the next.
export function hashOf(text) {
  let n = 0;
  for (const ch of String(text)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n;
}
// The stamp pictures are drawn in stamps.js (one design per place).
export { stampSvg } from './stamps.js';

// A wall-clock time in a place ("2027-09-08", "07:30", "Asia/Phnom_Penh") as the exact moment it is. Uses only the phone's own Intl: the offset
// of the zone at that moment is read back and applied (two passes, so a daylight-saving change in between is still right).
export function wallToInstant(date, clock, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = clock.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (instant) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(instant));
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instant;
  };
  let instant = asUtc - offsetAt(asUtc);
  instant = asUtc - offsetAt(instant);
  return new Date(instant);
}
