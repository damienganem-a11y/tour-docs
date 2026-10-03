// Requests from guests (the guest app's "Ask to switch to this tour", v0.81.0): a guest asks, in words, to move to another tour of the same
// half-day. The request reaches the server (table guest_requests); the owner's phone shows it in Settings > Requests and, on "Approve", applies it
// with the app's one change function (so it is in the Journal and can be undone). This file is the pure part: no network, no screen.
//
// A request row (as the server keeps it):  { id, trip_id, guest_id, status, note, created_at, payload }
//   payload = { day, date, half, destination, from, to, note }   words only: no id of the trip ever travels through a guest's phone.

import { guestPlace } from './rules.js';

// Finds, in the trip as it is NOW, who asks and for what. Returns { ok: true, guest, slot, to, from } or { ok: false, error } (a plain sentence).
// `from` is the tour the guest is on now (or null); only the wanted tour decides what happens.
export function resolveGuestRequest(trip, row) {
  const guest = trip.guests.find((g) => g.id === row.guest_id);
  if (!guest) return { ok: false, error: 'That guest is no longer on the trip.' };
  if (guest.leftAt) return { ok: false, error: `${guest.first} has left the trip.` };
  const p = row.payload ?? {};
  const destination = trip.destinations.find((d) => d.name === p.destination);
  const slot = destination && trip.slots.find((s) => s.destinationId === destination.id && s.day === p.day && s.half === p.half);
  if (!slot) return { ok: false, error: `Day ${p.day} ${p.half} in ${p.destination} no longer exists.` };
  const to = trip.activities.find((a) => a.slotId === slot.id && a.name === p.to);
  if (!to) return { ok: false, error: `"${p.to}" is no longer offered then.` };
  if (to.cancelled) return { ok: false, error: `"${p.to}" is cancelled.` };
  const place = guestPlace(trip, guest, slot);
  if (place.kind === 'activity' && place.activity.id === to.id) return { ok: false, error: `${guest.first} is already on "${p.to}".` };
  return { ok: true, guest, slot, to, from: place.kind === 'activity' ? place.activity : null };
}

// The change that makes the request happen. mode: 'move' (needs a free place), 'waitlist' (joins the tour's waiting list), 'force' (goes over capacity).
export function guestRequestChange(resolved, mode = 'move') {
  const { guest, slot, to } = resolved;
  if (mode === 'waitlist') return { type: 'move', guestId: guest.id, slotId: slot.id, to: { kind: 'waitlist', activityId: to.id } };
  return { type: 'move', guestId: guest.id, slotId: slot.id, to: { kind: 'activity', activityId: to.id }, ...(mode === 'force' ? { force: true } : {}) };
}

// One line for the owner's list: who, when, from which tour to which.
export function describeGuestRequest(trip, row, names) {
  const p = row.payload ?? {};
  const name = names?.get(row.guest_id) ?? trip.guests.find((g) => g.id === row.guest_id)?.first ?? 'A guest';
  return `${name}: day ${p.day} ${String(p.half ?? '').toLowerCase()}, ${p.destination}. "${p.from}" to "${p.to}"`;
}

// What the guest is told (a notification and the line in their app) once the owner has answered.
export function guestAnswerText(row, outcome) {
  const p = row.payload ?? {};
  const what = `day ${p.day} ${String(p.half ?? '').toLowerCase()}: ${p.to}`;
  if (outcome === 'approved') return { title: 'Your request was approved', body: `You are now on ${what}.` };
  if (outcome === 'waitlist') return { title: 'You are on the waiting list', body: `${p.to} is full. You are on its waiting list (${what.split(':')[0]}).` };
  return { title: 'Your request was not possible', body: row.note ? `${p.to}: ${row.note}` : `Your leader could not move you to ${p.to}.` };
}
