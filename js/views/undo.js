// The Undo button: like Ctrl+Z. One tap takes back the last action, no confirmation.
// It sits next to the title of each Use and Settings screen (see pageHead in chrome.js) and takes all the
// room that is left, so it can say in full what it would undo (for someone who forgot what they just did):
// what was moved, and in which half-day. It is greyed out when there is nothing to undo.
//
// options.scope narrows what counts as "the last action" to the ones that belong on THIS screen (see
// journal.js's lastUndoable) — so opening a guest's page never offers to undo a change made on a
// destination's tour, and a roll call's Undo only ever touches that one roll call. Omit it for the
// trip-wide last action of any kind (kept for anywhere that has not been given a narrower scope yet).

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { lastUndoable, summarize } from '../journal.js';
import { showToast } from '../ui.js';
import { icon } from './icons.js';

// For this long after a change, Undo is shown as a wide bar at the bottom of the screen, saying what it would take back (v0.151.0): right where
// the thumb is, right when it is needed. After that it goes back to its quiet place next to the title.
const FRESH_MS = 20000;

// options.wide: full width, for the roll call screen (under the row of vehicles).
export function undoButton(ctx, trip, options = {}) {
  const last = lastUndoable(ctx.journal(trip.id), options.scope);
  const what = last ? summarize(last) : 'Nothing to undo';
  let busy = false; // ignore a second tap while the first is still being saved
  const age = last?.at ? Date.now() - Date.parse(last.at) : Infinity;
  const fresh = age >= 0 && age < FRESH_MS;

  const button = h('button', {
    class: `undo-btn${options.wide ? ' undo-btn--wide' : ''}${fresh ? ' undo-btn--fresh' : ''}`, type: 'button', disabled: !last, 'aria-label': `Undo: ${what}`,
    onclick: async () => {
      if (busy) return;
      busy = true;
      const result = await applyChange(ctx, trip.id, { type: 'undo', scope: options.scope });
      busy = false;
      if (result.ok) {
        ctx.refresh();
        showToast(`Undone: ${result.summary}`);
      } else {
        showToast(result.error, true);
      }
    },
  },
    h('span', { class: 'undo-label' }, icon('undo'), 'Undo'),
    h('span', { class: 'undo-what' }, what),
    last ? h('span', { class: 'undo-when' }, last.slotLabel) : null);
  if (fresh) setTimeout(() => button.classList.remove('undo-btn--fresh'), FRESH_MS - age);
  return button;
}
