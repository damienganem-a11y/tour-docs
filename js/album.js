// Our Album (v0.128.0): the pure rules, no network and no screen. The photos themselves live on the server (supabase/functions/album); the trip only keeps the
// album's SETTINGS: trip.album = { enabled, downloadDays } (all optional; the album is on by default).
//
// The two dates follow the trip, so nothing is typed by hand:
//   - guests can ADD photos until their link expires = the trip's last day + 7 days (guestLinkExpiry; the "one more week" owner asked for);
//   - guests can DOWNLOAD until the trip's last day + downloadDays (60 by default); after that the server erases every photo.

import { addDays } from './time.js';
import { guestLinkExpiry } from './guestSheet.js';

export const ALBUM_DOWNLOAD_DAYS = 60;

// The settings as the app uses them: { enabled, downloadDays, uploadUntil, downloadUntil } (dates 'YYYY-MM-DD', or null for a trip with no days).
export function albumSettings(trip) {
  const saved = trip.album ?? {};
  const dates = (trip.slots ?? []).map((s) => s.date).sort();
  const last = dates.length ? dates[dates.length - 1] : null;
  const downloadDays = Number.isInteger(saved.downloadDays) ? saved.downloadDays : ALBUM_DOWNLOAD_DAYS;
  return { enabled: saved.enabled !== false, downloadDays, uploadUntil: last ? guestLinkExpiry(trip) : null, downloadUntil: last ? addDays(last, downloadDays) : null };
}

// A sentence for the owner's change function: null when the settings are fine.
export function albumSettingsError(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'The album settings are not valid.';
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'enabled') { if (typeof value !== 'boolean') return 'The album is on or off.'; }
    else if (key === 'downloadDays') { if (!Number.isInteger(value) || value < 14 || value > 365) return 'Guests can download for 14 to 365 days after the trip.'; }
    else return `"${key}" is not an album setting.`;
  }
  return null;
}

// What phase the album is in on a given day ('YYYY-MM-DD'): 'off', 'open' (adding and downloading), 'download' (adding is closed), 'over' (erased).
export function albumPhase(settings, today) {
  if (!settings.enabled) return 'off';
  if (settings.downloadUntil && today > settings.downloadUntil) return 'over';
  if (settings.uploadUntil && today > settings.uploadUntil) return 'download';
  return 'open';
}

// Who has saved everything: photos = [{ id, guest_id }] of the album, marks = [{ guest_id, photo_id, state }]. A guest's own photos do not count against them
// (the server marks them saved at upload). A skipped photo counts as dealt with; a photo only marked "kept" does not. Returns [{ guestId, total, done, missing, complete }].
export function downloadProgress(photos, marks, guestIds) {
  const dealt = new Map();
  for (const m of marks) { if (m.state === 'kept') continue; if (!dealt.has(m.guest_id)) dealt.set(m.guest_id, new Set()); dealt.get(m.guest_id).add(m.photo_id); }
  return guestIds.map((guestId) => {
    const got = dealt.get(guestId) ?? new Set();
    const mine = photos.filter((p) => p.guest_id !== guestId);
    const done = mine.filter((p) => got.has(p.id)).length;
    return { guestId, total: mine.length, done, missing: mine.length - done, complete: mine.length - done === 0 };
  });
}

// The notifications every guest gets about the album (messages the owner's phone hands to the server's timer, like the other automatic ones).
// Returns [{ key, at: 'YYYY-MM-DD', hour, title, body }]; a date in the past is simply dropped by the caller.
export function albumReminders(trip) {
  const s = albumSettings(trip);
  if (!s.enabled || !s.uploadUntil || !s.downloadUntil) return [];
  return [
    { key: 'album-closing', date: addDays(s.uploadUntil, -7), hour: 18, title: 'Our Album: one week left', body: 'You still have one week to add your last photos to Our Album before it closes for new photos.' },
    { key: 'album-download', date: addDays(s.uploadUntil, 1), hour: 10, title: 'Our Album is closed: download your photos', body: 'No more photos can be added. Open Our Album and save everything to your phone now.' },
    { key: 'album-last-call', date: addDays(s.downloadUntil, -14), hour: 10, title: 'Our Album: two weeks left to download', body: 'The photos will be erased in two weeks. Open Our Album and tap Download new.' },
  ];
}
