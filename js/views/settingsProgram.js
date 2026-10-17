// Settings > Touring > a destination > Daily program (owner's request, 17 Oct 2026): the program the guests read, day after day (see program.js).
//
//   List of destinations -> list of days of one destination -> one day (its items, in the owner's order).
// Every tap that changes something saves the WHOLE program of the destination through the one change function (changes.js, set-program), so it is in
// the Journal and Undo works. "Import a program" reads a file (JSON, the same shape as the days below) that replaces the destination's program.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { formatTypedTime, formatWeekdayDate } from '../time.js';
import { plural } from '../rules.js';
import { pageHead } from './chrome.js';
import { undoButton } from './undo.js';
import { notice } from './move.js';
import { PROGRAM_UNDO_SCOPE } from '../journal.js';
import { PROGRAM_KINDS, programOf, programForEditing, programError } from '../program.js';

const KIND_LABEL = Object.fromEntries(PROGRAM_KINDS);

// A time field that adds the ":" for you (many phone keyboards have no ":" key).
function timeField(value, label) {
  const input = h('input', { class: 'text-input', type: 'text', inputmode: 'numeric', value, placeholder: 'HH:MM (optional)', maxlength: '5', 'aria-label': label });
  input.addEventListener('input', () => { input.value = formatTypedTime(input.value); });
  return input;
}
const linesOf = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

let saving = false;
// Applies `mutate` to the destination's program (as day inputs) and saves it. Returns true when saved.
async function commit(ctx, trip, destination, mutate, done) {
  if (saving) return false;
  const days = programForEditing(programOf(trip, destination.id), destination.timeZone);
  mutate(days);
  saving = true;
  const result = await applyChange(ctx, trip.id, { type: 'set-program', destinationId: destination.id, days });
  saving = false;
  if (result.ok) { closeSheet(); ctx.refresh(); if (done) showToast(done); return true; }
  showToast(result.error, true);
  return false;
}

export function programSettingsPage(ctx, trip, destinationId, date) {
  const destination = trip.destinations.find((d) => d.id === destinationId);
  if (!destination) return destinationsPage(ctx, trip);
  return date ? dayPage(ctx, trip, destination, date) : daysPage(ctx, trip, destination);
}

function destinationsPage(ctx, trip) {
  return h('div', {},
    pageHead({ back: { href: `#/trip/${trip.id}/settings/touring`, label: 'Touring' }, eyebrow: 'Settings', title: 'Daily program', subtitle: 'Choose a destination.' }),
    h('div', { class: 'menu' }, trip.destinations.map((d) => h('a', { class: 'menu-row', href: `#/trip/${trip.id}/settings/program/${d.id}` },
      h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, d.name), h('span', { class: 'menu-hint' }, plural(programOf(trip, d.id).length, 'day'))),
      h('span', { class: 'menu-side' }, h('span', { class: 'row-chev' }, '›'))))));
}

function daysPage(ctx, trip, destination) {
  const days = programOf(trip, destination.id);
  const locked = Boolean(trip.archivedAt);
  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings/touring/${destination.id}`, label: destination.name }, eyebrow: 'Daily program', title: destination.name,
      subtitle: days.length === 0 ? 'No program yet.' : plural(days.length, 'day'), action: undoButton(ctx, trip, { scope: PROGRAM_UNDO_SCOPE }),
    }),
    locked ? notice('This trip is archived: read-only.') : null,
    days.length > 0 ? h('div', { class: 'menu' }, days.map((day) => h('a', { class: 'menu-row', href: `#/trip/${trip.id}/settings/program/${destination.id}/${day.date}` },
      h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, formatWeekdayDate(day.date)), h('span', { class: 'menu-hint' }, `${day.title || 'No title'} · ${plural(day.items.length, 'item')}`)),
      h('span', { class: 'menu-side' }, h('span', { class: 'row-chev' }, '›'))))) : h('p', { class: 'empty' }, 'Add a day, or import a program file.'),
    h('button', { class: 'btn btn--plain', type: 'button', disabled: locked, onclick: () => addDaySheet(ctx, trip, destination, days) }, '+ Add a day'),
    h('button', { class: 'btn btn--plain btn--small', type: 'button', disabled: locked, onclick: () => importSheet(ctx, trip, destination) }, 'Import a program file…'));
}

