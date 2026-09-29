// A sheet to tick several guests at once, with a live count top-right, a name search, and the offer to
// add a ticked guest's travel party too. Shared by Settings > Groups. (Dining has its own older copy,
// tied to dinner tables: see dining.js's guestPicker.)
//   candidates   the guests that can be ticked
//   mates(guest) the guest's travel-party members who are also candidates
//   ceiling      a size to show the running total against, or null for none; baseUsed is who is already in
//   overText     what to say when ticking goes over the ceiling (over is flagged, never refused)

import { h } from '../dom.js';
import { openSheet } from '../ui.js';
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
  const partyPrompt = h('div', {});
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

  const offerParty = (guest) => {
    const others = mates(guest).filter((c) => !checked.has(c.id));
    if (others.length === 0) { partyPrompt.replaceChildren(); return; }
    const otherNames = joinNames([...others].sort(alphabetical(names)).map((c) => names.get(c.id)));
    partyPrompt.replaceChildren(notice(`${names.get(guest.id)} travels with ${otherNames}`),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn--small', type: 'button', onclick: () => { for (const c of others) checked.add(c.id); partyPrompt.replaceChildren(); fill(); say(); } }, `Add ${otherNames} too`),
        h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => partyPrompt.replaceChildren() }, 'No')));
  };

  // The search matches by name only. Ticks are kept across searches.
  const fill = () => {
    const words = plain(search.value).split(/\s+/).filter(Boolean);
    const shown = candidates.filter((g) => words.every((w) => plain(`${g.first} ${g.last}`).includes(w))).sort(alphabetical(names));
    list.replaceChildren(...(shown.length === 0
      ? [h('p', { class: 'empty' }, 'No guest matches that search.')]
      : shown.map((guest) => {
          const box = h('input', { type: 'checkbox', checked: checked.has(guest.id), 'aria-label': names.get(guest.id) });
          box.addEventListener('change', () => {
            if (box.checked) { checked.add(guest.id); offerParty(guest); } else { checked.delete(guest.id); partyPrompt.replaceChildren(); }
            say();
          });
          return h('label', { class: 'tick-row' }, box, h('span', {}, names.get(guest.id)));
        })));
  };

  const search = h('input', {
    class: 'text-input', type: 'search', placeholder: 'Search guests',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search guests', oninput: fill,
  });

  say();
  fill();
  openSheet({ eyebrow, title, subtitle, titleBadge, body: [partyPrompt, search, list], cancelLabel: 'Cancel', footer: [status, confirmBtn] });
}
