// Settings > Groups: split the guests into named groups (bus groups, a boat, "Queen Victoria" and "Henry
// VI" for a guided tour...). A "split" is one such division; a guest is in ONE group of a split, and can be
// in a group of several splits at once. Not a roll call: just lists, with printable exports (exports.js).
//
// Every change goes through the one change function (changes.js), so it is in the Journal and Undo works.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { displayNames, alphabetical, capacityInfo, plural, joinNames, autoSplitPlan } from '../rules.js';
import { pageHead } from './chrome.js';
import { undoButton } from './undo.js';
import { choiceRow, notice } from './move.js';
import { pickGuests } from './guestPicker.js';
import { GROUPS_UNDO_SCOPE } from '../journal.js';
import { exportGroupsPdf, exportGroupsOverviewPdf, exportGroupsXlsx, exportGroupCards } from '../export.js';

// A labelled field for the sheets: the label above (always readable), the input, then a hint below that wraps (a placeholder
// gets cut off on a phone, so nothing important is written as a placeholder).
const field = (label, input, hint) => h('div', { class: 'form-field' }, h('label', { class: 'form-label' }, label, input), hint ? h('div', { class: 'form-hint' }, hint) : null);

let saving = false;
// Saves one change; closes the sheet and redraws on success, shows the reason on failure.
async function save(ctx, trip, change, done) {
  if (saving) return null;
  saving = true;
  const result = await applyChange(ctx, trip.id, change);
  saving = false;
  if (result.ok) { closeSheet(); ctx.refresh(); if (done) showToast(done); return result; }
  showToast(result.error, true);
  return null;
}

const activeGuests = (trip) => trip.guests.filter((g) => !g.leftAt);
const membersOf = (trip, split, groupId) => activeGuests(trip).filter((g) => split.assignments[g.id] === groupId);

export function groupsSettingsPage(ctx, trip, splitId) {
  const split = splitId ? (trip.splits ?? []).find((s) => s.id === splitId) : null;
  return split ? splitPage(ctx, trip, split) : listPage(ctx, trip);
}

// ---------- The list of splits ----------

function listPage(ctx, trip) {
  const rows = (trip.splits ?? []).map((split) => {
    const placed = activeGuests(trip).filter((g) => split.assignments[g.id] !== undefined).length;
    return h('li', {},
      h('button', { class: 'row', type: 'button', onclick: () => ctx.go(`#/trip/${trip.id}/settings/groups/${split.id}`) },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, split.name),
          h('div', { class: 'row-sub' }, `${plural(split.groups.length, 'group')} · ${placed} of ${activeGuests(trip).length} guests placed`)),
        h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›')));
  });
  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
      eyebrow: 'Groups', title: 'Groups', subtitle: 'Split the guests into named groups: buses, a boat, a guided tour.',
      action: undoButton(ctx, trip, { scope: GROUPS_UNDO_SCOPE }),
    }),
    h('button', { class: 'btn', type: 'button', disabled: Boolean(trip.archivedAt), onclick: () => newSplitSheet(ctx, trip) }, '+ New split'),
    rows.length === 0 ? h('p', { class: 'empty' }, 'No split yet.') : h('ul', { class: 'list' }, rows));
}

function newSplitSheet(ctx, trip) {
  const name = h('input', { class: 'text-input', type: 'text', maxlength: '60', 'aria-label': 'Name of the split' });
  const details = h('input', { class: 'text-input', type: 'text', maxlength: '200', 'aria-label': 'Details' });
  const groups = h('input', { class: 'text-input', type: 'text', 'aria-label': 'Group names' });
  openSheet({
    eyebrow: 'Groups', title: 'New split',
    subtitle: 'You can rename, add and remove groups afterwards.',
    body: [
      field('Name', name, 'For example: Nile transfer'),
      field('Details printed on cards (optional)', details, 'For example: Depart 07:30, hotel lobby'),
      field('Group names', groups, 'Separate with commas. For example: Bus 1, Bus 2, Bus 3'),
    ],
    footer: h('button', {
      class: 'btn', type: 'button',
      onclick: async () => {
        const list = groups.value.split(',').map((g) => ({ name: g.trim(), capacity: null })).filter((g) => g.name !== '');
        const result = await save(ctx, trip, { type: 'add-split', name: name.value, details: details.value, groups: list });
        if (result) ctx.go(`#/trip/${trip.id}/settings/groups/${result.splitId}`);
      },
    }, 'Create'),
  });
}

// ---------- One split ----------

