// What a guest should be told after a change (notifications, v0.83.0). Pure: it reads the journal lines the change just wrote and returns the messages;
// app.js sends them. Nothing here talks to the network.
//
// The owner chooses which kinds are on (Settings > Guest links > "What guests are notified about"); all are on by default.

import { formatTime } from './time.js';

export const NOTIFY_KINDS = [
  { key: 'moved', label: 'A guest is moved to another tour (or to At leisure)', category: 'changes' },
  { key: 'cancelled', label: 'A tour is cancelled', category: 'changes' },
  { key: 'changed', label: 'A tour\'s start time or meeting point changes', category: 'changes' },
  { key: 'place', label: 'A place opens for a guest on the waiting list', category: 'changes' },
  { key: 'dinner', label: 'A dinner is booked, changed or moved', category: 'changes' },
  { key: 'answer', label: 'A request from a guest is answered', category: 'requests' },
];

// The owner's choices: every kind is on unless switched off (trip.guestNotify = { moved: false, ... }).
export function notifySettings(trip) {
  const saved = trip.guestNotify ?? {};
  return Object.fromEntries(NOTIFY_KINDS.map((k) => [k.key, saved[k.key] !== false]));
}

export function notifySettingsError(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'The settings are not valid.';
  for (const [key, value] of Object.entries(raw)) {
    if (!NOTIFY_KINDS.some((k) => k.key === key)) return `"${key}" is not a kind of notification.`;
    if (typeof value !== 'boolean') return 'Each kind is on or off.';
  }
  return null;
}

// The messages for the journal lines a change has just written (`entries`), on the trip AS IT IS NOW. Returns
// [{ kind, category: 'changes', guestIds, title, body }], one per distinct message (guests who get the same words are grouped).
// A change made by Undo, a request answer (told separately) and moves made by the app itself (End roll call, replacing a destination) say nothing.
export function notificationsFor(trip, entries, settings = notifySettings(trip)) {
  if (!trip.guestLinks) return [];
  const found = [];
  const add = (kind, guestId, title, body) => { if (settings[kind] !== false) found.push({ kind, guestId, title, body }); };

  for (const e of entries) {
    if (e.cause === 'undo') continue;
    if (e.type === 'cancel-tour') continue; // its guests come from the move lines below
    if (e.type === 'move' && e.cause === 'cancel-tour') {
      const tour = e.from?.label ?? 'Your tour';
      add('cancelled', e.guestId, 'A tour was cancelled', `"${tour}" (${e.slotLabel}) is cancelled. Please open your programme.`);
    } else if (e.type === 'move' && (e.cause === null || e.cause === undefined) && e.source !== 'guest request') {
      if (e.to?.kind === 'activity' && e.from?.kind === 'waitlist') add('place', e.guestId, 'A place opened for you', `You are now on "${e.to.label}" (${e.slotLabel}).`);
      else if (e.to?.kind === 'activity') add('moved', e.guestId, 'Your plan changed', `You are now on "${e.to.label}" (${e.slotLabel}).`);
      else if (e.to?.kind === 'leisure') add('moved', e.guestId, 'Your plan changed', `You are now at leisure (${e.slotLabel}).`);
    } else if (e.type === 'move' && ['book-dinner', 'add-to-dinner-table', 'move-dinner-table'].includes(e.cause)) {
      add('dinner', e.guestId, 'Your dinner', `Dinner: ${e.to?.label ?? 'a restaurant'} (${e.slotLabel}).`);
    } else if (e.type === 'edit-activity' && e.from && e.to) {
      const timeChanged = (e.from.startsAt ?? null) !== (e.to.startsAt ?? null);
      const meetingChanged = (e.from.meeting ?? '') !== (e.to.meeting ?? '');
      if (!timeChanged && !meetingChanged) continue;
      const slot = trip.slots.find((s) => s.id === e.slotId);
      const zone = e.place?.timeZone ?? 'UTC';
      const bits = [];
      if (timeChanged) bits.push(e.to.startsAt ? `now starts at ${formatTime(e.to.startsAt, zone)}` : 'no longer has a fixed start time');
      if (meetingChanged) bits.push(e.to.meeting ? `meet at ${e.to.meeting}` : 'the meeting point was removed');
      for (const guest of trip.guests) {
        const booking = slot && trip.bookings?.[guest.id]?.[slot.id];
        if (!guest.leftAt && booking?.kind === 'activity' && booking.activityId === e.activityId) add('changed', guest.id, 'A tour changed', `"${e.to.name}" (${e.slotLabel}): ${bits.join('; ')}.`);
      }
    }
  }

  // Guests who would get the same words get ONE notification, and a guest never gets the same words twice.
  const groups = new Map();
  for (const f of found) {
    const key = `${f.kind}|${f.title}|${f.body}`;
    if (!groups.has(key)) groups.set(key, { kind: f.kind, category: 'changes', title: f.title, body: f.body, guestIds: new Set() });
    groups.get(key).guestIds.add(f.guestId);
  }
  return [...groups.values()].map((g) => ({ ...g, guestIds: [...g.guestIds] }));
}
