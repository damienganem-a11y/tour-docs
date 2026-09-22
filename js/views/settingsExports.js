// Settings > Exports archive: every PDF ever exported for this trip, newest first (SPEC.md, "5.
// Export" and "2. Settings"). It only shows and re-shares; there is nothing to edit or undo here —
// the export itself already happened, this is just a way to find it again.

import { h } from '../dom.js';
import { pageHead } from './chrome.js';
import { shareSavedExport } from '../export.js';

export function exportsSettingsPage(ctx, trip) {
  const records = [...ctx.exportsFor(trip.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
      eyebrow: 'Exports archive',
      title: 'Exports archive',
      subtitle: 'Every list you have exported, newest first. Tap one to share it again.',
    }),
    records.length === 0
      ? h('p', { class: 'empty' }, 'Nothing exported yet. Use Export on By destination to create one.')
      : h('ul', { class: 'list' }, records.map((record) => exportRow(record))));
}

function exportRow(record) {
  return h('li', {},
    h('button', { class: 'row', type: 'button', onclick: () => shareSavedExport(record) },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, `${record.title}, version ${record.version}`),
        h('div', { class: 'row-sub' }, record.updatedLine)),
      h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›')));
}