function addDaySheet(ctx, trip, destination, days) {
  const slots = trip.slots.filter((s) => s.destinationId === destination.id).map((s) => s.date).sort();
  const free = slots.find((d) => !days.some((x) => x.date === d)) ?? slots[0] ?? '';
  const dateInput = h('input', { class: 'text-input', type: 'date', value: free, 'aria-label': 'Date' });
  const titleInput = h('input', { class: 'text-input', type: 'text', maxlength: '120', placeholder: 'Day title, e.g. Welcome to Lisbon!', 'aria-label': 'Day title' });
  openSheet({
    eyebrow: destination.name, title: 'Add a day', body: [dateInput, titleInput,
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        const date = dateInput.value;
        if (await commit(ctx, trip, destination, (list) => list.push({ date, title: titleInput.value, notes: [], items: [] }), 'Day added')) ctx.go(`#/trip/${trip.id}/settings/program/${destination.id}/${date}`);
      } }, 'Add')],
    cancelLabel: 'Cancel',
  });
}

function dayPage(ctx, trip, destination, date) {
  const day = programOf(trip, destination.id).find((d) => d.date === date);
  const back = { href: `#/trip/${trip.id}/settings/program/${destination.id}`, label: 'Days' };
  if (!day) return h('div', {}, pageHead({ back, eyebrow: 'Daily program', title: 'Day not found' }), h('p', { class: 'empty' }, 'This day is not in the program (any more).'));
  const locked = Boolean(trip.archivedAt);
  const edit = (mutate, done) => commit(ctx, trip, destination, (list) => mutate(list.find((d) => d.date === date)), done);
  const clock = (item) => [item.time, item.endTime].filter(Boolean).join(' – ');
  const items = programForEditing([day], destination.timeZone)[0].items;

  const row = (item, index) => h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', {},
      h('div', { class: 'card-title' }, `${clock(item) ? `${clock(item)} · ` : ''}${item.title}`),
      h('div', { class: 'muted' }, [KIND_LABEL[item.kind], item.place].filter(Boolean).join(' · ')))),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--small btn--plain', type: 'button', disabled: locked, onclick: () => itemSheet(item) }, 'Edit'),
      h('button', { class: 'btn btn--small btn--plain', type: 'button', 'aria-label': 'Move up', disabled: locked || index === 0, onclick: () => edit((d) => { [d.items[index - 1], d.items[index]] = [d.items[index], d.items[index - 1]]; }) }, '↑'),
      h('button', { class: 'btn btn--small btn--plain', type: 'button', 'aria-label': 'Move down', disabled: locked || index === items.length - 1, onclick: () => edit((d) => { [d.items[index + 1], d.items[index]] = [d.items[index], d.items[index + 1]]; }) }, '↓')));

  function itemSheet(item) {
    const adding = !item;
    const time = timeField(item?.time ?? '', 'Start time');
    const endTime = timeField(item?.endTime ?? '', 'End time');
    const kind = h('select', { class: 'text-input', 'aria-label': 'Kind' }, PROGRAM_KINDS.map(([id, label]) => h('option', { value: id, selected: (item?.kind ?? 'event') === id }, label)));
    const title = h('input', { class: 'text-input', type: 'text', maxlength: '120', value: item?.title ?? '', placeholder: 'Title', 'aria-label': 'Title' });
    const place = h('input', { class: 'text-input', type: 'text', maxlength: '120', value: item?.place ?? '', placeholder: 'Place (optional)', 'aria-label': 'Place' });
    const text = h('textarea', { class: 'text-input', rows: '4', maxlength: '1500', placeholder: 'What the guests need to know (optional)', 'aria-label': 'Text' }, item?.text ?? '');
    const lines = h('textarea', { class: 'text-input', rows: '3', placeholder: 'Extra lines, one per line (optional), e.g. Group 1 departs 07:15', 'aria-label': 'Extra lines' }, (item?.lines ?? []).join('\n'));
    const built = () => ({ ...(item ? { id: item.id } : {}), time: time.value.trim(), endTime: endTime.value.trim(), kind: kind.value, title: title.value, place: place.value, text: text.value, lines: linesOf(lines.value) });
    openSheet({
      eyebrow: formatWeekdayDate(date), title: adding ? 'Add an item' : 'Edit item', subtitle: destination.name,
      body: [h('div', { class: 'row-two' }, time, endTime), kind, title, place, text, lines,
        h('button', { class: 'btn', type: 'button', onclick: () => edit((d) => { if (adding) d.items.push(built()); else d.items[d.items.findIndex((i) => i.id === item.id)] = built(); }, adding ? 'Item added' : 'Item saved') }, 'Save'),
        adding ? null : h('button', { class: 'btn btn--danger btn--small', type: 'button', onclick: () => edit((d) => { d.items = d.items.filter((i) => i.id !== item.id); }, 'Item deleted') }, 'Delete this item')],
      cancelLabel: 'Cancel',
    });
  }

  function titleSheet() {
    const title = h('input', { class: 'text-input', type: 'text', maxlength: '120', value: day.title, placeholder: 'Day title', 'aria-label': 'Day title' });
    const notes = h('textarea', { class: 'text-input', rows: '6', placeholder: 'Notes for the day, one per line (Wi-Fi, what to pack, the weather…)', 'aria-label': 'Notes' }, day.notes.join('\n'));
    openSheet({
      eyebrow: formatWeekdayDate(date), title: 'Title and notes', body: [title, notes,
        h('button', { class: 'btn', type: 'button', onclick: () => edit((d) => { d.title = title.value; d.notes = linesOf(notes.value); }, 'Saved') }, 'Save')],
      cancelLabel: 'Cancel',
    });
  }

  function deleteDaySheet() {
    openSheet({
      eyebrow: formatWeekdayDate(date), title: 'Delete this day?', subtitle: `${plural(items.length, 'item')} will be removed from the program. Undo brings them back.`,
      body: [h('button', { class: 'btn btn--danger', type: 'button', onclick: async () => { if (await commit(ctx, trip, destination, (list) => { list.splice(list.findIndex((d) => d.date === date), 1); }, 'Day deleted')) ctx.go(back.href); } }, 'Delete the day')],
      cancelLabel: 'Keep it',
    });
  }

  return h('div', {},
    pageHead({ back, eyebrow: destination.name, title: formatWeekdayDate(date), subtitle: day.title || 'No title', action: undoButton(ctx, trip, { scope: PROGRAM_UNDO_SCOPE }) }),
    locked ? notice('This trip is archived: read-only.') : null,
    h('button', { class: 'btn btn--plain btn--small', type: 'button', disabled: locked, onclick: titleSheet }, `Title and notes (${plural(day.notes.length, 'note')})`),
    h('h3', { class: 'section-title' }, `Items (${items.length})`),
    items.length === 0 ? h('p', { class: 'empty' }, 'No items yet.') : h('div', {}, items.map(row)),
    h('button', { class: 'btn btn--plain', type: 'button', disabled: locked, onclick: () => itemSheet(null) }, '+ Add an item'),
    h('button', { class: 'btn btn--plain btn--small', type: 'button', disabled: locked || items.length < 2,
      onclick: () => edit((d) => { d.items = [...d.items.filter((i) => i.time).sort((a, b) => a.time.localeCompare(b.time)), ...d.items.filter((i) => !i.time)]; }, 'Sorted by time') }, 'Sort by time (items without a time go last)'),
    h('button', { class: 'btn btn--danger btn--small', type: 'button', style: 'margin-top: 24px;', disabled: locked, onclick: deleteDaySheet }, 'Delete this day'));
}

