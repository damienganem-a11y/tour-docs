// A sheet to tick several guests at once, with a live count top-right and a name search. Ticking a guest whose travel party is not ticked asks
// "Add X too?" full screen (owner, 5 Nov 2026; it used to tick the party silently).
// Shared by Settings > Groups. (Dining has its own older copy,
// tied to dinner tables: see dining.js's guestPicker.)
//   candidates   the guests that can be ticked
//   mates(guest) the guest's travel-party members who are also candidates
//   ceiling      a size to show the running total against, or null for none; baseUsed is who is already in
//   overText     what to say when ticking goes over the ceiling (over is flagged, never refused)

import { h } from '../dom.js';
import { openSheet, openFullScreen, closeFullScreen } from '../ui.js';
import { displayNames, alphabetical, plain, joinNames, capacityInfo } from '../rules.js';
import { notice } from './move.js';

export function pickGuests(trip, { candidates, mates, eyebrow, title, subtitle, ceiling = null, baseUsed = 0, overText = '', confirmLabel = 'Confirm', emptyText, onConfirm }) {
  const names = displayNames(trip.guests);
  if (candidates.length === 0) {
    openSheet({ eyebrow, title, subtitle, body: [h('p', { class: 'empty' }, emptyText)], cancelLabel: 'Close' });
    return;
  }

  const checked = new Set();
  const status = h('div', { class: 'notice', hidden: true });
  const titleBadge = h('div', { class: 'count' }, ceiling === null ? String(baseUsed) : capacityInfo(baseUsed, ceiling).text);
  const confirmBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: () => onConfirm([...checked]) }, confirmLabel);
  const list = h('div', {});

  const say = () => {
    confirmBtn.disabled = checked.size === 0;
    const total = baseUsed + checked.size;
    if (ceiling === null) {
      titleBadge.textContent = String(total);
      titleBadge.className = 'count';
    } else {
      const info = capacityInfo(total, ceiling);
      titleBadge.textContent = info.text;
      titleBadge.className = `count${info.tone === 'bad' ? ' count--bad' : ''}`;
    }
    status.hidden = checked.size > 0 && !(ceiling !== null && total > ceiling);
    if (checked.size === 0) status.textContent = 'Pick at least one guest.';
    else if (ceiling !== null && total > ceiling) status.textContent = overText;
  };

  // Ticking a guest whose travel party is not ticked asks, full screen, whether to add them too (the same question as everywhere else in the app,
  // owner's report of 5 Nov 2026). Unticking takes off only that guest.
  const setTicked = (guest, on) => {
    if (on) checked.add(guest.id); else checked.delete(guest.id);
    fill(); say();
    if (!on) return;
    const others = mates(guest).filter((m) => !checked.has(m.id));
    if (others.length === 0) return;
    const who = joinNames([...others].sort(alphabetical(names)).map((m) => names.get(m.id)));
    openFullScreen({
      keepSheet: true, eyebrow: 'Travel party', title: `${names.get(guest.id)} travels with ${who}`,
      body: [
        h('button', { class: 'btn', type: 'button', onclick: () => { for (const m of others) checked.add(m.id); closeFullScreen(); fill(); say(); } }, `Add ${who} too`),
        h('button', { class: 'btn btn--plain', type: 'button', onclick: () => closeFullScreen() }, 'No, just them'),
      ],
    });
  };

  // The search matches by name only. Ticks are kept across searches.
  const fill = () => {
    const words = plain(search.value).split(/\s+/).filter(Boolean);
    const shown = candidates.filter((g) => words.every((w) => plain(`${g.first} ${g.last}`).includes(w))).sort(alphabetical(names));
    list.replaceChildren(...(shown.length === 0
      ? [h('p', { class: 'empty' }, 'No guest matches that search.')]
      : shown.map((guest) => {
          const box = h('input', { type: 'checkbox', checked: checked.has(guest.id), 'aria-label': names.get(guest.id) });
          box.addEventListener('change', () => setTicked(guest, box.checked));
          return h('label', { class: 'tick-row' }, box, h('span', {}, names.get(guest.id)));
        })));
  };

  const search = h('input', {
    class: 'text-input', type: 'search', placeholder: 'Search guests',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search guests', oninput: fill,
  });

  say();
  fill();
  openSheet({ eyebrow, title, subtitle, titleBadge, body: [search, list], cancelLabel: 'Cancel', footer: [status, confirmBtn] });
}
