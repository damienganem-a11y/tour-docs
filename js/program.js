// The daily program of a destination (owner's request, 17 Oct 2026): what the guests are given for each day, step after step. It is its own list,
// not made of bookings: arrivals, a welcome desk, lectures, meals, transfers, flights, notes.
//
//   trip.program   [ { id, destinationId, date, title, notes: [text], items: [ { id, startsAt, endsAt, kind, title, place, text, lines: [text] } ] } ]
//     one entry per day of a destination. The ORDER of items is the owner's order (nothing is sorted behind their back).
//     startsAt / endsAt are exact moments (or null: an item with no time); they are shown in the destination's local time.
//
// The screens and the import work with "day inputs": the same days, but with times as typed ("09:30") instead of moments:
//   { date: '2027-06-05', title, notes: [text], items: [ { id?, time: '09:30' | '', endTime: '' | 'HH:MM', kind, title, place, text, lines: [text] } ] }

import { newId } from './ids.js';
import { localToInstant, formatTime } from './time.js';

export const PROGRAM_KINDS = [
  ['event', 'Event'], ['meal', 'Meal'], ['lecture', 'Lecture'], ['transfer', 'Transfer'], ['flight', 'Flight'], ['note', 'Note'],
];
const KINDS = new Set(PROGRAM_KINDS.map(([id]) => id));
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LIMITS = { days: 31, items: 80, lines: 12, notes: 12, title: 120, place: 120, text: 1500, line: 160, note: 500 };

const isRealDate = (date) => DATE_RE.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const words = (value) => String(value ?? '').trim();
const listOf = (value) => (Array.isArray(value) ? value.map((v) => words(v)).filter(Boolean) : []);

// Returns a sentence saying what is wrong with these day inputs, or null when they are fine.
export function programError(days) {
  if (!Array.isArray(days)) return 'The program is not a list of days.';
  if (days.length > LIMITS.days) return `A destination can have up to ${LIMITS.days} days of program.`;
  const seen = new Set();
  for (const day of days) {
    if (!isRealDate(day?.date)) return 'Each day needs a real date (like 2027-06-05).';
    if (seen.has(day.date)) return `The date ${day.date} appears twice.`;
    seen.add(day.date);
    if (words(day.title).length > LIMITS.title) return `A day title can have up to ${LIMITS.title} letters.`;
    const notes = listOf(day.notes);
    if (notes.length > LIMITS.notes || notes.some((n) => n.length > LIMITS.note)) return `A day can have up to ${LIMITS.notes} notes of ${LIMITS.note} letters or fewer.`;
    const items = Array.isArray(day.items) ? day.items : [];
    if (items.length > LIMITS.items) return `A day can have up to ${LIMITS.items} items.`;
    for (const item of items) {
      if (!words(item?.title)) return `Every item of ${day.date} needs a title.`;
      if (!KINDS.has(item.kind ?? 'event')) return `"${item.title}": unknown kind "${item.kind}".`;
      if (words(item.title).length > LIMITS.title || words(item.place).length > LIMITS.place) return `"${words(item.title).slice(0, 30)}": the title and place are limited to ${LIMITS.title} letters.`;
      if (words(item.text).length > LIMITS.text) return `"${item.title}": the text is limited to ${LIMITS.text} letters.`;
      const lines = listOf(item.lines);
      if (lines.length > LIMITS.lines || lines.some((l) => l.length > LIMITS.line)) return `"${item.title}": up to ${LIMITS.lines} lines of ${LIMITS.line} letters.`;
      if (item.time && !TIME_RE.test(item.time)) return `"${item.title}": the time should look like 09:30.`;
      if (item.endTime && !TIME_RE.test(item.endTime)) return `"${item.title}": the end time should look like 09:30.`;
      if (item.endTime && !item.time) return `"${item.title}": an end time needs a start time.`;
    }
  }
  return null;
}

// The stored days for a destination, made from valid day inputs (ids kept when given, new ones otherwise), in date order.
export function cleanProgram(destination, days) {
  return [...days].sort((a, b) => a.date.localeCompare(b.date)).map((day) => ({
    id: day.id ?? newId(), destinationId: destination.id, date: day.date, title: words(day.title), notes: listOf(day.notes),
    items: (day.items ?? []).map((item) => ({
      id: item.id ?? newId(),
      startsAt: item.time ? localToInstant(day.date, item.time, destination.timeZone) : null,
      endsAt: item.endTime ? localToInstant(day.date, item.endTime, destination.timeZone) : null,
      kind: item.kind ?? 'event', title: words(item.title), place: words(item.place), text: words(item.text), lines: listOf(item.lines),
    })),
  }));
}

// The days of one destination as stored, in date order.
export function programOf(trip, destinationId) {
  return (trip.program ?? []).filter((d) => d.destinationId === destinationId).sort((a, b) => a.date.localeCompare(b.date));
}

// Stored days -> day inputs, for the editor.
export function programForEditing(days, timeZone) {
  return days.map((day) => ({
    id: day.id, date: day.date, title: day.title, notes: [...day.notes],
    items: day.items.map((item) => ({
      id: item.id, time: item.startsAt ? formatTime(item.startsAt, timeZone) : '', endTime: item.endsAt ? formatTime(item.endsAt, timeZone) : '',
      kind: item.kind, title: item.title, place: item.place, text: item.text, lines: [...item.lines],
    })),
  }));
}

// The same days with every time worked out again for a new time zone, keeping the clock times as they were (see changes.js, edit-destination).
export function retimeProgram(days, oldZone, newZone) {
  return days.map((day) => ({
    ...day,
    items: day.items.map((item) => ({
      ...item,
      startsAt: item.startsAt ? localToInstant(day.date, formatTime(item.startsAt, oldZone), newZone) : null,
      endsAt: item.endsAt ? localToInstant(day.date, formatTime(item.endsAt, oldZone), newZone) : null,
    })),
  }));
}
