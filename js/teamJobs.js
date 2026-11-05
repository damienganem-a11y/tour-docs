// Jobs in the team (v0.140.0, owner's idea, 2 Nov 2026): on a cruise, one colleague is in charge of the colour groups, another reconfirms the guides and
// drivers... The owner gives each person (by their sign-in e-mail) their jobs in Settings > Team; each person then sees their own to-do on Today.
// trip.teamJobs = { 'email@example.com': ['groups', 'reconfirm', ...] }. Pure: no screen, no network.

import { addDays, localToInstant, formatTime } from './time.js';
import { tourSplitState } from './rules.js';
import { inboxList } from './chat.js';

export const TEAM_JOBS = [
  { key: 'groups', label: 'Colour groups', hint: 'prepares the colours of each tour and validates them' },
  { key: 'reconfirm', label: 'Local team', hint: 'reconfirms the guides and drivers before each tour' },
  { key: 'messages', label: 'Guest messages', hint: 'answers the guests' },
];

export const jobsOf = (trip, email) => (email ? trip.teamJobs?.[String(email).toLowerCase()] ?? [] : []);

export function teamJobsError(email, jobs) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email.trim()) || email.length > 120) return 'That e-mail address is not valid.';
  if (!Array.isArray(jobs) || jobs.some((j) => !TEAM_JOBS.some((t) => t.key === j))) return 'Unknown job.';
  return null;
}

// When each job is due for a tour (owner's report of 5 Nov 2026: "let's set up timeline and alerts"), as an exact moment:
//   groups:    the colours validated 2 hours before departure (guests get their card 30 minutes before); 08:00 that day for a tour with no start time
//   reconfirm: the guides and drivers reconfirmed by 18:00 the evening before
const zoneOf = (trip, slot) => trip.destinations.find((d) => d.id === slot.destinationId)?.timeZone ?? 'UTC';
export function jobDueAt(trip, job, activity, slot) {
  const zone = zoneOf(trip, slot);
  if (job === 'groups') return activity.startsAt ? new Date(Date.parse(activity.startsAt) - 2 * 3600000).toISOString() : localToInstant(slot.date, '08:00', zone);
  if (job === 'reconfirm') return localToInstant(addDays(slot.date, -1), '18:00', zone);
  return null;
}

// What a person's jobs ask of them now, for the tours of today and tomorrow (dates in the trip's own calendar), soonest due first:
// [{ job, title, detail, href, dueAt, late }].
//   groups:    a tour with colour groups still in draft, or guests without a colour / no longer on the tour
//   reconfirm: a guide or driver not reconfirmed yet (and whether the message was sent)
//   messages:  guest conversations waiting for an answer (due now)
export function jobTodo(trip, jobs, { today, guestMessages = [], threads = [], now = new Date() }) {
  const out = [];
  const base = `#/trip/${trip.id}`;
  const soon = new Set([today, addDays(today, 1)]);
  const tours = trip.activities.filter((a) => !a.cancelled).map((a) => ({ a, slot: trip.slots.find((x) => x.id === a.slotId) })).filter((t) => t.slot && soon.has(t.slot.date));
  const when = (slot) => (slot.date === today ? 'Today' : 'Tomorrow');
  // "Due by 08:00", "Due by 18:00 the evening before", or "Late: was due 18:00..." once the moment has passed.
  const dueText = (item, slot) => `${Date.parse(item.dueAt) < now.getTime() ? 'Late: was due' : 'Due by'} ${formatTime(item.dueAt, zoneOf(trip, slot))}${item.job === 'reconfirm' ? ' the evening before' : ''}`;
  const push = (item, slot) => out.push({ ...item, late: Date.parse(item.dueAt) < now.getTime(), detail: `${item.detail} · ${dueText(item, slot)}` });
  if (jobs.includes('groups')) {
    for (const { a, slot } of tours) {
      const split = (trip.splits ?? []).find((x) => x.activityId === a.id);
      if (!split) continue; // a tour without colour groups is a choice, not a to-do
      const state = tourSplitState(trip, split);
      const missing = state.unplaced.length + state.stale.length;
      if (!split.validatedAt || missing) push({ job: 'groups', title: `${a.name}: ${!split.validatedAt ? 'colours to validate' : 'colours to fix'}`, detail: `${when(slot)}, ${slot.half.toLowerCase()}${missing ? ` · ${missing} guest${missing === 1 ? '' : 's'} to place` : ''}`, href: `${base}/settings/groups/${split.id}`, dueAt: jobDueAt(trip, 'groups', a, slot) }, slot);
    }
  }
  if (jobs.includes('reconfirm')) {
    for (const { a, slot } of tours) {
      const waiting = (trip.contacts ?? []).filter((c) => c.assignments.some((x) => x.activityId === a.id && !x.confirmedAt));
      const asked = waiting.filter((c) => c.assignments.some((x) => x.activityId === a.id && x.askedAt)).length;
      if (waiting.length) push({ job: 'reconfirm', title: `${a.name}: ${waiting.length} to reconfirm`, detail: `${when(slot)}, ${slot.half.toLowerCase()} · ${waiting.map((c) => c.name).slice(0, 3).join(', ')}${waiting.length > 3 ? '…' : ''}${asked ? ` · ${asked} message${asked === 1 ? '' : 's'} sent` : ''}`, href: `${base}/settings/localteam`, dueAt: jobDueAt(trip, 'reconfirm', a, slot) }, slot);
    }
  }
  if (jobs.includes('messages')) {
    const waiting = inboxList(guestMessages, threads, new Map()).filter((c) => c.waiting || c.dot).length;
    if (waiting) out.push({ job: 'messages', title: `${waiting} guest conversation${waiting === 1 ? '' : 's'} to answer`, detail: 'Messages', href: `${base}/settings/guestmessages`, dueAt: now.toISOString(), late: false });
  }
  return out.sort((x, y) => x.dueAt.localeCompare(y.dueAt));
}