function splitPage(ctx, trip, split) {
  const names = displayNames(trip.guests);
  const locked = Boolean(trip.archivedAt);
  const unplaced = activeGuests(trip).filter((g) => split.assignments[g.id] === undefined);

  const groupCards = split.groups.map((group) => {
    const members = membersOf(trip, split, group.id);
    const info = group.capacity === null ? null : capacityInfo(members.length, group.capacity);
    return h('div', { class: 'card' },
      h('div', { class: 'card-row' },
        h('div', { class: 'act-name' }, group.name),
        h('div', { class: `count${info?.tone === 'bad' ? ' count--bad' : ''}` }, info ? info.text : String(members.length))),
      h('div', { class: 'chips' }, [...members].sort(alphabetical(names)).map((g) => h('button', {
        class: 'chip', type: 'button', disabled: locked, onclick: () => moveGuestSheet(ctx, trip, split, g),
      }, names.get(g.id)))),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn--small btn--plain', type: 'button', disabled: locked, onclick: () => addPeopleSheet(ctx, trip, split, group) }, '+ Add people')));
  });

  const unplacedCard = unplaced.length === 0
    ? h('p', { class: 'muted count-line' }, 'Everybody is in a group.')
    : h('div', { class: 'card card--warn' },
        h('div', { class: 'card-row' }, h('div', { class: 'act-name' }, 'Not in a group yet'), h('div', { class: 'count count--bad' }, String(unplaced.length))),
        h('div', { class: 'chips' }, [...unplaced].sort(alphabetical(names)).map((g) => h('button', {
          class: 'chip', type: 'button', disabled: locked, onclick: () => moveGuestSheet(ctx, trip, split, g),
        }, names.get(g.id)))));

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings/groups`, label: 'Groups' },
      eyebrow: 'Split', title: split.name, subtitle: split.details || undefined,
      action: undoButton(ctx, trip, { scope: GROUPS_UNDO_SCOPE }),
    }),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--small btn--plain', type: 'button', disabled: locked, onclick: () => editSplitSheet(ctx, trip, split) }, 'Edit'),
      h('button', { class: 'btn btn--small btn--plain', type: 'button', disabled: locked, onclick: () => autoSplitSheet(ctx, trip, split) }, 'Auto-split')),
    ...groupCards, unplacedCard,
    h('h2', { class: 'section-title' }, 'Print or share'),
    exportButton(ctx, trip, split, 'Overview: all groups on one page (PDF)', exportGroupsOverviewPdf, true),
    exportButton(ctx, trip, split, 'Checklists: one page per group, with tick boxes (PDF)', exportGroupsPdf),
    exportButton(ctx, trip, split, 'Excel list, to edit', exportGroupsXlsx),
    exportButton(ctx, trip, split, 'Cards with each group\'s name (PDF)', exportGroupCards),
    h('button', { class: 'btn btn--plain btn--small', type: 'button', style: 'margin-top: 16px;', disabled: locked, onclick: () => deleteSplitSheet(ctx, trip, split) }, 'Delete this split'));
}

// Tick people to add to a group. Only guests not yet in any group of this split are offered.
function addPeopleSheet(ctx, trip, split, group) {
  const candidates = activeGuests(trip).filter((g) => split.assignments[g.id] === undefined);
  const used = membersOf(trip, split, group.id).length;
  pickGuests(trip, {
    candidates, mates: (guest) => candidates.filter((c) => c.partyId === guest.partyId && c.id !== guest.id),
    eyebrow: split.name, title: group.name, subtitle: 'Pick who goes in this group',
    ceiling: group.capacity, baseUsed: used, overText: 'Over the size of this group (allowed, just flagged).',
    emptyText: 'Everybody is already in a group.',
    onConfirm: (guestIds) => save(ctx, trip, { type: 'assign-guests', splitId: split.id, assignments: guestIds.map((guestId) => ({ guestId, groupId: group.id })) }, `${plural(guestIds.length, 'guest')} added to ${group.name}`),
  });
}

// One tap builds the file, keeps it in the Exports archive, and opens the share sheet. `busy` stops a
// second tap from starting a second file while the first is still being built.
let exporting = false;
function exportButton(ctx, trip, split, label, run, primary = false) {
  return h('button', {
    class: `btn${primary ? '' : ' btn--plain'}`, type: 'button',
    onclick: async () => {
      if (exporting) return;
      exporting = true;
      await run(ctx, trip, split);
      exporting = false;
    },
  }, label);
}

// Tap a guest: move them to another group, or take them out of the split. Their travel party comes along (owner's request,
// 1 Oct 2026), unless the owner unticks the box for this one move.
function moveGuestSheet(ctx, trip, split, guest) {
  const names = displayNames(trip.guests);
  const current = split.assignments[guest.id] ?? null;
  const mates = activeGuests(trip).filter((g) => g.partyId === guest.partyId && g.id !== guest.id);
  const together = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Include their travel party' });
  const who = () => (together.checked ? [guest, ...mates] : [guest]);
  const whoText = () => (together.checked && mates.length > 0 ? `${names.get(guest.id)} and their travel party` : names.get(guest.id));
  const assign = (groupId, doneText) => save(ctx, trip, { type: 'assign-guests', splitId: split.id, assignments: who().map((g) => ({ guestId: g.id, groupId })) }, doneText);
  const rows = split.groups.map((group) => choiceRow({
    title: group.name, current: group.id === current,
    side: group.capacity === null ? String(membersOf(trip, split, group.id).length) : capacityInfo(membersOf(trip, split, group.id).length, group.capacity).text,
    onclick: () => assign(group.id, `${whoText()} moved to ${group.name}`),
  }));
  if (current !== null || mates.some((m) => split.assignments[m.id] !== undefined)) {
    rows.push(choiceRow({
      title: 'Take out of every group', detail: 'Listed as not in a group',
      onclick: () => assign(null, `${whoText()} taken out`),
    }));
  }
  const body = mates.length === 0 ? rows : [
    h('label', { class: 'tick-row' }, together, h('span', {}, `Include their travel party (${joinNames([...mates].sort(alphabetical(names)).map((m) => names.get(m.id)))})`)),
    ...rows,
  ];
  openSheet({ eyebrow: split.name, title: `Where does ${names.get(guest.id)} go?`, body, cancelLabel: 'Cancel' });
}

// Rename the split, change its details line, rename / resize / add / remove groups.
function editSplitSheet(ctx, trip, split) {
  const name = h('input', { class: 'text-input', type: 'text', maxlength: '60', value: split.name, 'aria-label': 'Name of the split' });
  const details = h('input', { class: 'text-input', type: 'text', maxlength: '200', value: split.details ?? '', 'aria-label': 'Details' });
  const rows = split.groups.map((g) => ({ id: g.id, name: g.name, capacity: g.capacity }));
  const list = h('div', {});
  const draw = () => {
    list.replaceChildren(...rows.map((row, i) => h('div', { class: 'group-edit-row' },
      h('input', { class: 'text-input', type: 'text', maxlength: '40', value: row.name, placeholder: 'Name', 'aria-label': `Group ${i + 1} name`, oninput: (e) => { row.name = e.target.value; } }),
      h('input', { class: 'text-input group-size-input', type: 'number', min: '1', max: '500', inputmode: 'numeric', value: row.capacity ?? '', placeholder: 'Size', 'aria-label': `Group ${i + 1} size`, oninput: (e) => { row.capacity = e.target.value === '' ? null : Number(e.target.value); } }),
      h('button', { class: 'btn btn--small btn--plain', type: 'button', disabled: rows.length === 1, 'aria-label': `Remove group ${i + 1}`, onclick: () => { rows.splice(i, 1); draw(); } }, '×'))));
  };
  draw();
  openSheet({
    eyebrow: 'Groups', title: 'Edit split',
    subtitle: 'Removing a group takes its people out of it. Size is optional (a bus\'s seats).',
    body: [
      field('Name', name),
      field('Details printed on cards (optional)', details, 'For example: Depart 07:30, hotel lobby'),
      h('div', { class: 'form-label' }, 'Groups'),
      h('div', { class: 'form-hint' }, 'Name of each group, and its size (optional: a bus\'s seats).'),
      list,
      h('button', { class: 'btn btn--plain btn--small', type: 'button', onclick: () => { rows.push({ id: null, name: '', capacity: null }); draw(); } }, '+ Add a group'),
    ],
    footer: h('button', {
      class: 'btn', type: 'button',
      onclick: () => save(ctx, trip, { type: 'edit-split', splitId: split.id, name: name.value, details: details.value, groups: rows }, 'Split updated'),
    }, 'Save'),
  });
}

// Spreads people over the groups, keeping travel parties together (rules.js's autoSplitPlan).
function autoSplitSheet(ctx, trip, split) {
  const unplaced = activeGuests(trip).filter((g) => split.assignments[g.id] === undefined);
  const everyone = activeGuests(trip);
  const run = (guests, from) => save(ctx, trip, { type: 'assign-guests', splitId: split.id, assignments: autoSplitPlan(trip, from, guests.map((g) => g.id)) }, 'Guests spread over the groups');
  openSheet({
    eyebrow: split.name, title: 'Auto-split',
    subtitle: `Spreads people evenly over ${plural(split.groups.length, 'group')}, keeping each travel party together. One Undo takes it all back.`,
    body: [
      notice(unplaced.length === 0 ? 'Everybody is already in a group.' : `${plural(unplaced.length, 'guest')} not in a group yet.`),
      h('button', { class: 'btn', type: 'button', disabled: unplaced.length === 0, onclick: () => run(unplaced, split) }, 'Place the people not in a group'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => run(everyone, { ...split, assignments: {} }) }, `Start over: re-split all ${everyone.length} guests`),
    ],
    cancelLabel: 'Cancel',
  });
}

function deleteSplitSheet(ctx, trip, split) {
  openSheet({
    eyebrow: split.name, title: 'Delete this split?',
    subtitle: 'The groups and who is in them are removed. Undo brings it all back.',
    body: [h('button', {
      class: 'btn btn--danger', type: 'button',
      onclick: async () => { if (await save(ctx, trip, { type: 'delete-split', splitId: split.id }, 'Split deleted')) ctx.go(`#/trip/${trip.id}/settings/groups`); },
    }, 'Delete')],
    cancelLabel: 'Keep it',
  });
}
