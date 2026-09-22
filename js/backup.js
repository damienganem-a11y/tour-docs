// Backup: the whole trip, and its whole journal, as one JSON file the owner can save and load back
// in (SPEC.md, "2. Settings"). Unlike every other export, this one DOES include dietary info — the
// owner's own decision, 21 Sep 2026 — which is exactly why a backup file is sensitive: never put it
// online or commit it to Git (see CLAUDE.md). It is otherwise a plain, direct copy of what the app
// already stores, so restoring it is just writing that same trip and journal back onto the phone.

const KIND = 'tour-docs-backup';
const FORMAT_VERSION = 1;

// trip + journal (that trip's own entries) -> a Blob ready to save or share.
export function buildBackup(trip, journal) {
  const text = JSON.stringify({ kind: KIND, formatVersion: FORMAT_VERSION, savedAt: new Date().toISOString(), trip, journal }, null, 2);
  return new Blob([text], { type: 'application/json' });
}

// The text of a backup file -> { trip, journal }, or throws a plain-language error if the file is
// not a Tour Docs backup (for example, the original trip file used to load a new trip — that goes
// through loader.js's buildTrip instead, from the Trips screen's "Load a trip file").
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (raw?.kind !== KIND) {
    throw new Error('This is not a Tour Docs backup file. To load a trip from its original file, use "Load a trip file" on the Trips screen instead.');
  }
  if (!raw.trip?.id || !Array.isArray(raw.journal)) {
    throw new Error('This backup file is missing its trip or its journal.');
  }
  return { trip: raw.trip, journal: raw.journal };
}

// A plain file name: "Around the World" -> "around-the-world-backup-2027-01-12.json".
export function backupFileName(trip) {
  const slug = trip.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
  return `${slug || 'trip'}-backup-${new Date().toISOString().slice(0, 10)}.json`;
}
