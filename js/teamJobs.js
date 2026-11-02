// Jobs in the team (v0.140.0, owner's idea, 2 Nov 2026): on a cruise, one colleague is in charge of the colour groups, another reconfirms the guides and
// drivers... The owner gives each person (by their sign-in e-mail) their jobs in Settings > Team; each person then sees their own to-do on Today.
// trip.teamJobs = { 'email@example.com': ['groups', 'reconfirm', ...] }. Pure: no screen, no network.

import { addDays } from './time.js';
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

// What a person's jobs ask of them now, for the tours of today and tomorrow (dates in the trip's own calendar): [{ job, title, detail, href }].
//   groups:    a tour with no colour groups yet, colours still in draft, or guests without a colour / no longer on the tour
//   reconfirm: a guide or driver not reconfirmed yet
//   messages:  guest conversations waiting for an answer
export function jobTodo(trip, jobs, { today, guestMessages = [], threads = [] }) {
  const out = [];
  const base = `#/trip/${trip.id}`;
  const soon = new Set([today, addDays(today, 1)]);
  const tours = trip.activities.filter((a) => !a.cancelled).map((a) => ({ a, slot: trip.slots.find((x) => x.id === a.slotId) })).filter((t) => t.slot && soon.has(t.slot.date));
  const when = (slot) => (slot.date === today ? 'Today' : 'Tomorrow');
  if (jobs.includes('groups')) {
    for (const { a, slot } of tours) {
      const split = (trip.splits ?? []).find((x) => x.activityId === a.id);
      if (!split) continue; // a tour without colour groups is a choice, not a to-do
      const state = tourSplitState(trip, split);
      const missing = state.unplaced.length + state.stale.length;
      if (!split.validatedAt || missing) out.push({ job: 'groups', title: `${a.name}: ${!split.validatedAt ? 'colours to validate' : 'colours to fix'}`, detail: `${when(slot)}, ${slot.half.toLowerCase()}${missing ? ` · ${missing} guest${missing === 1 ? '' : 's'} to place` : ''}`, href: `${base}/settings/groups/${split.id}` });
    }
  }
  if (jobs.includes('reconfirm')) {
    for (const { a, slot } of tours) {
      const waiting = (trip.contacts ?? []).filter((c) => c.assignments.some((x) => x.activityId === a.id && !x.confirmedAt));
      if (waiting.length) out.push({ job: 'reconfirm', title: `${a.name}: ${waiting.length} to reconfirm`, detail: `${when(slot)}, ${slot.half.toLowerCase()} · ${waiting.map((c) => c.name).slice(0, 3).join(', ')}${waiting.length > 3 ? '…' : ''}`, href: `${base}/settings/localteam` });
    }
  }
  if (jobs.includes('messages')) {
    const waiting = inboxList(guestMessages, threads, new Map()).filter((c) => c.waiting || c.dot).length;
    if (waiting) out.push({ job: 'messages', title: `${waiting} guest conversation${waiting === 1 ? '' : 's'} to answer`, detail: 'Messages', href: `${base}/settings/guestmessages` });
  }
  return out;
}
