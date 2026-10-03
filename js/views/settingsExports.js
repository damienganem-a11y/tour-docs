// Settings > Exports archive: every PDF ever exported for this trip, newest first (SPEC.md, "5.
// Export" and "2. Settings"), plus the two ways to make a new one: the whole trip, or a chosen
// destination/half-day (moved here from the By destination screen so Use stays uncluttered — it
// is not something you reach for every day, unlike moving a guest).

import { h } from '../dom.js';
import { pageHead, exportFormatSheet } from './chrome.js';
import { openSheet, closeSheet } from '../ui.js';
import { choiceRow } from './move.js';
import { bySlotOrder, slotLabel, dinnerCountIn } from '../rules.js';
import { previewSavedExport, exportName, sameDocument, exportFinalTrip, destinationExportDoc, exportAndShare, exportEveningReservations, exportConfirmationCards } from '../export.js';

// `busy` stops a second tap from starting a second (large) file while the first is still being built.
let busy = false;
let archivedOpen = false; // the Archived list stays folded until the owner opens it (and stays as they left it while they work)

export function exportsSettingsPage(ctx, trip) {
  const records = [...ctx.exportsFor(trip.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const current = records.filter((r) => !r.archivedAt);
  const archived = records.filter((r) => r.archivedAt);

  const finalExportButton = h('button', {
    class: 'btn', type: 'button',
    onclick: () => exportFormatSheet(async (format) => {
      if (busy) return;
      busy = true;
      await exportFinalTrip(ctx, trip, format);
      busy = false;
      ctx.refresh();
    }),
  }, 'Create the final export of the whole trip');

  const destinationExportButton = h('button', {
    class: 'btn btn--plain', type: 'button',
    onclick: () => pickDestination(ctx, trip),
  }, 'Create a destination or half-day list');

  const reservationButton = h('button', {
    class: 'btn btn--plain', type: 'button',
    onclick: () => pickReservationEvening(ctx, trip),
  }, 'Create an evening’s reservations');

  const hasTables = trip.dinnerBookings.some((b) => dinnerCountIn(trip, b) > 0);
  const cardsButton = h('button', { class: 'btn', type: 'button', onclick: () => pickCardsEvening(ctx, trip) }, 'Create confirmation cards');

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
      eyebrow: 'Documents',
      title: 'Documents',
      subtitle: 'Create a document, look at it, then close it or share it. Every one you made is kept below, newest first.',
    }),
    finalExportButton,
    h('p', { class: 'muted count-line' }, 'Every tour’s guest list, and every guest’s own whole trip, in one file.'),
    destinationExportButton,
    hasTables ? cardsButton : null,
    hasTables ? h('p', { class: 'muted count-line' }, 'One card per travel party and table, filled in from the bookings. The logo and colour come from Settings > Brand.') : null,
    trip.restaurants.length > 0 ? reservationButton : null,
    trip.restaurants.length > 0 ? h('p', { class: 'muted count-line' }, 'All restaurants of one evening on one compact sheet, with an option to include dietary needs.') : null,
    documentsLine(ctx),
    current.length === 0
      ? h('p', { class: 'empty' }, archived.length === 0 ? 'Nothing created yet.' : 'Nothing current: everything is archived below.')
      : h('ul', { class: 'list' }, current.map((record) => exportRow(ctx, trip, record))),
    archived.length > 0 ? archivedFolder(ctx, trip, archived) : null);
}

