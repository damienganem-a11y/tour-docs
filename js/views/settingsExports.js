// Settings > Exports archive: every PDF ever exported for this trip, newest first (SPEC.md, "5.
// Export" and "2. Settings"), plus the two ways to make a new one: the whole trip, or a chosen
// destination/half-day (moved here from the By destination screen so Use stays uncluttered — it
// is not something you reach for every day, unlike moving a guest).

import { h } from '../dom.js';
import { pageHead, exportFormatSheet } from './chrome.js';
import { openSheet, closeSheet } from '../ui.js';
import { choiceRow } from './move.js';
import { bySlotOrder, slotLabel, dinnerCountIn } from '../rules.js';
import { shareSavedExport, previewSavedExport, exportFinalTrip, destinationExportDoc, exportAndShare, exportEveningReservations, exportConfirmationCards } from '../export.js';

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

  const reservationButton = h('button', {
    class: 'btn btn--plain', type: 'button',
    onclick: () => pickReservationEvening(ctx, trip),
  }, 'Export an evening’s reservations');

  const hasTables = trip.dinnerBookings.some((b) => dinnerCountIn(trip, b) > 0);
  const cardsButton = h('button', { class: 'btn', type: 'button', onclick: () => pickCardsEvening(ctx, trip) }, 'Export confirmation cards');

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
    hasTables ? cardsButton : null,
    hasTables ? h('p', { class: 'muted count-line' }, 'One card per travel party and table, filled in from the bookings. The logo and colour come from Settings > Brand.') : null,
    trip.restaurants.length > 0 ? reservationButton : null,
    trip.restaurants.length > 0 ? h('p', { class: 'muted count-line' }, 'All restaurants of one evening on one compact sheet, with an option to include dietary needs.') : null,
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

// Confirmation cards: pick the evening, and the PDF is built and shared straight away (one tap).
function pickCardsEvening(ctx, trip) {
  const evenings = trip.slots
    .filter((s) => trip.dinnerBookings.some((b) => b.slotId === s.id && dinnerCountIn(trip, b) > 0))
    .sort(bySlotOrder);
  openSheet({
    eyebrow: 'Exports archive', title: 'Cards for which evening?',
    body: evenings.map((s) => choiceRow({
      title: slotLabel(trip, s),
      onclick: async () => {
        closeSheet();
        if (busy) return;
        busy = true;
        await exportConfirmationCards(ctx, trip, trip.destinations.find((d) => d.id === s.destinationId), s);
        busy = false;
        ctx.refresh();
      },
    })),
    cancelLabel: 'Cancel',
  });
}

// Reservation sheet: pick the evening (every restaurant of that evening is exported together).
function pickReservationEvening(ctx, trip) {
  const withRestaurants = new Set(trip.restaurants.map((r) => r.destinationId));
  const evenings = trip.slots.filter((s) => s.half === 'Evening' && withRestaurants.has(s.destinationId)).sort(bySlotOrder);
  openSheet({
    eyebrow: 'Exports archive', title: 'Which evening?',
    body: evenings.map((s) => choiceRow({ title: slotLabel(trip, s), onclick: () => runReservations(ctx, trip, s) })),
    cancelLabel: 'Cancel',
  });
}

function runReservations(ctx, trip, slot) {
  const destination = trip.destinations.find((d) => d.id === slot.destinationId);
  exportFormatSheet(async (format, { includeDietary }) => {
    if (busy) return;
    busy = true;
    await exportEveningReservations(ctx, trip, destination, slot, format, { includeDietary });
    busy = false;
    ctx.refresh();
  }, { dietary: true });
}

function exportRow(record) {
  const formatLabel = record.format === 'xlsx' ? 'Excel' : 'PDF'; // older records saved before Excel existed are PDFs
  // Tapping the row shows the file in the phone's own viewer (share from there with Apple's own icon);
  // the Share button next to it goes straight to the share sheet.
  return h('li', { class: 'export-row' },
    h('button', { class: 'row', type: 'button', onclick: () => previewSavedExport(record) },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, `${record.title}, version ${record.version}`, h('span', { class: 'tag' }, formatLabel)),
        h('div', { class: 'row-sub' }, record.updatedLine)),
      h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›')),
    h('button', { class: 'btn btn--plain export-share', type: 'button', 'aria-label': `Share ${record.title}`, onclick: () => shareSavedExport(record) }, 'Share'));
}
