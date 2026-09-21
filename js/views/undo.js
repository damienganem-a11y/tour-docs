// The Undo button: like Ctrl+Z. One tap takes back the last action of the trip, no confirmation.
// It sits next to the title of each Use screen (see pageHead in chrome.js) and takes all the room
// that is left, so it can say in full what it would undo (for someone who forgot what they just did):
// what was moved, and in which half-day. It is greyed out when there is nothing to undo.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { lastUndoable, summarize } from '../journal.js';
import { showToast } from '../ui.js';

// options.wide: full width, for the roll call screen (under the row of vehicles).
export function undoButton(ctx, trip, options = {}) {
  const last = lastUndoable(ctx.journal(trip.id));
  const what = last ? summarize(last) : 'Nothing to undo';
  let busy = false; // ignore a second tap while the first is still being saved

  return h('button', {
    class: `undo-btn${options.wide ? ' undo-btn--wide' : ''}`, type: 'button', disabled: !last, 'aria-label': `Undo: ${what}`,
    onclick: async () => {
      if (busy) return;
      busy = true;
      const result = await applyChange(ctx, trip.id, { type: 'undo' });
      busy = false;
      if (result.ok) {
        ctx.refresh();
        showToast(`Undone: ${result.summary}`);
      } else {
        showToast(result.error, true);
      }
    },
  },
    h('span', { class: 'undo-label' }, '↶ Undo'),
    h('span', { class: 'undo-what' }, what),
    last ? h('span', { class: 'undo-when' }, last.slotLabel) : null);
}
