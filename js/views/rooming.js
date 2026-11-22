// Guests > "Rooming list" (v0.154.0, owner's request of 20 Nov 2026). One stop at a time (the stop of today by default): the room numbers in large,
// with the faces of who sleeps there, sorted by room or by last name, with a search box. A tap on a guest changes their room (and, in one go, their
// travel party's). "Paste the hotel's list" reads names and rooms from an email or Excel; "Same as <previous stop>" copies the cabins of a ship.
// Every change goes through applyChange ('set-rooms'), so it is in the journal and can be undone.

import { h } from '../dom.js';
import { applyChange, ROOM_MAX } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { displayNames, plain, plural } from '../rules.js';
import { pageHead, destinationMenu, destinationSub } from './chrome.js';
import { undoButton } from './undo.js';
import { ROOMING_UNDO_SCOPE } from '../journal.js';
import { face } from './faceUi.js';
import { currentSlot } from './destination.js';
import { roomOf, roomingRows, roomCount, previousStop, parseRooming } from '../rooming.js';
import { putIn } from '../put.js';

let sortBy = 'room';   // 'room' | 'name', kept while the app is open
let searchWords = '';

// The stop shown when none is chosen: the one the trip is at today (or the next one).
export function roomingStop(trip, destinationId) {
  return trip.destinations.find((d) => d.id === destinationId)
    ?? trip.destinations.find((d) => d.id === currentSlot(trip)?.destinationId)
    ?? trip.destinations[0];
}

async function saveRooms(ctx, trip, destination, rooms, done) {
  const result = await applyChange(ctx, trip.id, { type: 'set-rooms', destinationId: destination.id, rooms });
  if (result.ok) { closeSheet(); ctx.refresh(); if (done) showToast(done); } else showToast(result.error, true);
  return result.ok;
}

