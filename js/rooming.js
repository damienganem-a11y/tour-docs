// The rooming list (v0.154.0, owner's request of 20 Nov 2026: "we are always looking at the rooming list"). Pure: no screen, no network.
// Each stop keeps its own list: destination.rooms = { guestId: '412' }. Changed only through applyChange ('set-rooms').
//   - sorted by room (the guests sharing a room together) or by last name;
//   - read from a hotel's list pasted as text (an email, an Excel column copied): names and room numbers are found on each line;
//   - copied from the previous stop (a ship's cabins stay the same).

import { plain } from './rules.js';

export const roomOf = (destination, guestId) => destination?.rooms?.[guestId] ?? null;

// Room numbers in a natural order: "2" before "12", "101" before "1001", "Suite 3" after the numbers.
export function byRoom(a, b) {
  const na = /^\d+$/.test(a) ? Number(a) : NaN; const nb = /^\d+$/.test(b) ? Number(b) : NaN;
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  if (!Number.isNaN(na)) return -1;
  if (!Number.isNaN(nb)) return 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// The guests on the trip (not those who left), and their room at this stop.
// sort 'room': [{ room, guests }] one row per room, in room order, then { room: null, guests } for those without a room.
// sort 'name': [{ room, guests: [guest] }] one row per guest, by last name then first name.
export function roomingRows(trip, destination, sort = 'room') {
  const guests = trip.guests.filter((g) => !g.leftAt);
  const byName = (a, b) => a.last.localeCompare(b.last, undefined, { sensitivity: 'base' }) || a.first.localeCompare(b.first, undefined, { sensitivity: 'base' });
  if (sort === 'name') return [...guests].sort(byName).map((g) => ({ room: roomOf(destination, g.id), guests: [g] }));
  const rooms = new Map();
  const none = [];
  for (const g of guests) {
    const room = roomOf(destination, g.id);
    if (!room) { none.push(g); continue; }
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room).push(g);
  }
  const rows = [...rooms.entries()].sort(([a], [b]) => byRoom(a, b)).map(([room, list]) => ({ room, guests: list.sort(byName) }));
  return none.length ? [...rows, { room: null, guests: none.sort(byName) }] : rows;
}

// How many guests of the trip have a room at this stop.
export function roomCount(trip, destination) {
  const guests = trip.guests.filter((g) => !g.leftAt);
  return { withRoom: guests.filter((g) => roomOf(destination, g.id)).length, total: guests.length };
}

// The stop just before this one in the trip, or null.
export function previousStop(trip, destinationId) {
  const i = trip.destinations.findIndex((d) => d.id === destinationId);
  return i > 0 ? trip.destinations[i - 1] : null;
}

// A room number on a line: after "room", "cabin", "suite", "villa", "rm", "#", or else a number of its own ("412", "3B", "B-12").
const LABELLED = /\b(?:room|rm|cabin|suite|villa|chambre|n°|no\.?|#)\s*[:.]?\s*([a-z]?-?\d{1,5}[a-z]?)\b/i;
const TOKEN = /(?:^|[\s,;|\t])([a-z]?-?\d{1,5}[a-z]?)(?=$|[\s,;|\t])/gi;
function roomOnLine(line) {
  const labelled = line.match(LABELLED);
  if (labelled) return labelled[1].toUpperCase();
  const tokens = [...line.matchAll(TOKEN)].map((m) => m[1]);
  // A hotel room has 3 digits or more ("412", "1205"): such a number wins over a small one elsewhere on the line ("2 nights"); a cabin "12" is taken when it is the only one.
  const long = tokens.filter((t) => /\d{3}/.test(t));
  const pick = long.length ? long[long.length - 1] : tokens[tokens.length - 1];
  return pick ? pick.toUpperCase() : null;
}

// Reads a hotel's rooming list pasted as text. One line per room or per guest, in any order ("Alder, Anna  412", "412 Mr & Mrs Alder",
// "Room 12 – Ben Alder / Anna Alder"). A guest is found by their last name; when two guests share it, by their first name (or its first letter) too.
// A line naming a family ("Alder") with no first name gives the room to every guest of that last name.
// Returns { rooms: { guestId: room }, lines: [{ text, room, guestIds }], notUnderstood: [text] } (a line with no room, or no guest found).
export function parseRooming(text, guests) {
  const active = guests.filter((g) => !g.leftAt);
  const words = (s) => plain(s).split(/[^a-z0-9]+/).filter(Boolean);
  const rooms = {}; const lines = []; const notUnderstood = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const room = roomOnLine(line);
    const said = new Set(words(line));
    // Last names written on the line (a last name of several words must appear whole).
    const lastHere = active.filter((g) => words(g.last).every((w) => said.has(w)));
    let found = [];
    const families = new Map();
    for (const g of lastHere) { const k = plain(g.last); if (!families.has(k)) families.set(k, []); families.get(k).push(g); }
    for (const family of families.values()) {
      if (family.length === 1) { found.push(family[0]); continue; }
      // Several guests with this last name: those whose first name (or initial) is on the line; none named = the whole family.
      const named = family.filter((g) => words(g.first).every((w) => said.has(w)) || said.has(plain(g.first).slice(0, 1)));
      found.push(...(named.length ? named : family));
    }
    found = [...new Set(found)];
    if (!room || found.length === 0) { notUnderstood.push(line); continue; }
    for (const g of found) rooms[g.id] = room;
    lines.push({ text: line, room, guestIds: found.map((g) => g.id) });
  }
  return { rooms, lines, notUnderstood };
}
