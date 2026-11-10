// Changing a guest's colour on the spot (owner's request, 2 Nov 2026): someone turns up at the gangway and must go with another colour. Two taps from the
// tour's card in Use (or the colour groups page): the guest (a search box, each name with their colour now), then the new colour, shown as big coloured
// buttons. Their travel party comes along unless unticked. It goes through the one change function (journaled, Undo), and the guest's card follows.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { displayNames, alphabetical, colorOf, tourSplitState, joinNames, plural } from '../rules.js';
import { putIn } from '../put.js';

const square = (group, size = 16) => { const c = colorOf(group?.color); return c ? h('span', { class: 'swatch', style: `width:${size}px;height:${size}px;background:${c.hex}`, role: 'img', 'aria-label': c.name }) : null; };

export function openColourChange(ctx, trip, split) {
  const names = displayNames(trip.guests);
  const { booked } = tourSplitState(trip, split);
  const groupOf = (g) => split.groups.find((x) => x.id === split.assignments[g.id]) ?? null;
  const search = h('input', { class: 'text-input', type: 'search', placeholder: 'Search a guest', 'aria-label': 'Search a guest' });
  const list = h('div', { class: 'colour-list' });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = [...booked].sort(alphabetical(names)).filter((g) => !q || names.get(g.id).toLowerCase().includes(q) || `${g.first} ${g.last}`.toLowerCase().includes(q));
    putIn(list, ...(shown.length ? shown.map((g) => h('button', { class: 'colour-row', type: 'button', onclick: () => chooseColour(g) },
      square(groupOf(g)), h('span', {}, names.get(g.id)), h('span', { class: 'muted' }, groupOf(g)?.name ?? 'No colour yet'))) : [h('p', { class: 'empty' }, 'Nobody matches.')]));
  };
  search.addEventListener('input', draw);
  draw();
  openSheet({ eyebrow: split.name, title: 'Change a guest\'s colour', subtitle: `${plural(booked.length, 'guest')} on this tour`, body: [search, list], cancelLabel: 'Close' });
  setTimeout(() => search.focus(), 50);

  function chooseColour(guest) {
    const mates = booked.filter((g) => g.partyId === guest.partyId && g.id !== guest.id);
    const together = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Their travel party too' });
    const now = groupOf(guest);
    const buttons = split.groups.map((group) => {
      const c = colorOf(group.color);
      const count = booked.filter((g) => split.assignments[g.id] === group.id).length;
      return h('button', { class: `colour-choice${group.id === now?.id ? ' is-now' : ''}`, type: 'button', style: c ? `background:${c.hex};color:${c.ink}` : '', disabled: group.id === now?.id,
        onclick: async () => {
          const who = together.checked ? [guest, ...mates] : [guest];
          const result = await applyChange(ctx, trip.id, { type: 'assign-guests', splitId: split.id, assignments: who.map((g) => ({ guestId: g.id, groupId: group.id })) });
          if (!result.ok) { showToast(result.error, true); return; }
          closeSheet(); ctx.refresh();
          showToast(`${joinNames(who.map((g) => g.first))} → ${group.name}`);
        } },
        h('b', {}, group.name), h('span', {}, `${count}${group.capacity ? ` / ${group.capacity}` : ''}${group.id === now?.id ? ' · now' : ''}`));
    });
    openSheet({ eyebrow: split.name, title: names.get(guest.id), subtitle: now ? `Now in ${now.name}. Tap the new colour.` : 'Not in a colour yet. Tap one.',
      body: [mates.length ? h('label', { class: 'tick-row' }, together, h('span', {}, `Their travel party too (${joinNames(mates.map((m) => m.first))})`)) : null, h('div', { class: 'colour-grid' }, buttons)].filter(Boolean),
      cancelLabel: 'Cancel' });
  }
}
