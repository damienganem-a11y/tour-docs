// Settings > Guests > Together (v0.134.0): families who want to be in the same tour groups ("our children get on, we want to do the tours together"). The second
// level above the travel party: a travel party is one family or cabin; a "travel together" group joins several of them. The team fills it from the list the
// guests sign. When a tour is spread over its colour groups (Settings > Groups), such a group is kept whole when one colour has room for all of it.
// Every change goes through the one change function (changes.js): journaled, with Undo.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { displayNames, alphabetical, plural, joinNames } from '../rules.js';
import { pageHead, guestsSwitch } from './chrome.js';
import { undoButton } from './undo.js';
import { notice } from './move.js';
import { pickGuests } from './guestPicker.js';
import { GUEST_UNDO_SCOPE } from '../journal.js';

let saving = false;
async function save(ctx, trip, change, done) {
  if (saving) return false;
  saving = true;
  const result = await applyChange(ctx, trip.id, change);
  saving = false;
  if (result.ok) { closeSheet(); ctx.refresh(); if (done) showToast(done); return true; }
  showToast(result.error, true);
  return false;
}

export function togetherSettingsPage(ctx, trip) {
  const names = displayNames(trip.guests);
  const locked = Boolean(trip.archivedAt);
  const list = trip.together ?? [];
  const active = trip.guests.filter((g) => !g.leftAt);

  // Pick the people (ticking one ticks their whole travel party), then a name.
  function editSheet(group) {
    const nameInput = h('input', { class: 'text-input', type: 'text', maxlength: '60', value: group?.name ?? '', placeholder: 'For example: Martin and Dupont families', 'aria-label': 'Name of the group' });
    const chosen = new Set(group?.guestIds ?? []);
    const people = h('div', { class: 'chips' });
    const drawPeople = () => people.replaceChildren(...[...chosen].map((id) => active.find((g) => g.id === id)).filter(Boolean).sort(alphabetical(names)).map((g) => h('span', { class: 'chip' }, names.get(g.id))));
    drawPeople();
    const pick = () => pickGuests(trip, {
      candidates: active.filter((g) => !chosen.has(g.id)), mates: (guest) => active.filter((c) => c.partyId === guest.partyId && c.id !== guest.id && !chosen.has(c.id)),
      eyebrow: 'Travel together', title: 'Add people', subtitle: 'Ticking one person ticks their whole travel party', emptyText: 'Everybody is already in this group.',
      onConfirm: (ids) => { for (const id of ids) chosen.add(id); editSheet({ ...(group ?? {}), name: nameInput.value, guestIds: [...chosen] }); },
    });
    openSheet({
      eyebrow: 'Travel together', title: group?.id ? 'Edit the group' : 'New group travelling together',
      subtitle: 'Families who want to be in the same tour groups. A person is in one such group at most.',
      body: [nameInput, h('div', { class: 'form-label' }, `${plural(chosen.size, 'person')}`), people,
        h('button', { class: 'btn btn--plain', type: 'button', onclick: pick }, '+ Add people'),
        chosen.size ? h('button', { class: 'btn btn--plain btn--small', type: 'button', onclick: () => { chosen.clear(); editSheet({ ...(group ?? {}), name: nameInput.value, guestIds: [] }); } }, 'Start again with nobody') : null],
      footer: [
        h('button', { class: 'btn', type: 'button', onclick: () => save(ctx, trip, { type: 'save-together', togetherId: group?.id ?? null, name: nameInput.value, guestIds: [...chosen] }, 'Saved') }, 'Save'),
        group?.id ? h('button', { class: 'btn btn--danger', type: 'button', onclick: () => save(ctx, trip, { type: 'delete-together', togetherId: group.id }, 'Group removed') }, 'Remove this group') : null,
      ].filter(Boolean),
    });
  }

  const cards = list.map((t) => {
    const members = t.guestIds.map((id) => active.find((g) => g.id === id)).filter(Boolean).sort(alphabetical(names));
    return h('button', { class: 'card card--tap', type: 'button', disabled: locked, onclick: () => editSheet(t) },
      h('div', { class: 'card-row' }, h('div', { class: 'act-name' }, t.name), h('div', { class: 'count' }, String(members.length))),
      h('div', { class: 'muted' }, joinNames(members.map((g) => names.get(g.id)))));
  });

  return h('div', {},
    pageHead({ back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' }, eyebrow: 'Guests', title: 'Travelling together',
      subtitle: 'Families who want the same tour groups', action: undoButton(ctx, trip, { scope: GUEST_UNDO_SCOPE }) }),
    guestsSwitch(trip, 'together'),
    notice('A travel party (a family or a cabin) always stays together. Here, join several families who want to do the tours together: the colour groups of a tour keep them in one group when there is room, and say so when there is not.'),
    h('button', { class: 'btn', type: 'button', disabled: locked, onclick: () => editSheet(null) }, '+ New group travelling together'),
    cards.length ? h('div', {}, ...cards) : h('p', { class: 'empty' }, 'No group yet.'));
}