function pickDestination(ctx, trip) {
  openSheet({
    eyebrow: 'Documents', title: 'Export which destination?',
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
    eyebrow: 'Documents', title: 'Cards for which evening?',
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
    eyebrow: 'Documents', title: 'Which evening?',
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

// The Archived list: folded by default, so only "Archived (n)" shows until it is opened (owner's request, 1 Oct 2026).
function archivedFolder(ctx, trip, archived) {
  const folder = h('details', { class: 'archived-folder' },
    h('summary', { class: 'section-title' }, `Archived (${archived.length})`),
    h('p', { class: 'muted count-line' }, 'Documents that are no longer current. Restore one, or delete it for good.'),
    h('ul', { class: 'list' }, archived.map((record) => exportRow(ctx, trip, record))));
  folder.open = archivedOpen;
  folder.addEventListener('toggle', () => { archivedOpen = folder.open; });
  return folder;
}

// One quiet line: are the documents on this phone and level with the server? (Everything is downloaded as soon as it exists.)
function documentsLine(ctx) {
  const at = ctx.documentsInfo().lastOkAt;
  const text = at
    ? `Shared with your other devices. Everything is saved on this phone and works without internet (checked ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).`
    : 'Shared with your other devices as soon as you are online. What is listed here is saved on this phone.';
  return h('p', { class: 'muted count-line' }, text);
}

function exportRow(ctx, trip, record) {
  const formatLabel = record.format === 'xlsx' ? 'Excel' : 'PDF'; // older records saved before Excel existed are PDFs
  // Tapping the row shows the file in the phone's own viewer (share from there with Apple's own icon);
  // the "..." button next to it is for renaming, archiving and deleting.
  return h('li', { class: 'export-row' },
    h('button', { class: 'row', type: 'button', onclick: () => previewSavedExport(record) },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, exportName(record), h('span', { class: 'tag' }, formatLabel)),
        h('div', { class: 'row-sub' }, record.updatedLine)),
      h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›')),
    h('button', { class: 'btn btn--plain export-share', type: 'button', 'aria-label': `Options for ${exportName(record)}`, onclick: () => recordOptions(ctx, trip, record) }, '···'));
}

// What can be done with one document: rename it, move it to Archived (or back), delete it for good (only from Archived).
function recordOptions(ctx, trip, record) {
  const done = async (action) => { closeSheet(); await action(); ctx.refresh(); };
  // Bringing an old copy back makes it the current one: the copy that was current moves to Archived (only one current copy of a document).
  const restore = async () => {
    const now = new Date().toISOString();
    for (const current of sameDocument(ctx.exportsFor(trip.id), record)) await ctx.updateExport(trip.id, current.id, { archivedAt: now });
    await ctx.updateExport(trip.id, record.id, { archivedAt: null });
  };
  openSheet({
    eyebrow: record.archivedAt ? 'Archived document' : 'Document', title: exportName(record),
    body: [
      choiceRow({ title: 'Rename', onclick: () => renameRecord(ctx, trip, record) }),
      record.archivedAt
        ? choiceRow({ title: 'Restore (no longer archived)', onclick: () => done(restore) })
        : choiceRow({ title: 'Archive (no longer current)', onclick: () => done(() => ctx.updateExport(trip.id, record.id, { archivedAt: new Date().toISOString() })) }),
      record.archivedAt ? choiceRow({ title: 'Delete for good', detail: 'The file is erased from this phone', onclick: () => confirmDelete(ctx, trip, record) }) : null,
    ],
    cancelLabel: 'Close',
  });
}

function renameRecord(ctx, trip, record) {
  const input = h('input', { class: 'text-input', type: 'text', maxlength: '80', value: exportName(record), 'aria-label': 'Name of the document' });
  const save = async () => {
    const name = input.value.trim();
    closeSheet();
    // an empty name (or the original one) goes back to the automatic name
    await ctx.updateExport(trip.id, record.id, { customName: name === exportName({ ...record, customName: '' }) ? '' : name });
    ctx.refresh();
  };
  openSheet({
    eyebrow: 'Rename', title: 'New name',
    body: h('form', { onsubmit: (event) => { event.preventDefault(); save(); } }, input, h('button', { class: 'btn', type: 'submit' }, 'Save')),
    cancelLabel: 'Cancel',
  });
  input.focus();
}

function confirmDelete(ctx, trip, record) {
  openSheet({
    eyebrow: 'Delete for good?', title: exportName(record), subtitle: 'The file is erased from this phone and cannot be brought back. You can create it again from the bookings.',
    body: h('button', {
      class: 'btn btn--danger', type: 'button',
      onclick: async () => { closeSheet(); await ctx.deleteExport(trip.id, record.id); ctx.refresh(); },
    }, 'Delete for good'),
    cancelLabel: 'Keep it',
  });
}