// One guest's room, and their travel party's in the same go (ticked by default when the party has no other room yet, or the same one).
function editRoomSheet(ctx, trip, destination, guest) {
  const names = displayNames(trip.guests);
  const party = trip.guests.filter((g) => !g.leftAt && g.partyId && g.partyId === guest.partyId && g.id !== guest.id);
  const input = h('input', { class: 'text-input room-input', type: 'text', value: roomOf(destination, guest.id) ?? '', maxlength: String(ROOM_MAX), placeholder: 'Room number', 'aria-label': 'Room number', autocapitalize: 'characters', autocomplete: 'off', inputmode: 'text' });
  const ticks = party.map((g) => {
    const box = h('input', { type: 'checkbox', checked: !roomOf(destination, g.id) || roomOf(destination, g.id) === roomOf(destination, guest.id) });
    return { g, box, row: h('label', { class: 'tick-row' }, box, face(g, 36), h('span', {}, `${names.get(g.id)}${roomOf(destination, g.id) ? ` · now ${roomOf(destination, g.id)}` : ''}`)) };
  });
  const save = () => {
    const room = input.value.trim().toUpperCase();
    const rooms = { [guest.id]: room || null };
    for (const t of ticks) if (t.box.checked) rooms[t.g.id] = room || null;
    saveRooms(ctx, trip, destination, rooms, room ? `Room ${room} saved` : 'Room removed');
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  openSheet({
    eyebrow: `Rooming · ${destination.name}`, title: names.get(guest.id),
    body: [input, ticks.length ? h('p', { class: 'sheet-hint' }, 'Same room for:') : null, ...ticks.map((t) => t.row)],
    footer: h('button', { class: 'btn', type: 'button', onclick: save }, 'Save'),
  });
  setTimeout(() => input.focus(), 60);
}

// "Paste the hotel's list": the text is read at once and shown before anything is saved.
function pasteSheet(ctx, trip, destination) {
  const names = displayNames(trip.guests);
  const text = h('textarea', { class: 'text-input', rows: '7', placeholder: 'Paste the hotel\'s list here: one line per room or per guest, with the name and the room number.\n\nAlder, Anna   412\nRoom 415 – Mr & Mrs Brown', 'aria-label': 'The hotel\'s list' });
  const preview = h('div', { class: 'paste-preview' });
  const apply = h('button', { class: 'btn', type: 'button', disabled: true }, 'Save these rooms');
  let found = { rooms: {} };
  const read = () => {
    found = parseRooming(text.value, trip.guests);
    const n = Object.keys(found.rooms).length;
    apply.disabled = n === 0;
    apply.textContent = n ? `Save ${plural(n, 'room number')}` : 'Save these rooms';
    putIn(preview, ...(text.value.trim() === '' ? [] : [
      h('p', { class: 'muted' }, n ? `Found: ${plural(n, 'guest')}.${found.notUnderstood.length ? ` Not understood: ${plural(found.notUnderstood.length, 'line')} (below).` : ''}` : 'No name and room found yet.'),
      ...found.lines.map((l) => h('div', { class: 'paste-line' }, h('b', {}, l.room), h('span', {}, l.guestIds.map((id) => names.get(id)).join(', ')))),
      ...found.notUnderstood.slice(0, 8).map((t) => h('div', { class: 'paste-line paste-line--bad' }, h('b', {}, '?'), h('span', {}, t))),
    ]));
  };
  text.addEventListener('input', read);
  apply.addEventListener('click', () => saveRooms(ctx, trip, destination, found.rooms, `${plural(Object.keys(found.rooms).length, 'room')} saved for ${destination.name}`));
  openSheet({ eyebrow: `Rooming · ${destination.name}`, title: 'Paste the hotel\'s list', subtitle: 'Nothing is saved before you check the list below. Guests not on the hotel\'s list keep their room.', body: [text, preview], footer: apply });
}

export function roomingPage(ctx, trip, destinationId) {
  const destination = roomingStop(trip, destinationId);
  const names = displayNames(trip.guests);
  const canEdit = ctx.roleFor(trip.id) !== 'viewer' && !trip.archivedAt;
  const { withRoom, total } = roomCount(trip, destination);
  const before = previousStop(trip, destination.id);
  const beforeCount = before ? roomCount(trip, before).withRoom : 0;

  const chooser = destinationMenu(trip.destinations.map((d) => ({
    label: d.name, sub: `${destinationSub(trip, d)}${roomCount(trip, d).withRoom ? ` · ${roomCount(trip, d).withRoom} rooms` : ''}`,
    href: `#/trip/${trip.id}/use/rooming/${d.id}`, active: d.id === destination.id,
  })), { eyebrow: 'Rooming list', title: 'Which stop?' });

  const sortSwitch = h('div', { class: 'switch', role: 'group', 'aria-label': 'Sort the rooming list' },
    [['room', 'By room'], ['name', 'By last name']].map(([key, label]) => h('button', { class: `switch-item${sortBy === key ? ' is-active' : ''}`, type: 'button', 'aria-pressed': String(sortBy === key), onclick: () => { sortBy = key; ctx.refresh(); } }, label)));

  const listBox = h('div', { class: 'room-list' });
  const draw = () => {
    const words = plain(searchWords).split(/\s+/).filter(Boolean);
    const fits = (g) => words.every((w) => plain(`${g.first} ${g.last} ${roomOf(destination, g.id) ?? ''}`).includes(w));
    const rows = roomingRows(trip, destination, sortBy).map((r) => ({ ...r, guests: r.guests.filter(fits) })).filter((r) => r.guests.length);
    const guestLine = (g) => h(canEdit ? 'button' : 'div', { class: 'room-guest', ...(canEdit ? { type: 'button', onclick: () => editRoomSheet(ctx, trip, destination, g) } : {}) },
      face(g, 40), h('span', { class: 'room-guest-name' }, h('b', {}, g.last), ` ${g.first}`));
    putIn(listBox, ...(rows.length === 0 ? [h('p', { class: 'empty' }, words.length ? 'Nobody matches.' : 'No guest on this trip.')]
      : rows.map((r) => (sortBy === 'room'
        ? h('section', { class: `room-card${r.room ? '' : ' room-card--none'}` },
            h('div', { class: 'room-no' }, r.room ?? 'No room yet'),
            h('div', { class: 'room-guests' }, r.guests.map(guestLine)))
        : h('div', { class: 'room-row' }, guestLine(r.guests[0]), h('span', { class: `room-no room-no--side${r.room ? '' : ' is-none'}` }, r.room ?? '—'))))));
  };
  const search = h('input', { class: 'text-input', type: 'search', placeholder: 'Search a name or a room', 'aria-label': 'Search a name or a room', value: searchWords, autocomplete: 'off' });
  search.addEventListener('input', () => { searchWords = search.value; draw(); });
  draw();

  return h('div', {},
    pageHead({ back: { href: `#/trip/${trip.id}/use/guest`, label: 'Guests' }, title: 'Rooming list', action: canEdit ? undoButton(ctx, trip, { scope: ROOMING_UNDO_SCOPE }) : null }),
    chooser,
    h('p', { class: 'muted count-line' }, withRoom === total ? `Everybody has a room in ${destination.name}.` : `${withRoom} of ${plural(total, 'guest')} have a room in ${destination.name}.`),
    canEdit ? h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--small', type: 'button', onclick: () => pasteSheet(ctx, trip, destination) }, 'Paste the hotel\'s list'),
      before && beforeCount > 0 ? h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => {
        const rooms = Object.fromEntries(trip.guests.filter((g) => !g.leftAt && roomOf(before, g.id)).map((g) => [g.id, roomOf(before, g.id)]));
        openSheet({ eyebrow: `Rooming · ${destination.name}`, title: `Same rooms as in ${before.name}?`, subtitle: `${plural(Object.keys(rooms).length, 'guest')} get the room they had in ${before.name} (a ship's cabin, the same hotel). Guests without a room there keep theirs here.`,
          body: [], footer: h('button', { class: 'btn', type: 'button', onclick: () => saveRooms(ctx, trip, destination, rooms, `Rooms copied from ${before.name}`) }, 'Copy the rooms') });
      } }, `Same as ${before.name}`) : null) : null,
    sortSwitch,
    total > 8 ? search : null,
    listBox);
}
