// The Trips screen: the trips on this phone, buttons to load one from a file, duplicate one, and
// archive/un-archive/delete/reinstate a trip (SPEC.md, "1. Structure").

import { h } from '../dom.js';
import { buildTrip } from '../loader.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { tripDates } from '../time.js';
import { APP_VERSION } from '../version.js';
import { exportFinalTrip } from '../export.js';
import { pageHead, exportFormatSheet } from './chrome.js';

const SAMPLE_URL = './data/tour_docs_sample_trip_ZX-01.json';
const PURGE_AFTER_DAYS = 30; // kept equal to app.js's own purgeExpiredTrips, just for the wording shown here

export function tripsView(ctx) {
  const message = h('div', { class: 'message', role: 'alert', hidden: true });

  function showError(text) {
    message.textContent = text;
    message.hidden = false;
  }

  // Takes the text of a trip file, checks it, saves it on the phone and opens it.
  async function useTrip(json) {
    let trip;
    try {
      trip = buildTrip(JSON.parse(json));
    } catch (error) {
      showError(error instanceof SyntaxError ? 'This file is not valid JSON.' : error.message);
      return;
    }
    try {
      await ctx.addTrip(trip);
    } catch (error) {
      showError(`Could not save the trip on this phone (${error.message}).`);
      return;
    }
    ctx.go(`#/trip/${trip.id}/use/destination`);
  }

  async function loadSample() {
    try {
      const response = await fetch(SAMPLE_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await useTrip(await response.text());
    } catch (error) {
      showError(`Could not load the sample trip (${error.message}).`);
    }
  }

  const fileInput = h('input', {
    class: 'file-input', type: 'file', accept: '.json,application/json',
    onchange: async () => {
      const file = fileInput.files[0];
      if (file) await useTrip(await file.text());
      fileInput.value = ''; // so choosing the same file again still works
    },
  });

  const trips = ctx.trips;
  const active = trips.filter((t) => !t.archivedAt && !t.deletedAt).sort((a, b) => b.loadedAt.localeCompare(a.loadedAt));
  const archived = trips.filter((t) => t.archivedAt && !t.deletedAt).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  const deleted = trips.filter((t) => t.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

  const activeSection = active.length > 0
    ? h('div', {}, active.map((trip) => activeCard(ctx, trip)))
    : trips.length === 0
      ? h('div', { class: 'card' },
          h('h2', {}, 'No trip on this phone yet'),
          h('p', { class: 'muted' }, 'Load a trip to get started. It is saved on the phone and works without internet.'))
      : h('p', { class: 'muted' }, 'No trips in progress.');

  const archivedSection = archived.length > 0
    ? h('div', {},
        h('h3', { class: 'section-title' }, `Archived (${archived.length})`),
        archived.map((trip) => archivedCard(ctx, trip)))
    : null;

  const deletedSection = deleted.length > 0
    ? h('div', {},
        h('h3', { class: 'section-title' }, `Recently deleted (${deleted.length})`),
        deleted.map((trip) => deletedCard(ctx, trip)))
    : null;

  return {
    node: h('div', { class: 'screen' },
      pageHead({ eyebrow: 'Tour Docs', title: 'Your trips', subtitle: `Hello ${ctx.owner.name}` }),
      activeSection,
      h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Load a trip file (.json)'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: loadSample }, 'Load the sample trip'),
      fileInput,
      message,
      archivedSection,
      deletedSection,
      // So you can see at once which version is on the phone, and whether it can work offline.
      h('p', { class: 'muted footer-note' }, `Tour Docs ${APP_VERSION} · ${offlineStatus()}`)
    ),
  };
}

// Can the app open without internet? (Yes once its files are saved on the phone: after one visit with internet.)
function offlineStatus() {
  if (!('serviceWorker' in navigator)) return 'offline needs https';
  return navigator.serviceWorker.controller ? 'works offline' : 'open it once more to work offline';
}

const loadedOn = (trip) =>
  new Date(trip.loadedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// The date a deleted trip is erased for good, unless reinstated first.
const purgeDate = (trip) => {
  const d = new Date(trip.deletedAt);
  d.setDate(d.getDate() + PURGE_AFTER_DAYS);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

// ---------- Cards ----------

function activeCard(ctx, trip) {
  return h('div', { class: 'card' },
    h('a', { class: 'card-title', href: `#/trip/${trip.id}/use/destination` }, trip.name),
    h('div', { class: 'muted' }, tripDates(trip.start, trip.days)),
    h('div', { class: 'muted' }, `${trip.destinations.length} destinations · ${trip.guests.length} guests · loaded ${loadedOn(trip)}`),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--plain btn--small', type: 'button', onclick: () => duplicateConfirm(ctx, trip) }, 'Duplicate trip'),
      h('button', { class: 'btn btn--plain btn--small', type: 'button', onclick: () => archiveConfirm(ctx, trip) }, 'Archive')));
}

function archivedCard(ctx, trip) {
  return h('div', { class: 'card card--soft' },
    h('a', { class: 'card-title', href: `#/trip/${trip.id}/use/destination` }, trip.name),
    h('div', { class: 'muted' }, tripDates(trip.start, trip.days)),
    h('div', { class: 'muted' }, 'Read-only. Views, journal and exports still work.'),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--plain btn--small', type: 'button', onclick: () => unarchive(ctx, trip) }, 'Un-archive'),
      h('button', { class: 'btn btn--danger btn--small', type: 'button', onclick: () => deleteConfirm(ctx, trip) }, 'Delete')));
}

function deletedCard(ctx, trip) {
  return h('div', { class: 'card card--soft' },
    h('div', { class: 'card-title' }, trip.name),
    h('div', { class: 'muted' }, tripDates(trip.start, trip.days)),
    h('div', { class: 'muted' }, `Erased for good on ${purgeDate(trip)}, unless reinstated.`),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--small', type: 'button', onclick: () => reinstate(ctx, trip) }, 'Reinstate')));
}

// ---------- Actions ----------

// Saves one trip-level change (see changes.js); closes the sheet and redraws on success.
let busy = false;
async function save(ctx, tripId, change, done) {
  if (busy) return;
  busy = true;
  const result = await applyChange(ctx, tripId, change);
  busy = false;
  if (result.ok) { closeSheet(); ctx.refresh(); if (done) showToast(done); return; }
  showToast(result.error, true);
}

// Archiving is a real change (read-only from then on), so it gets a plain-language confirmation,
// like Cancel tour or Guest left the trip. Un-archiving just undoes that, so it needs none.
// SPEC.md's Final export is also offered right here (a good moment for a clean record of the trip
// as it stood, right before it goes read-only) — it opens its own sheet, so tap Archive again after.
function archiveConfirm(ctx, trip) {
  openSheet({
    eyebrow: 'Trips screen', title: `Archive "${trip.name}"?`,
    body: [
      h('p', { class: 'muted' }, 'An archived trip becomes read-only: no booking changes, no roll call. Views, the journal and exports still work. Un-archive it any time to change it again.'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => exportFormatSheet((format) => exportFinalTrip(ctx, trip, format)) }, 'Export the whole trip first'),
      h('button', { class: 'btn', type: 'button', onclick: () => save(ctx, trip.id, { type: 'archive-trip' }, `"${trip.name}" archived`) }, 'Archive trip'),
    ],
    cancelLabel: 'Cancel',
  });
}

function unarchive(ctx, trip) {
  save(ctx, trip.id, { type: 'unarchive-trip' }, `"${trip.name}" un-archived`);
}

// Only an archived trip can be deleted, and only with a confirmation (SPEC.md, "1. Structure").
function deleteConfirm(ctx, trip) {
  openSheet({
    eyebrow: 'Rare change', title: `Delete "${trip.name}"?`,
    body: [
      h('p', { class: 'muted' }, `It moves to "Recently deleted" and can be reinstated any time in the next ${PURGE_AFTER_DAYS} days. After that it is erased for good, together with its journal.`),
      h('button', { class: 'btn btn--danger', type: 'button', onclick: () => save(ctx, trip.id, { type: 'delete-trip' }, `"${trip.name}" deleted`) }, 'Delete trip'),
    ],
    cancelLabel: 'Keep the trip',
  });
}

// Reinstating just brings it back (still archived), so no confirmation, like "Bring the guest back".
function reinstate(ctx, trip) {
  save(ctx, trip.id, { type: 'reinstate-trip' }, `"${trip.name}" reinstated (still archived)`);
}

// Duplicating makes a whole new trip, so it gets a plain-language confirmation. It does not go
// through the single change function (it is a fresh trip being created, like loading one from a file).
function duplicateConfirm(ctx, trip) {
  openSheet({
    eyebrow: 'Trips screen', title: `Duplicate "${trip.name}"?`,
    body: [
      h('p', { class: 'muted' }, 'Makes a new trip with the same destinations, activities and settings. Guests, travel parties and sign-ups start empty.'),
      h('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          closeSheet();
          const copy = await ctx.duplicateTrip(trip);
          ctx.go(`#/trip/${copy.id}/settings`);
        },
      }, 'Duplicate trip'),
    ],
    cancelLabel: 'Cancel',
  });
}
