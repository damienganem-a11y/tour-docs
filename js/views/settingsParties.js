// Settings > Travel parties (step 7c, owner only): who travels together.
//
// Only travel parties of 2 or more show here — a guest travelling alone is not shown (they are still
// offered in every "add a person" / "start a new party" picker, just not listed on their own). No type
// (Couple, Family...) is shown or asked for: a party is just the people in it. "+ Add a person" adds
// someone to an existing party; "+ Create a new travel party" groups two or more people who are not
// together yet. Both go through the same one change function (changes.js): Journal and Undo both work.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { alphabetical, displayNames, joinNames, plain, plural } from '../rules.js';
import { pageHead } from './chrome.js';
import { choiceRow } from './move.js';

let saving = false;
async function save(ctx, tripId, change, done) {
  if (saving) return false;
  saving = true;
  const result = await applyChange(ctx, tripId, change);
  saving = false;
  if (result.ok) { closeSheet(); ctx.refresh(); if (done) showToast(done); return true; }
  showToast(result.error, true);
  return false;
}

export function partiesSettingsPage(ctx, trip) {
  const names = displayNames(trip.guests);
  const inOrder = alphabetical(names);

  const byParty = new Map();
  for (const guest of trip.guests) {
    if (!byParty.has(guest.partyId)) byParty.set(guest.partyId, []);
    byParty.get(guest.partyId).push(guest);
  }
  // Only parties of 2 or more: a solo guest is not a "travel party" to manage here.
  const parties = [...byParty.values()]
    .filter((members) => members.length > 1)
    .map((members) => members.sort(inOrder))
    .sort((a, b) => inOrder(a[0], b[0]));

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' }, eyebrow: 'Settings', title: 'Travel parties',
      subtitle: `${parties.length} travel part${parties.length === 1 ? 'y' : 'ies'} · tap a guest to see them`,
    }),
    h('div', {}, parties.map((members) => partyCard(ctx, trip, members, names))),
    h('button', { class: 'btn btn--plain', type: 'button', style: 'margin-top: 12px;', onclick: () => createParty(ctx, trip) }, '+ Create a new travel party'));
}

function partyCard(ctx, trip, members, names) {
  return h('div', { class: 'card' },
    h('div', { class: 'muted', style: 'padding: 2px 2px 6px;' }, plural(members.length, 'person')),
    h('div', {}, members.map((g) => h('a', {
      class: 'row', href: `#/trip/${trip.id}/settings/guests/${g.id}`,
    },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, names.get(g.id)),
        g.leftAt ? h('div', { class: 'row-sub' }, 'Left the trip') : null),
      h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›')))),
    h('button', {
      class: 'btn btn--plain btn--small', type: 'button', style: 'margin-top: 4px;',
      onclick: () => addPerson(ctx, trip, members, names),
    }, '+ Add a person'));
}

// A search list of every guest not already in this party (a guest who left is brought back in Settings >
// Guests first, not added here); tap one to join.
function guestPicker(ctx, trip, { eyebrow, title, subtitle, exclude, onPick }) {
  const names = displayNames(trip.guests);
  const inOrder = alphabetical(names);
  const options = trip.guests.filter((g) => !g.leftAt && !exclude.has(g.id)).sort(inOrder);
  const list = h('div', {});

  function fill() {
    const words = plain(search.value).split(/\s+/).filter(Boolean);
    const shown = options.filter((g) => words.every((w) => plain(`${g.first} ${g.last}`).includes(w)));
    list.replaceChildren(...(shown.length === 0
      ? [h('p', { class: 'empty' }, 'No guest matches that search.')]
      : shown.map((g) => choiceRow({ title: names.get(g.id), onclick: () => onPick(g) }))));
  }

  const search = h('input', {
    class: 'text-input', type: 'search', placeholder: 'Search guests',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search guests',
    oninput: fill,
  });
  fill();

  openSheet({ eyebrow, title, subtitle, body: [search, list], cancelLabel: 'Cancel' });
}

function addPerson(ctx, trip, members, names) {
  const partyId = members[0].partyId;
  guestPicker(ctx, trip, {
    eyebrow: 'Add a person', title: `Add to ${joinNamesShort(members, names)}'s party`,
    exclude: new Set(members.map((g) => g.id)),
    onPick: (g) => save(ctx, trip.id, { type: 'join-party', guestId: g.id, partyId }, `${names.get(g.id)} joined the travel party`),
  });
}

// Pick two or more guests (search, tick as many as needed), then start their new party together.
function createParty(ctx, trip) {
  const names = displayNames(trip.guests);
  const inOrder = alphabetical(names);
  const options = trip.guests.filter((g) => !g.leftAt).sort(inOrder);
  const picked = new Set();
  const list = h('div', {});
  const say = h('p', { class: 'muted' });
  const confirm = h('button', { class: 'btn', type: 'button' }, 'Create the travel party');

  const update = () => {
    say.textContent = picked.size === 0 ? 'Pick 2 or more guests.' : `${plural(picked.size, 'guest')} picked.`;
    confirm.disabled = picked.size < 2;
  };

  function fill() {
    const words = plain(search.value).split(/\s+/).filter(Boolean);
    const shown = options.filter((g) => words.every((w) => plain(`${g.first} ${g.last}`).includes(w)));
    list.replaceChildren(...(shown.length === 0
      ? [h('p', { class: 'empty' }, 'No guest matches that search.')]
      : shown.map((g) => choiceRow({
          title: names.get(g.id), current: picked.has(g.id),
          onclick: () => { if (picked.has(g.id)) picked.delete(g.id); else picked.add(g.id); update(); fill(); },
        }))));
  }

  const search = h('input', {
    class: 'text-input', type: 'search', placeholder: 'Search guests',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search guests',
    oninput: fill,
  });
  confirm.addEventListener('click', () => save(ctx, trip.id, { type: 'create-party', guestIds: [...picked] }, 'New travel party created'));
  update();
  fill();

  openSheet({
    eyebrow: 'New travel party', title: 'Who travels together?',
    body: [say, search, list, confirm], cancelLabel: 'Cancel',
  });
}

const joinNamesShort = (members, names) => joinNames(members.map((g) => names.get(g.id)));
