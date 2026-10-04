// Scheduled messages and automatic reminders (notification batches 2 and 3, v0.88.0). Pure: it reads the trip and says WHAT to send, WHEN and to WHOM;
// app.js hands the result to the server (sync.js), where a timer sends it at the exact moment, even if this phone is shut.
//
// Three families:
//   - messages the leader writes and schedules (audience: everyone, a travel party, a group, or the guests of one tour);
//   - automatic reminders for guests: the evening before each tour and the hour before it (what, when, where to meet);
//   - alerts for the leader: guests with no dinner booked on a dinner evening, a roll call still open after departure.
//     (A request waiting 2 hours is detected by the server itself; a sync problem is shown by the sync light.)
// Times are exact moments, worked out in the destination's own time zone.

import { addDays, formatTime, localToInstant, offsetMinutes } from './time.js';
import { findRollCall } from './rollcall.js';

export const MESSAGE_TEMPLATES = [
  { key: 'clocks', label: 'Clocks change tonight', title: 'Clocks change tonight', body: 'Tonight, remember to change your clock or watch before you go to bed.' },
  { key: 'lounge', label: 'Meet in the lounge', title: 'Meet in the lounge', body: 'Please meet in the lounge at 18:30 for a short briefing.' },
  { key: 'luggage', label: 'Luggage out', title: 'Luggage out by 7 am', body: 'Please leave your luggage outside your room by 7 am tomorrow, with the label on.' },
  { key: 'passport', label: 'Passport tomorrow', title: 'Passport tomorrow', body: 'Please keep your passport with you tomorrow: we need it at the border.' },
  { key: 'dress', label: 'Dress code tonight', title: 'Dress code tonight', body: 'Tonight is smart casual. Closed shoes, please.' },
  { key: 'bus', label: 'Leaves in 30 minutes', title: 'We leave in 30 minutes', body: 'Please be at the meeting point in 30 minutes. Bring water and your hat.' },
];

// The leader's choices for the automatic messages (all on by default): trip.autoNotify = { eveningBefore: false, ... }.
export const AUTO_KINDS = [
  { key: 'eveningBefore', label: 'Guests: the evening before each tour (19:00)', audience: 'guests' },
  { key: 'hourBefore', label: 'Guests: one hour before a tour that starts after 07:30', audience: 'guests' },
  { key: 'dinnerAlert', label: 'You: at 15:00, guests with no dinner booked tonight', audience: 'owner' },
  { key: 'rollCallAlert', label: 'You: a roll call still open 15 minutes after a tour left', audience: 'owner' },
];
export function autoNotifySettings(trip) {
  const saved = trip.autoNotify ?? {};
  return Object.fromEntries(AUTO_KINDS.map((k) => [k.key, saved[k.key] !== false]));
}
export function autoNotifyError(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'The settings are not valid.';
  for (const [key, value] of Object.entries(raw)) {
    if (!AUTO_KINDS.some((k) => k.key === key)) return `"${key}" is not a kind of automatic message.`;
    if (typeof value !== 'boolean') return 'Each kind is on or off.';
  }
  return null;
}

const active = (trip) => trip.guests.filter((g) => !g.leftAt);

// The guests an audience means, now: { type: 'everyone' } | { type: 'party', id } | { type: 'group', splitId, groupId } | { type: 'tour', activityId }.
// Returns guest ids, or null for everyone (the server then means "every guest of the trip with notifications on", also guests added later).
export function audienceGuestIds(trip, audience) {
  if (!audience || audience.type === 'everyone') return null;
  if (audience.type === 'party') return active(trip).filter((g) => g.partyId === audience.id).map((g) => g.id);
  if (audience.type === 'group') {
    const split = (trip.splits ?? []).find((s) => s.id === audience.splitId);
    return split ? active(trip).filter((g) => split.assignments?.[g.id] === audience.groupId).map((g) => g.id) : [];
  }
  if (audience.type === 'tour') return bookedOn(trip, audience.activityId);
  return [];
}
function bookedOn(trip, activityId) {
  const activity = trip.activities.find((a) => a.id === activityId);
  if (!activity) return [];
  return active(trip).filter((g) => { const b = trip.bookings?.[g.id]?.[activity.slotId]; return b?.kind === 'activity' && b.activityId === activityId; }).map((g) => g.id);
}

// A written message: an error sentence, or null when it can be scheduled. `now` is a Date.
export function draftError(draft, now = new Date()) {
  if (!draft.title?.trim() || draft.title.trim().length > 80) return 'Give the message a title of 80 letters or fewer.';
  if (!draft.body?.trim() || draft.body.trim().length > 200) return 'Write a message of 200 letters or fewer.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date ?? '') || !/^\d{2}:\d{2}$/.test(draft.time ?? '')) return 'Choose a day and a time.';
  const at = Date.parse(localToInstant(draft.date, draft.time, draft.timeZone));
  if (!(at > now.getTime() + 60000)) return 'That moment has already passed. Choose a later time.';
  if (Array.isArray(draft.guestIds) && draft.guestIds.length === 0) return 'Nobody is in that audience.';
  return null;
}
// The server row for a written message.
export function draftRow(draft) {
  return { send_at: localToInstant(draft.date, draft.time, draft.timeZone), audience: 'guests', guest_ids: draft.guestIds ?? null,
    title: draft.title.trim(), body: draft.body.trim(), category: 'announcement', priority: draft.important ? 'important' : 'info' };
}

