// Reception and lounge screens (v0.144.0, owner's decisions, 5 Nov 2026). Pure: works out WHAT a reception link or a lounge screen shows; app.js
// sends it to the server (display_links.sheet) whenever it changes, and the pages (app/display/) show it.
//
// A sheet holds every day of the trip (of one destination, or of the whole trip for a cruise), each with its tours in time order:
//   { v, trip, company, accent, names, days: [{ date, label, timeZone, place, tours: [{ name, time, startsAt, half, meeting, place, cancelled, booked,
//     capacity, final, colours: [{ name, hex, ink, emoji, count, guests? }], others: { count, guests? } }] }] }
// The page picks today and tomorrow itself (in each day's own time zone), so the sheet only changes when the tours change, never at midnight.
// Colours appear once they are validated (final); until then the tour lists its guests without colours. `guests` (names) only when names are on.
// Never a phone number, never allergies or dietary needs, never anything else about a guest.

import { bookedOnActivity, displayNames, colorOf, alphabetical } from './rules.js';
import { formatTime, formatWeekdayDate } from './time.js';

export const DISPLAY_SHEET_VERSION = 1;
const HALF_ORDER = ['Morning', 'Full day', 'Afternoon', 'Evening'];

export function displaySheet(trip, { destinationId = null, showNames = true } = {}) {
  const names = displayNames(trip.guests);
  const byName = alphabetical(names);
  const nameList = (guests) => (showNames ? [...guests].sort(byName).map((g) => names.get(g.id)) : undefined);
  const slots = trip.slots.filter((s) => !destinationId || s.destinationId === destinationId);
  const dates = [...new Set(slots.map((s) => s.date))].sort();
  const days = dates.map((date) => {
    const daySlots = slots.filter((s) => s.date === date);
    const destination = trip.destinations.find((d) => d.id === daySlots[0].destinationId);
    const tours = trip.activities.filter((a) => daySlots.some((s) => s.id === a.slotId)).map((a) => {
      const slot = daySlots.find((s) => s.id === a.slotId);
      const place = trip.destinations.find((d) => d.id === slot.destinationId);
      const booked = a.cancelled ? [] : bookedOnActivity(trip, a.id);
      const split = (trip.splits ?? []).find((x) => x.activityId === a.id);
      const final = Boolean(split?.validatedAt);
      const colours = final ? split.groups.map((g) => {
        const members = booked.filter((guest) => split.assignments[guest.id] === g.id);
        const c = colorOf(g.color);
        return { name: c && !g.name.includes(c.name) ? `${c.name} · ${g.name}` : g.name, hex: c?.hex ?? '#607d8b', ink: c?.ink ?? '#ffffff', emoji: c?.emoji ?? '', count: members.length, guests: nameList(members) };
      }).filter((c) => c.count > 0) : [];
      const others = final ? booked.filter((guest) => !split.groups.some((g) => g.id === split.assignments[guest.id])) : booked;
      return {
        name: a.name, time: a.startsAt && place?.timeZone ? formatTime(a.startsAt, place.timeZone) : null, startsAt: a.startsAt ?? null, half: slot.half,
        meeting: a.meeting || null, place: place?.name ?? null, cancelled: Boolean(a.cancelled), booked: booked.length, capacity: a.capacity ?? null,
        final, colours, others: { count: others.length, guests: nameList(others) },
      };
    }).sort((x, y) => (x.startsAt ?? '').localeCompare(y.startsAt ?? '') || HALF_ORDER.indexOf(x.half) - HALF_ORDER.indexOf(y.half) || x.name.localeCompare(y.name));
    return { date, label: formatWeekdayDate(date), timeZone: destination?.timeZone ?? 'UTC', place: destination?.name ?? null, tours };
  });
  return { v: DISPLAY_SHEET_VERSION, trip: trip.name, company: trip.branding?.companyName || '', accent: trip.branding?.accent || '#1d5c57', names: showNames, days };
}

// A short fingerprint of a sheet: the server notes "changed at" only when it differs (FNV-1a, enough to tell two versions apart; not a secret).
export function sheetKey(sheet) {
  const text = JSON.stringify(sheet);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `${text.length}-${hash.toString(16)}`;
}

// Which days a page shows: kept with the pages (app/display/days.js), so the TV does not load the whole app to know it.
export { daysToShow } from '../display/days.js';
