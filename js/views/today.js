// The first screen of a trip (owner's plan, 17 Oct 2026, after the audit): what needs attention, what comes next, and the three things most
// often looked for. Everything here is only READ from the trip, nothing is changed from this screen.

import { h } from '../dom.js';
import { tripDates, formatTime, formatWeekdayDate, localDateNow } from '../time.js';
import { programOf } from '../program.js';
import { tripWarnings, countIn } from '../rules.js';
import { pageHead } from './chrome.js';
import { jobsOf, jobTodo, TEAM_JOBS } from '../teamJobs.js';
import { rollCallActions } from './destination.js';
import { sendSheet } from './sendSheet.js';

// The next tour that has not started yet (not cancelled, with a start time), across the whole trip. Null when there is none.
export function nextTour(trip, now = new Date()) {
  const upcoming = trip.activities.filter((a) => !a.cancelled && a.startsAt && a.startsAt >= now.toISOString());
  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return upcoming[0] ?? null;
}

// Every tour of today (not cancelled), each judged in its own destination's time zone, in the order they leave (a tour with no time last).
export function toursOfToday(trip, now = new Date()) {
  const todayIn = (zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const slotIds = new Set(trip.slots.filter((s) => s.date && s.date === todayIn(trip.destinations.find((d) => d.id === s.destinationId)?.timeZone ?? 'UTC')).map((s) => s.id));
  return trip.activities.filter((a) => !a.cancelled && slotIds.has(a.slotId))
    .sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9') || a.name.localeCompare(b.name));
}

// Which tour is shown large on Today, and which as lines under it. With tours today: the first one that has not left more than 30 minutes ago
// (or the last of the day once all have left). With none today: the next tour of the trip, alone.
export function mainTour(todays, upcoming, now = new Date()) {
  if (todays.length === 0) return { main: upcoming ?? null, others: [] };
  const limit = new Date(now.getTime() - 30 * 60000).toISOString();
  const main = todays.find((t) => !t.startsAt || t.startsAt >= limit) ?? todays[todays.length - 1];
  return { main, others: todays.filter((t) => t !== main) };
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

  // 1b. This person's jobs (Settings > Team): what they ask of them for today's and tomorrow's tours.
  //     A timeline: soonest due first, with the time it is due by; a late one is in red (owner's report of 5 Nov 2026).
  const jobs = jobsOf(trip, ctx.myEmail);
  const jobRows = myJobItems(ctx, trip).map((t) => {
    const r = row(t.href, t.title, t.detail, t.late ? '!' : null);
    if (t.late) r.classList.add('menu-row--late');
    return r;
  });
  const jobsBlock = jobs.length ? [
    h('h3', { class: 'section-title' }, `Your jobs: ${jobs.map((k) => TEAM_JOBS.find((j) => j.key === k)?.label).filter(Boolean).join(', ')}`),
    jobRows.length ? h('div', { class: 'menu' }, jobRows) : h('p', { class: 'muted' }, 'All done for today and tomorrow.'),
  ] : [];

  // 2. The tours. On a day of the trip: EVERY tour of today (v0.152.0), the next one to leave large with its one main button, the others as lines.
  //    On any other day: the next tour of the trip, large. The main button is the roll call when the tour leaves within the next 12 hours (or has
  //    one running), otherwise "Open this tour".
  const zoneOf = (tour) => { const slot = trip.slots.find((s) => s.id === tour.slotId); return { slot, destination: trip.destinations.find((d) => d.id === slot.destinationId) }; };
  const guestsWord = (tour) => { const count = countIn(trip, tour); return `${count}${tour.capacity ? ` of ${tour.capacity}` : ''} guest${count === 1 ? '' : 's'}`; };
  const todays = toursOfToday(trip);
  const { main: tour, others } = mainTour(todays, nextTour(trip));
  let next = h('p', { class: 'muted' }, 'No tour with a start time is coming up.');
  if (tour) {
    const { slot, destination } = zoneOf(tour);
    const href = `${base}/use/destination/${destination.id}/${slot.id}`;
    const soon = tour.startsAt ? Date.parse(tour.startsAt) - Date.now() < 12 * 3600000 : todays.includes(tour);
    const rollCall = soon && role !== 'viewer' ? rollCallActions(ctx, trip, tour).find((a) => a.primary) : null;
    next = h('div', { class: 'next-card' },
      h('div', { class: 'next-when' }, tour.startsAt ? h('span', { class: 'next-time' }, formatTime(tour.startsAt, destination.timeZone)) : null, h('span', { class: 'next-day' }, whenWord(slot.date, destination.timeZone))),
      h('div', { class: 'next-name' }, tour.name),
      h('div', { class: 'next-detail' }, [destination.name, tour.meeting, guestsWord(tour)].filter(Boolean).join(' · ')),
      rollCall ? h('button', { class: 'btn', type: 'button', onclick: rollCall.run }, rollCall.label) : null,
      h('a', { class: `btn${rollCall ? ' btn--plain' : ''}`, href }, rollCall ? 'See who is on this tour' : 'Open this tour'));
  }
  const otherRows = others.map((t) => { const { slot, destination } = zoneOf(t);
    return row(`${base}/use/destination/${destination.id}/${slot.id}`, `${t.startsAt ? `${formatTime(t.startsAt, destination.timeZone)} · ` : ''}${t.name}`, [t.meeting, guestsWord(t)].filter(Boolean).join(' · ')); });

  // 3. Today's daily program (what the guests are given), when there is one.
  const program = programToday(trip).map(({ destination, day }) => h('div', { class: 'menu' },
    row(`${base}/settings/program/${destination.id}/${day.date}`, day.title || formatWeekdayDate(day.date), `${destination.name} · ${day.items.length} item${day.items.length === 1 ? '' : 's'}`),
    ...day.items.map((i) => h('div', { class: 'menu-row' }, h('span', { class: 'menu-text' },
      h('span', { class: 'menu-label' }, `${i.startsAt ? `${formatTime(i.startsAt, destination.timeZone)} · ` : ''}${i.title}`), i.place ? h('span', { class: 'menu-hint' }, i.place) : null)))));

  const simple = ctx.simpleFor?.(trip.id) ?? false;
  const first = (ctx.owner?.name ?? '').trim().split(/\s+/)[0];
  return h('div', {},
    pageHead({ eyebrow: trip.name, title: `${greeting()}${first ? `, ${first}` : ''}` }),
    h('h3', { class: 'section-title' }, todays.length > 1 ? `Today's tours (${todays.length})` : todays.length === 1 ? 'Today\'s tour' : 'Next tour'),
    next,
    otherRows.length > 0 ? h('div', { class: 'menu menu--after' }, otherRows) : null,
    ...jobsBlock,
    // "Needs attention" only when something does: a calm page says so in one line.
    attention.length > 0 ? h('h3', { class: 'section-title section-title--alert' }, `Needs attention (${attention.length})`) : null,
    attention.length > 0 ? h('div', { class: 'menu' }, attention) : h('p', { class: 'all-clear' }, 'Nothing else needs your attention.'),
    program.length > 0 ? h('h3', { class: 'section-title' }, 'Program of the day') : null,
    ...program,
    // The simple version of the app (a colleague the owner has not unlocked, Settings > Team) stops here: the day, the roll call, what waits. Nothing else.
    role === 'viewer' || simple ? null : h('h3', { class: 'section-title' }, 'Often used'),
    role === 'viewer' || simple ? null : h('div', { class: 'menu' },
      h('button', { class: 'menu-row', type: 'button', onclick: () => sendSheet(ctx, trip) },
        h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, 'Send a list or a sheet'), h('span', { class: 'menu-hint' }, 'Guest lists, reservation sheets')),
        h('span', { class: 'menu-side' }, h('span', { class: 'row-chev' }, '›'))),
      row(`${base}/settings/exports`, 'Documents', 'Everything already made: lists, cards and sheets')),
    h('p', { class: 'muted footer-note' }, `${tripDates(trip.start, trip.days)} · ${trip.guests.length} guests`));
}

// "Good morning" by the phone's own clock.
function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

// "Today", "Tomorrow", or the weekday and date, judged in the destination's own time zone.
function whenWord(date, timeZone) {
  const today = localDateNow(timeZone);
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return date === today ? 'Today' : date === tomorrow ? 'Tomorrow' : formatWeekdayDate(date);
}

// This person's job items for a trip (Today's "Your jobs", the red dot on the Today tab, the number on the app icon).
export function myJobItems(ctx, trip) {
  const jobs = jobsOf(trip, ctx.myEmail);
  if (!jobs.length || trip.archivedAt) return [];
  const today = localDateNow(trip.destinations.find((d) => trip.slots.some((x) => x.destinationId === d.id))?.timeZone ?? 'UTC');
  return jobTodo(trip, jobs, { today, guestMessages: ctx.guestMessagesFor?.(trip.id) ?? [], threads: ctx.guestThreadsFor?.(trip.id) ?? [] });
}
