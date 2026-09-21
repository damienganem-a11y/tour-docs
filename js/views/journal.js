// Settings > Journal (owner only): the master list of every action of the trip, newest first.
// It only shows: there are no undo buttons here (Undo is the button at the top of the Use screens).
//
// Filters: search by guest, by person, and by trip day (Day 6 = everything that changed for
// the activities of Day 6, whenever the change was made).

import { h } from '../dom.js';
import { formatMoment } from '../time.js';
import { plain } from '../rules.js';
import { groupBatches, summarize, guestNamesOf } from '../journal.js';
import { pageHead } from './chrome.js';

const PAGE = 50; // cards shown at once; "Show more" adds the next 50

export function journalPage(ctx, trip) {
  const batches = groupBatches(ctx.journal(trip.id)).reverse(); // newest first

  // Which trip day an action concerns, and who made it (for the filters).
  const dayOf = (batch) => trip.slots.find((s) => s.id === batch.slotId)?.day ?? null;
  const days = [...new Set(batches.map(dayOf).filter((d) => d !== null))].sort((a, b) => a - b);
  const people = [...new Map(batches.map((b) => [b.who.id, b.who.name])).entries()]; // [id, name]

  const filters = { text: '', day: null, person: null };
  let limit = PAGE;

  const list = h('div', {});
  const count = h('p', { class: 'muted count-line' });

  function fill() {
    const words = plain(filters.text).split(/\s+/).filter(Boolean);
    const matching = batches.filter((b) => {
      if (filters.day !== null && dayOf(b) !== filters.day) return false;
      if (filters.person !== null && b.who.id !== filters.person) return false;
      const text = plain(`${summarize(b)} ${guestNamesOf(b).join(' ')} ${b.slotLabel}`);
      return words.every((w) => text.includes(w));
    });

    const noun = (n) => `${n} action${n === 1 ? '' : 's'}`;
    count.textContent = matching.length === batches.length ? noun(batches.length) : `${matching.length} of ${noun(batches.length)}`;

    list.replaceChildren(
      ...(matching.length === 0
        ? [h('p', { class: 'empty' }, batches.length === 0
            ? 'Nothing yet. Every change you make will be listed here.'
            : 'No action matches those filters.')]
        : matching.slice(0, limit).map(entryCard)),
      ...(matching.length > limit
        ? [h('button', { class: 'btn btn--plain', type: 'button', onclick: () => { limit += PAGE; fill(); } }, `Show more (${matching.length - limit} left)`)]
        : [])
    );
  }

  // One card per action (a couple moved together, a cancelled tour, an undo).
  function entryCard(batch) {
    const guests = guestNamesOf(batch).length;
    return h('div', { class: `entry${batch.undone || batch.kind === 'undo' ? ' entry--muted' : ''}` },
      h('div', { class: 'entry-title' }, summarize(batch)),
      h('div', { class: 'muted' }, batch.slotLabel),
      h('div', { class: 'entry-meta' },
        // The time is shown in the local time of the place concerned, with the place named.
        `${formatMoment(batch.at, batch.place.timeZone)} ${batch.place.name} time · ${batch.who.name}`,
        batch.undone ? h('span', { class: 'tag' }, 'Undone') : null,
        batch.kind === 'undo' ? h('span', { class: 'tag' }, 'Undo') : null,
        batch.kind === 'move' && guests > 1 ? h('span', { class: 'tag' }, `Group of ${guests}`) : null));
  }

  // A row of pills that scrolls sideways; tapping the chosen one again clears the filter.
  function pills(items, current, choose) {
    const buttons = items.map(({ value, label }) =>
      h('button', {
        class: 'strip-item', type: 'button',
        onclick: () => {
          choose(value === current() ? null : value);
          highlight();
          limit = PAGE;
          fill();
        },
      }, label));

    // Colour the chosen pill (and only that one).
    const highlight = () => buttons.forEach((button, i) => button.classList.toggle('is-active', items[i].value === current()));
    highlight();
    return h('div', { class: 'strip strip--small' }, buttons);
  }

  const search = h('input', {
    class: 'text-input', type: 'search', placeholder: 'Search by guest or activity',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search the journal',
    oninput: () => { filters.text = search.value; limit = PAGE; fill(); },
  });
  fill();

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
      eyebrow: 'Journal · Owner only',
      title: 'Journal',
      subtitle: 'Every change, newest first',
    }),
    batches.length > 0 ? search : null,
    days.length > 0 ? pills(days.map((d) => ({ value: d, label: `Day ${d}` })), () => filters.day, (v) => { filters.day = v; }) : null,
    people.length > 0 ? pills(people.map(([id, name]) => ({ value: id, label: name })), () => filters.person, (v) => { filters.person = v; }) : null,
    count, list);
}
