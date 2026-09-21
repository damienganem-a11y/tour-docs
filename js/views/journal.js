// Settings > Journal (owner only): the master list of every action of the trip, newest first.
// It only shows: there are no undo buttons here (Undo is the button at the top of the Use screens).
//
// One card per action. Everything that belongs to one roll call is one card for that roll call:
// tap it to see every check-in with its time.
//
// Filters: search by guest, by person, and by trip day (Day 6 = everything that changed for
// the activities of Day 6, whenever the change was made).

import { h } from '../dom.js';
import { formatMoment, formatTime } from '../time.js';
import { plain } from '../rules.js';
import { rollCallState } from '../rollcall.js';
import { groupBatches, journalItems, summarize, guestNamesOf, wasForced } from '../journal.js';
import { pageHead } from './chrome.js';

const PAGE = 50; // cards shown at once; "Show more" adds the next 50

export function journalPage(ctx, trip) {
  const items = journalItems(groupBatches(ctx.journal(trip.id))); // newest first

  // Which trip day an action concerns, and who made it (for the filters).
  const dayOf = (item) => trip.slots.find((s) => s.id === item.first.slotId)?.day ?? null;
  const days = [...new Set(items.map(dayOf).filter((d) => d !== null))].sort((a, b) => a - b);
  const people = [...new Map(items.map((i) => [i.first.who.id, i.first.who.name])).entries()]; // [id, name]

  // The words of a card, for the search box.
  const textOf = (item) => item.batches.map((b) => `${summarize(b)} ${guestNamesOf(b).join(' ')} ${b.slotLabel}`).join(' ');

  const filters = { text: '', day: null, person: null };
  const opened = new Set(); // roll call cards the owner has opened
  let limit = PAGE;

  const list = h('div', {});
  const count = h('p', { class: 'muted count-line' });

  function fill() {
    const words = plain(filters.text).split(/\s+/).filter(Boolean);
    const matching = items.filter((item) => {
      if (filters.day !== null && dayOf(item) !== filters.day) return false;
      if (filters.person !== null && item.first.who.id !== filters.person) return false;
      const text = plain(textOf(item));
      return words.every((w) => text.includes(w));
    });

    const noun = (n) => `${n} action${n === 1 ? '' : 's'}`;
    count.textContent = matching.length === items.length ? noun(items.length) : `${matching.length} of ${noun(items.length)}`;

    list.replaceChildren(
      ...(matching.length === 0
        ? [h('p', { class: 'empty' }, items.length === 0
            ? 'Nothing yet. Every change you make will be listed here.'
            : 'No action matches those filters.')]
        : matching.slice(0, limit).map((item) => (item.kind === 'rollcall' ? rollCallCard(item) : entryCard(item.batch)))),
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
        wasForced(batch) ? h('span', { class: 'tag tag--warn' }, 'Forced') : null,
        batch.kind === 'undo' ? h('span', { class: 'tag' }, 'Undo') : null,
        batch.kind === 'move' && guests > 1 ? h('span', { class: 'tag' }, `Group of ${guests}`) : null));
  }

  // One card for a whole roll call. Tap it to see every action inside, oldest first, each with its time.
  function rollCallCard(item) {
    const start = item.batches.find((b) => b.entries.some((e) => e.type === 'rollcall-start'));
    const named = item.batches.flatMap((b) => b.entries).find((e) => e.activityLabel);
    // How many guests are checked in right now (0 if the roll call was undone away entirely).
    const live = (trip.rollCalls ?? []).find((r) => r.id === item.rollCallId);
    const checkedIn = live ? rollCallState(trip, live).checkedIn.length : 0;
    const first = item.first;
    const isOpen = opened.has(item.rollCallId);

    const lines = item.batches.map((b) => h('div', { class: `line roll-line${b.undone ? ' roll-line--undone' : ''}` },
      h('span', { class: 'muted' }, formatTime(b.at, b.place.timeZone)),
      h('span', {}, summarize(b))));

    const card = h('button', {
      class: 'entry entry--button', type: 'button', 'aria-expanded': String(isOpen),
      onclick: () => { if (opened.has(item.rollCallId)) opened.delete(item.rollCallId); else opened.add(item.rollCallId); fill(); },
    },
      h('div', { class: 'entry-title' }, `Roll call: ${named?.activityLabel ?? ''}`),
      h('div', { class: 'muted' }, first.slotLabel),
      h('div', { class: 'entry-meta' },
        `${formatMoment((start ?? first).at, first.place.timeZone)} ${first.place.name} time · ${(start ?? first).who.name}`,
        h('span', { class: 'tag' }, `${checkedIn} checked in`),
        live?.endedAt ? h('span', { class: 'tag' }, 'Ended') : null,
        h('span', { class: 'tag' }, isOpen ? 'Hide' : 'Show all')),
      isOpen ? h('div', { class: 'roll-lines' }, lines) : null);
    return card;
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
    items.length > 0 ? search : null,
    days.length > 0 ? pills(days.map((d) => ({ value: d, label: `Day ${d}` })), () => filters.day, (v) => { filters.day = v; }) : null,
    people.length > 0 ? pills(people.map(([id, name]) => ({ value: id, label: name })), () => filters.person, (v) => { filters.person = v; }) : null,
    count, list);
}
