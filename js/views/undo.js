// The Undo button: like Ctrl+Z. One tap takes back the last action of the trip, no confirmation.
// It shows what it would undo, and is greyed out when there is nothing to undo.
// It sits next to the title of each Use screen (see pageHead in chrome.js).

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { lastUndoable, summarize } from '../journal.js';
import { showToast } from '../ui.js';

export function undoButton(ctx, trip) {
  const last = lastUndoable(ctx.journal(trip.id));
  const what = last ? summarize(last) : 'nothing to undo';
  let busy = false; // ignore a second tap while the first is still being saved

  return h('button', {
    class: 'undo-btn', type: 'button', disabled: !last, 'aria-label': `Undo: ${what}`,
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
    h('span', { class: 'undo-what' }, what));
}
