// What the SERVER keeps fresh by itself (v0.148.0, owner's decision of 10 Nov 2026: "stop depending on my phone", option 1). Pure: no network here.
//
// Until now only the owner's phone, while open, recalculated three things from the trip: each guest's programme, what the reception links and lounge
// screens show, and the automatic reminders. A robot on the server (supabase/functions/trip-worker) now does the same every minute, with THE SAME code
// as the app (this file and the ones it imports are copied next to the robot when it is installed), so both always agree.
// The robot only READS the trip: it never changes it (recording a guide's answer in the trip still needs an owner's phone, by design, for now).
// The owner's phone keeps doing these jobs too when it is open: both write the same thing, and each only writes what differs from what is stored.

import { guestSheetRows, slimSheet, contentKey, SLIM_SHEET_VERSION } from './guestSheet.js';
import { displaySheet, sheetKey } from './display.js';
import { plannedAutoMessages } from './scheduledMessages.js';

export const RECHECK_MS = 10 * 60000;     // a trip that did not change is still looked at every 10 minutes (reminders depend on the time)
export const HEARTBEAT_MS = 6 * 3600000;  // every programme's "last updated" is refreshed at least this often, so a guest can tell fresh from forgotten

// Which trips need work now: [{ id, why: 'changed' | 'time' }], the longest-waiting first, at most `max`.
//   trips:  [{ id, change_count }]            states: [{ trip_id, change_count, checked_at }] (what the robot did last)
export function tripsDue(trips, states, nowMs, max = 3) {
  const byTrip = new Map(states.map((s) => [s.trip_id, s]));
  return trips.map((t) => {
    const s = byTrip.get(t.id);
    if (!s || s.change_count !== t.change_count) return { id: t.id, why: 'changed', waited: Infinity };
    const waited = nowMs - Date.parse(s.checked_at);
    return waited >= RECHECK_MS ? { id: t.id, why: 'time', waited } : null;
  }).filter(Boolean).sort((a, b) => b.waited - a.waited).slice(0, max).map(({ id, why }) => ({ id, why }));
}

const withoutStamp = (sheet) => { if (!sheet) return sheet; const { updatedAt: _stamp, ...rest } = sheet; return rest; };

// The guests' programmes. stored: what the server holds now, [{ token, active, data }]. sharedVersion: the version of the shared part it holds.
// Returns { shared: { version, data } | null (null = already there), upserts: [{ token, guest_id, active, data }] }.
// Only what differs is written; a programme not refreshed for 6 hours is written again with a new "last updated" moment.
// Links are never deleted here (a link the trip no longer knows is left to the owner's phone: the robot's copy of the trip may be a moment behind).
export function guestSheetJob(trip, stored, sharedVersion, now = new Date()) {
  if (!trip.guestLinks || Object.keys(trip.guestLinks).length === 0) return { shared: null, upserts: [] };
  const rows = guestSheetRows(trip, '', now.toISOString().slice(0, 10));
  const tours = {}; const ex = {};
  const slimmed = rows.map((row) => {
    if (!row.sheet || row.sheet.ended) return row;
    const { slim, shared } = slimSheet(row.sheet);
    Object.assign(tours, shared.tours); Object.assign(ex, shared.ex);
    return { ...row, sheet: slim };
  });
  const data = { tours, ex };
  const version = contentKey(JSON.stringify(data));
  const anySlim = slimmed.some((r) => r.sheet?.v === SLIM_SHEET_VERSION);
  const ready = slimmed.map((r) => (r.sheet?.v === SLIM_SHEET_VERSION ? { ...r, sheet: { ...r.sheet, shared: version } } : r));
  const byToken = new Map(stored.map((s) => [s.token, s]));
  const stamp = now.toISOString();
  const upserts = [];
  for (const row of ready) {
    const have = byToken.get(row.token);
    const want = row.sheet ?? {};
    const same = have && have.active === row.active && JSON.stringify(withoutStamp(have.data ?? {})) === JSON.stringify(withoutStamp(want));
    const old = have?.data?.updatedAt ? now.getTime() - Date.parse(have.data.updatedAt) > HEARTBEAT_MS : Boolean(row.sheet);
    if (same && !old) continue;
    upserts.push({ token: row.token, guest_id: row.guestId, active: row.active, data: row.sheet ? { ...row.sheet, updatedAt: stamp } : {} });
  }
  return { shared: anySlim && version !== sharedVersion ? { version, data } : null, upserts };
}

// The reception links and lounge screens. links: [{ token, destination_id, show_names, content_key }] (the active ones).
// Returns the ones whose content changed: [{ token, sheet, content_key }].
export function displayJob(trip, links) {
  if (trip.archivedAt || trip.deletedAt) return [];
  const out = [];
  for (const link of links) {
    const sheet = displaySheet(trip, { destinationId: link.destination_id ?? null, showNames: link.show_names !== false });
    const key = sheetKey(sheet);
    if (key !== link.content_key) out.push({ token: link.token, sheet, content_key: key });
  }
  return out;
}

// The automatic reminders the server must hold for this trip right now (the same list the owner's phone sends).
export const autoJob = (trip, now = new Date()) => plannedAutoMessages(trip, now);