// Import: a file with { "days": [ { date, title, notes, items: [ { time, endTime, kind, title, place, text, lines } ] } ] } (or just the list of days).
function importSheet(ctx, trip, destination) {
  const say = h('p', { class: 'muted' }, 'Choose the program file. It replaces the whole program of this destination (Undo brings the old one back).');
  const pick = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Program file' });
  const go = h('button', { class: 'btn', type: 'button', disabled: true }, 'Replace the program');
  let days = null;
  pick.addEventListener('change', async () => {
    days = null; go.disabled = true;
    try {
      const data = JSON.parse(await pick.files[0].text());
      const list = Array.isArray(data) ? data : data.days;
      const problem = programError(list);
      if (problem) { say.textContent = `This file cannot be used: ${problem}`; return; }
      days = list; go.disabled = false;
      say.textContent = `${plural(list.length, 'day')} and ${plural(list.reduce((n, d) => n + (d.items ?? []).length, 0), 'item')} found.`;
    } catch { say.textContent = 'This file is not a program file.'; }
  });
  go.addEventListener('click', () => { if (days) commit(ctx, trip, destination, (list) => { list.splice(0, list.length, ...days); }, 'Program imported'); });
  openSheet({ eyebrow: destination.name, title: 'Import a program', body: [say, pick, go], cancelLabel: 'Cancel' });
}