// The red dot on Today: how many job items wait (guest messages are left out: the envelope already counts them).
export const jobDotCount = (items) => items.filter((t) => t.job !== 'messages').length;

// Reminders sent by the server to the person in charge, even when their phone is shut (planned by the owner's phone with the trip's other automatic
// messages, scheduledMessages.js): 3 hours before a tour whose colours are not validated yet; 17:00 the evening before a tour whose guides or drivers
// are not all reconfirmed. Only for people who have the job; a job nobody has sends nothing (the owner sees it on Today).
// Returns rows for replace_auto_messages (audience 'staff', staff_emails).
export function jobReminders(trip) {
  const who = (job) => Object.entries(trip.teamJobs ?? {}).filter(([, list]) => list.includes(job)).map(([email]) => email);
  const rows = [];
  const groupsPeople = who('groups'); const reconfirmPeople = who('reconfirm');
  for (const a of trip.activities) {
    if (a.cancelled) continue;
    const slot = trip.slots.find((x) => x.id === a.slotId);
    if (!slot) continue;
    const zone = zoneOf(trip, slot);
    const split = (trip.splits ?? []).find((x) => x.activityId === a.id);
    if (groupsPeople.length && split) {
      const state = tourSplitState(trip, split);
      const missing = state.unplaced.length + state.stale.length;
      if (!split.validatedAt || missing) {
        const at = a.startsAt ? new Date(Date.parse(a.startsAt) - 3 * 3600000).toISOString() : localToInstant(addDays(slot.date, -1), '19:00', zone);
        rows.push({ auto_key: `job|groups|${a.id}`, send_at: at, audience: 'staff', staff_emails: groupsPeople, guest_ids: null, category: 'reminders', priority: 'info',
          title: `Colours to ${split.validatedAt ? 'fix' : 'validate'}: ${a.name}`.slice(0, 80),
          body: `${a.startsAt ? `Leaves at ${formatTime(a.startsAt, zone)}. ` : ''}${missing ? `${missing} guest${missing === 1 ? '' : 's'} without a colour. ` : ''}Guests get their colour card 30 minutes before, once validated.`.slice(0, 200) });
      }
    }
    if (reconfirmPeople.length) {
      const waiting = (trip.contacts ?? []).filter((c) => c.assignments.some((x) => x.activityId === a.id && !x.confirmedAt));
      if (waiting.length) {
        rows.push({ auto_key: `job|reconfirm|${a.id}`, send_at: localToInstant(addDays(slot.date, -1), '17:00', zone), audience: 'staff', staff_emails: reconfirmPeople, guest_ids: null, category: 'reminders', priority: 'info',
          title: `Reconfirm the local team: ${a.name}`.slice(0, 80),
          body: `Tomorrow${a.startsAt ? ` at ${formatTime(a.startsAt, zone)}` : ''}: ${waiting.length} to reconfirm (${waiting.map((c) => c.name).slice(0, 3).join(', ')}${waiting.length > 3 ? '…' : ''}). One tap sends them the message.`.slice(0, 200) });
      }
    }
  }
  return rows;
}