const HORIZON_DAYS = 10;
const zoneOfSlot = (trip, slot) => trip.destinations.find((d) => d.id === slot.destinationId)?.timeZone ?? 'UTC';
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Every automatic message the trip calls for in the next days, as server rows (auto_key names each one). `now` is a Date.
export function plannedAutoMessages(trip, now = new Date(), settings = autoNotifySettings(trip)) {
  if (trip.archivedAt || trip.deletedAt) return [];
  const rows = [];
  const limit = now.getTime() + HORIZON_DAYS * 86400000;
  const add = (row) => { const at = Date.parse(row.send_at); if (at > now.getTime() + 60000 && at < limit) rows.push(row); };
  for (const activity of trip.activities) {
    if (activity.cancelled) continue;
    const slot = trip.slots.find((s) => s.id === activity.slotId);
    if (!slot) continue;
    const zone = zoneOfSlot(trip, slot);
    const clock = activity.startsAt ? formatTime(activity.startsAt, zone) : null;
    const meet = activity.meeting ? `meet at ${activity.meeting}` : '';
    const guestIds = bookedOn(trip, activity.id);
    if (settings.eveningBefore && guestIds.length > 0) {
      add({ auto_key: `eve|${activity.id}`, send_at: localToInstant(addDays(slot.date, -1), '19:00', zone), audience: 'guests', guest_ids: guestIds, category: 'reminders', priority: 'info',
        title: clip(`Tomorrow: ${activity.name}`, 80), body: clip([clock ? `${slot.half}, ${clock}` : slot.half, meet].filter(Boolean).join(', ') + '.', 200) });
    }
    if (settings.hourBefore && guestIds.length > 0 && activity.startsAt && clock >= '07:30') {
      add({ auto_key: `hour|${activity.id}`, send_at: new Date(Date.parse(activity.startsAt) - 3600000).toISOString(), audience: 'guests', guest_ids: guestIds, category: 'reminders', priority: 'info',
        title: clip(`In one hour: ${activity.name}`, 80), body: clip(`Leaves at ${clock}${meet ? `, ${meet}` : ''}.`, 200) });
    }
    if (settings.rollCallAlert && guestIds.length > 0 && activity.startsAt && !findRollCall(trip, activity.id)?.endedAt) {
      add({ auto_key: `roll|${activity.id}`, send_at: new Date(Date.parse(activity.startsAt) + 15 * 60000).toISOString(), audience: 'owner', guest_ids: null, category: 'reminders', priority: 'info',
        title: clip(`Roll call not finished: ${activity.name}`, 80), body: 'The tour left 15 minutes ago and its roll call is still open.' });
    }
  }
  if (settings.dinnerAlert) {
    for (const slot of trip.slots.filter((s) => s.half === 'Evening')) {
      const destination = trip.destinations.find((d) => d.id === slot.destinationId);
      if (!destination || !(trip.restaurants ?? []).some((r) => r.destinationId === destination.id)) continue;
      const without = active(trip).filter((g) => trip.bookings?.[g.id]?.[slot.id]?.kind !== 'dinner').length;
      if (without === 0) continue;
      add({ auto_key: `dinner|${slot.id}`, send_at: localToInstant(slot.date, '15:00', destination.timeZone), audience: 'owner', guest_ids: null, category: 'reminders', priority: 'info',
        title: clip(`Dinner tonight: ${without} ${without === 1 ? 'guest has' : 'guests have'} no table`, 80), body: clip(`In ${destination.name}, ${without} ${without === 1 ? 'guest has' : 'guests have'} no dinner booked yet.`, 200) });
    }
  }
  return rows.sort((a, b) => a.send_at.localeCompare(b.send_at));
}

// Proposals: where the next destination's clock differs, a message the leader can schedule with one tap ("clocks go forward tonight").
// Returns [{ key, title, body, date, time, timeZone, destination }]: the day, time and zone are where the message is sent from (the evening before arriving).
export function clockProposals(trip) {
  const ordered = [...trip.destinations].sort((a, b) => a.order - b.order);
  const out = [];
  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1]; const to = ordered[i];
    const arrival = trip.slots.filter((s) => s.destinationId === to.id).map((s) => s.date).sort()[0];
    if (!arrival || !from.timeZone || !to.timeZone) continue;
    const noon = Date.parse(localToInstant(arrival, '12:00', to.timeZone));
    const diff = offsetMinutes(to.timeZone, noon) - offsetMinutes(from.timeZone, noon);
    if (diff === 0) continue;
    const abs = Math.abs(diff);
    const amount = `${Math.floor(abs / 60) ? `${Math.floor(abs / 60)} ${Math.floor(abs / 60) === 1 ? 'hour' : 'hours'}` : ''}${abs % 60 ? `${Math.floor(abs / 60) ? ' ' : ''}${abs % 60} min` : ''}`;
    out.push({ key: `clock|${to.id}`, destination: to.name, date: addDays(arrival, -1), time: '19:00', timeZone: from.timeZone,
      title: 'Clocks change tonight', body: clip(`${to.name} is ${amount} ${diff > 0 ? 'ahead of' : 'behind'} ${from.name}. Tonight, move your clock or watch ${diff > 0 ? 'forward' : 'back'} ${amount}.`, 200) });
  }
  return out;
}
