// Settings > Exports archive: every PDF ever exported for this trip, newest first (SPEC.md, "5.
// Export" and "2. Settings"), plus the two ways to make a new one: the whole trip, or a chosen
// destination/half-day (moved here from the By destination screen so Use stays uncluttered — it
// is not something you reach for every day, unlike moving a guest).

import { h } from '../dom.js';
import { pageHead, exportFormatSheet } from './chrome.js';
import { openSheet } from '../ui.js';
import { choiceRow } from './move.js';
import { bySlotOrder, slotLabel } from '../rules.js';
import { shareSavedExport, exportFinalTrip, destinationExportDoc, exportAndShare } from '../export.js';

// `busy` stops a second tap from starting a second (large) file while the first is still being built.
let busy = false;

export function exportsSettingsPage(ctx, trip) {
  const records = [...ctx.exportsFor(trip.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const finalExportButton = h('button', {
    class: 'btn', type: 'button',
    onclick: () => exportFormatSheet(async (format) => {
      if (busy) return;
      busy = true;
      await exportFinalTrip(ctx, trip, format);
      busy = false;
      ctx.refresh();
    }),
  }, 'Export the whole trip');

  const destinationExportButton = h('button', {
    class: 'btn btn--plain', type: 'button',
    onclick: () => pickDestination(ctx, trip),
  }, 'Export a destination or half-day');

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
      eyebrow: 'Exports archive',
      title: 'Exports archive',
      subtitle: 'Every list you have exported, newest first.',
    }),
    finalExportButton,
    h('p', { class: 'muted count-line' }, 'Every tour’s guest list, and every guest’s own whole trip, in one file.'),
    destinationExportButton,
    records.length === 0
      ? h('p', { class: 'empty' }, 'Nothing exported yet.')
      : h('ul', { class: 'list' }, records.map((record) => exportRow(record))));
}

// Export a destination or half-day: pick the destination, then "all of it" or one half-day.
function pickDestination(ctx, trip) {
  openSheet({
    eyebrow: 'Exports archive', title: 'Export which destination?',
    body: trip.destinations.map((d) => choiceRow({ title: d.name, onclick: () => pickSlot(ctx, trip, d) })),
    cancelLabel: 'Cancel',
  });
}

function pickSlot(ctx, trip, destination) {
  const slots = trip.slots.filter((s) => s.destinationId === destination.id).sort(bySlotOrder);
  const rows = [
    choiceRow({ title: `All of ${destination.name}`, detail: `${slots.length} half-days, one page each`, onclick: () => runExport(ctx, trip, destination) }),
    ...slots.map((s) => choiceRow({ title: slotLabel(trip, s), onclick: () => runExport(ctx, trip, destination, s) })),
  ];
  openSheet({ eyebrow: destination.name, title: 'Export which half-day?', body: rows, cancelLabel: 'Cancel' });
}

// slot omitted: the whole destination, one page per half-day.
function runExport(ctx, trip, destination, slot) {
  exportFormatSheet(async (format) => {
    if (busy) return;
    busy = true;
    const doc = destinationExportDoc(trip, destination, slot, ctx.owner?.name ?? 'the owner');
    await exportAndShare(ctx, trip, doc, format);
    busy = false;
    ctx.refresh();
  });
}

function exportRow(record) {
  const formatLabel = record.format === 'xlsx' ? 'Excel' : 'PDF'; // older records saved before Excel existed are PDFs
  return h('li', {},
    h('button', { class: 'row', type: 'button', onclick: () => shareSavedExport(record) },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, `${record.title}, version ${record.version}`, h('span', { class: 'tag' }, formatLabel)),
        h('div', { class: 'row-sub' }, record.updatedLine)),
      h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›')));
}
