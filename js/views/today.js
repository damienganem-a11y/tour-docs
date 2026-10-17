// The first screen of a trip (owner's plan, 17 Oct 2026, after the audit): what needs attention, what comes next, and the three things most
// often looked for. Everything here is only READ from the trip, nothing is changed from this screen.

import { h } from '../dom.js';
import { tripDates, formatTime, formatWeekdayDate, localDateNow } from '../time.js';
import { programOf } from '../program.js';
import { tripWarnings, countIn } from '../rules.js';
import { pageHead } from './chrome.js';

// The next tour that has not started yet (not cancelled, with a start time), across the whole trip. Null when there is none.
export function nextTour(trip, now = new Date()) {
  const upcoming = trip.activities.filter((a) => !a.cancelled && a.startsAt && a.startsAt >= now.toISOString());
  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return upcoming[0] ?? null;
}

// The program days that are today, each judged in its own destination's time zone (a trip can cross zones). Usually one.
export function programToday(trip, now = new Date()) {
  const found = [];
  for (const destination of trip.destinations) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: destination.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    for (const day of programOf(trip, destination.id)) if (day.date === today) found.push({ destination, day });
  }
  return found;
}

export function todayPage(ctx, trip) {
  const base = `#/trip/${trip.id}`;
  const role = ctx.roleFor(trip.id);
  const row = (href, label, hint, badge = null) => h('a', { class: 'menu-row', href },
    h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, label), hint ? h('span', { class: 'menu-hint' }, hint) : null),
    h('span', { class: 'menu-side' }, badge ? h('span', { class: 'tile-badge tile-badge--row' }, String(badge)) : null, h('span', { class: 'row-chev' }, '›')));

  // 1. Needs attention: what is waiting for this person (inbox items that ask for a decision) and the trip's own warnings.
  const todo = ctx.inboxFor(trip.id).filter((item) => item.todo);
  const w = tripWarnings(trip);
  const warningCount = w.overbooked.length + w.blank.length + w.unknown.length + w.explorer.length + w.waitlistRoom.length;
  const attention = [
    ...todo.slice(0, 4).map((item) => row(item.kind === 'conflict' ? `${base}/settings/check` : item.href, item.title, item.detail)),
    warningCount > 0 && role !== 'viewer' ? row(`${base}/settings/warnings`, 'Warnings', `${warningCount} thing${warningCount === 1 ? '' : 's'} to look at`, warningCount) : null,
  ].filter(Boolean);
  if (todo.length > 4) attention.push(row(`${base}/settings/requests`, 'And more waiting', `${todo.length - 4} more`));

  // 2. Next up.
  const tour = nextTour(trip);
  let next = h('p', { class: 'muted' }, 'No tour with a start time is coming up.');
  if (tour) {
    const slot = trip.slots.find((s) => s.id === tour.slotId);
    const destination = trip.destinations.find((d) => d.id === slot.destinationId);
    const count = countIn(trip, tour);
    next = h('div', { class: 'menu' }, row(`${base}/use/destination/${destination.id}/${slot.id}`, tour.name,
      `${formatWeekdayDate(slot.date)} · ${formatTime(tour.startsAt, destination.timeZone)} · ${destination.name}${tour.meeting ? ` · ${tour.meeting}` : ''} · ${count}${tour.capacity ? ` / ${tour.capacity}` : ''} booked`));
  }

  // 3. Today's daily program (what the guests are given), when there is one.
  const program = programToday(trip).map(({ destination, day }) => h('div', { class: 'menu' },
    row(`${base}/settings/program/${destination.id}/${day.date}`, day.title || formatWeekdayDate(day.date), `${destination.name} · ${day.items.length} item${day.items.length === 1 ? '' : 's'}`),
    ...day.items.map((i) => h('div', { class: 'menu-row' }, h('span', { class: 'menu-text' },
      h('span', { class: 'menu-label' }, `${i.startsAt ? `${formatTime(i.startsAt, destination.timeZone)} · ` : ''}${i.title}`), i.place ? h('span', { class: 'menu-hint' }, i.place) : null)))));

  return h('div', {},
    pageHead({ eyebrow: 'Today', title: trip.name, subtitle: `${tripDates(trip.start, trip.days)} · ${trip.guests.length} guests` }),
    h('h3', { class: 'section-title' }, 'Needs attention'),
    attention.length > 0 ? h('div', { class: 'menu' }, attention) : h('p', { class: 'muted' }, 'Nothing needs your attention.'),
    h('h3', { class: 'section-title' }, 'Next up'),
    next,
    program.length > 0 ? h('h3', { class: 'section-title' }, 'Program of the day') : null,
    ...program,
    h('h3', { class: 'section-title' }, 'Quick links'),
    h('div', { class: 'menu' },
      row(`${base}/settings/messages`, 'Messages', 'The team, the guests, reminders'),
      row(`${base}/use/guest`, 'Find a guest', 'Where is everybody, one guest at a time'),
      role === 'viewer' ? null : row(`${base}/settings/exports`, 'Documents', 'Lists, cards and sheets')));
}
