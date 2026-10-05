// The Trips screen: the trips on this phone, buttons to load one from a file, duplicate one, and
// archive/un-archive/delete/reinstate a trip (SPEC.md, "1. Structure").

import { h } from '../dom.js';
import { buildTrip, brandingFromLook } from '../loader.js';
import { openCompanyLookSheet } from './companyLook.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { tripDates } from '../time.js';
import { APP_VERSION } from '../version.js';
import { exportFinalTrip } from '../export.js';
import { readXlsx, tripRawFromWorkbook } from '../xlsxImport.js';
import { buildTemplateXlsx } from '../xlsx.js';
import { shareOrDownloadFile } from '../ui.js';
import { openPreviewSheet } from './preview.js';
import { pageHead, exportFormatSheet, syncDot } from './chrome.js';
import { SAMPLE_CARDS } from '../sampleMenus.js';
import { rehearsalTrip } from '../rehearsal.js';

const SAMPLE_URL = './data/tour_docs_sample_trip_ZX-01.json';
const RHONE_SAMPLE_URL = './data/tour_docs_sample_trip_RN-01.json'; // a fictional 8-day river cruise, 160 guests, families with ages (tools/make_rhone_sample.py)
const JET_SAMPLE_URL = './data/tour_docs_sample_trip_JET-01.json'; // a fictional 25-day private-jet trip (tools/make_jet_sample.py)
const PURGE_AFTER_DAYS = 30; // kept equal to app.js's own purgeExpiredTrips, just for the wording shown here

// Whether the Archived / Recently deleted sections are unfolded (like the "guests who left" fold in
// Settings > Guests). Kept here so it survives a redraw; resets when the app is reloaded, which is fine.
let archivedOpen = false;
let deletedOpen = false;

export function tripsView(ctx) {
  const message = h('div', { class: 'message', role: 'alert', hidden: true });

  function showError(text) {
    message.textContent = text;
    message.hidden = false;
  }

  // Takes the text of a trip file, checks it, saves it on the phone and opens it.
  async function useTrip(json) {
    let raw;
    try { raw = JSON.parse(json); } catch { showError('This file is not valid JSON.'); return null; }
    return useRaw(raw);
  }

  // Checks a raw trip (from a .json file or an Excel file), saves it on the phone and opens it.
  async function useRaw(raw) {
    let trip;
    try {
      trip = buildTrip(raw);
    } catch (error) {
      showError(error.message);
      return null;
    }
    try {
      await ctx.addTrip(trip);
    } catch (error) {
      showError(`Could not save the trip on this phone (${error.message}).`);
      return null;
    }
    ctx.go(`#/trip/${trip.id}/use/destination`);
    // No company look yet: offer to set it now, once per device (skippable; the "My company" button stays).
    // The screen redraws when the address changes, which would close a sheet opened at the same instant,
    // so it opens just after.
    if (!ctx.companyLook && !ctx.companyLookAsked) {
      ctx.markCompanyLookAsked();
      setTimeout(() => openCompanyLookSheet(ctx, {
        title: 'Set up your company look', skipLabel: 'Skip for now',
        onSaved: (look) => applyChange(ctx, trip.id, { type: 'set-branding', ...brandingFromLook(look, trip.branding?.cardNote ?? '') }),
      }), 400);
    }
    return trip;
  }

  // The sample trip ships with no restaurants, same as any real trip (Phase 3 step 1: set up in
  // Settings, one at a time) — but a first look at Dining with nothing in it is a poor demo of the
  // feature. So loading the SAMPLE trip specifically (never a real uploaded file) also books 5
  // fictional restaurants onto Lisbon's evening, through the ordinary add-restaurant change — owner's
  // call, 24 Sep 2026, mirroring a real restaurant-booking spreadsheet they shared — exactly as if
  // freshly typed in: journaled, undoable, editable like any other restaurant.
  async function seedSampleDining(trip, destinationName, names = ['Salsa', 'Melaleuca', 'La Cucina', 'Zinc', 'Wrasse & Roe']) {
    const destination = trip.destinations.find((d) => d.name === destinationName);
    if (!destination) return;
    for (const name of names) {
      await applyChange(ctx, trip.id, {
        type: 'add-restaurant', destinationId: destination.id, name,
        seatings: ['18:45', '19:15'], mode: 'strict', seatsPerSeating: null, maxTableSize: null, tableSizes: [2, 4],
      });
      // Each restaurant also gets an invented presentation and menu (see sampleMenus.js), so the guest app has something to show.
      const added = ctx.trip(trip.id)?.restaurants.find((r) => r.name === name && r.destinationId === destination.id);
      if (added && SAMPLE_CARDS[name]) await applyChange(ctx, trip.id, { type: 'restaurant-card', restaurantId: added.id, card: SAMPLE_CARDS[name] });
    }
    ctx.refresh();
  }

  async function loadSample() {
    try {
      const response = await fetch(SAMPLE_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const trip = await useTrip(await response.text());
      if (trip) await seedSampleDining(trip, 'Lisbon');
    } catch (error) {
      showError(`Could not load the sample trip (${error.message}).`);
    }
  }

  // A tiny fictional trip that starts today, to try the reminders and alerts in real time (rehearsal.js).
  async function loadRehearsal() {
    try {
      const trip = await useTrip(JSON.stringify(rehearsalTrip()));
      if (trip) await seedSampleDining(trip, 'Rehearsal City', ['Chez Test', 'Bistro Rehearsal']);
    } catch (error) {
      showError(`Could not load the rehearsal trip (${error.message}).`);
    }
  }

  async function loadJetSample() {
    try {
      const response = await fetch(JET_SAMPLE_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const trip = await useTrip(await response.text());
      if (trip) await seedSampleDining(trip, 'Port Douglas'); // the dine-around: five restaurants in Australia
    } catch (error) {
      showError(`Could not load the jet sample trip (${error.message}).`);
    }
  }

  async function loadRhoneSample() {
    try {
      const response = await fetch(RHONE_SAMPLE_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await useTrip(await response.text());
    } catch (error) {
      showError(`Could not load the river cruise sample (${error.message}).`);
    }
  }

  // Excel import: read the file, show what was found (and anything odd) in plain words, then create the trip on a tap.
  const excelInput = h('input', {
    class: 'file-input', type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    onchange: async () => {
      const file = excelInput.files[0];
      excelInput.value = '';
      if (!file) return;
      message.hidden = true;
      let found;
      try {
        found = tripRawFromWorkbook(await readXlsx(await file.arrayBuffer()), { name: file.name.replace(/\.xlsx$/i, '').replace(/[_-]+/g, ' ').trim(), code: '' });
      } catch (error) {
        showError(error.message);
        return;
      }
      importPreviewSheet(found, async (raw) => { closeSheet(); await useRaw(raw); });
    },
  });
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

  // "Add a trip": one button, one sheet (owner's request, 3 Oct 2026: the screen had a long column of buttons). The file pickers stay hidden here and
  // are opened by a tap in the sheet.
  const row = (title, hint, run, extra = null) => h('button', { class: 'menu-row', type: 'button', onclick: run },
    h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, title), hint ? h('span', { class: 'menu-hint' }, hint) : null),
    h('span', { class: 'menu-side' }, extra, h('span', { class: 'row-chev' }, '›')));
  function openAddSheet() {
    openSheet({
      eyebrow: 'Trips', title: 'Add a trip', cancelLabel: 'Close',
      body: [
        h('div', { class: 'menu' },
          row('Open a trip file', 'A .json file', () => { closeSheet(); fileInput.click(); }),
          row('Import from Excel', 'An .xlsx file in the Tour Docs layout', () => { closeSheet(); excelInput.click(); }),
          row('Excel template', 'A blank file to fill in', () => { closeSheet(); shareOrDownloadFile(buildTemplateXlsx(), 'tour-docs-trip-template.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); })),
        h('div', { class: 'section-title' }, 'Sample trips (fictional)'),
        h('div', { class: 'menu' },
          row('Around the World', '24 days, 80 guests', () => { closeSheet(); loadSample(); }),
          row('Private Jet Expedition', '25 days, 40 guests, with tour information and pictures', () => { closeSheet(); loadJetSample(); }),
          row('Rhône River Cruise', '8 days, 160 guests: families with ages, age rules on some tours', () => { closeSheet(); loadRhoneSample(); }),
          row('Rehearsal trip', 'Starts today: to try reminders and alerts in real time', () => { closeSheet(); loadRehearsal(); })),
      ],
    });
  }

  // "Account": what belongs to this phone and this person, not to a trip.
  function openAccountSheet() {
    const faceId = !ctx.biometricAvailable ? null
      : ctx.biometricOn
        ? row('Face ID / Touch ID', 'On: asked every time the app is reopened', async () => { await ctx.disableBiometric(); closeSheet(); }, h('span', { class: 'muted' }, 'Turn off'))
        : row('Face ID / Touch ID', 'Off', async () => {
          try { await ctx.enableBiometric(); closeSheet(); showToast('Face ID / Touch ID is on: it will be offered every time the app is reopened.'); }
          catch (error) { showToast(`Could not turn on Face ID / Touch ID (${error.message}).`, true); }
        }, h('span', { class: 'muted' }, 'Turn on'));
    openSheet({
      eyebrow: 'Account', title: ctx.owner.name, subtitle: 'This phone', cancelLabel: 'Close',
      body: [
        h('div', { class: 'menu' },
          row('Company look', ctx.companyLook?.companyName || 'Logo and colour for new trips', () => { closeSheet(); openCompanyLookSheet(ctx); }),
          faceId,
          ctx.previewRole ? null : row('Preview as…', 'View only, Team or Guest', () => { closeSheet(); openPreviewSheet(ctx); }),
          row('Sign out', null, () => { closeSheet(); ctx.signOut(); })),
        // So you can see at once which version is on the phone, and whether it can work offline.
        h('p', { class: 'muted footer-note' }, `Tour Docs ${APP_VERSION} · ${offlineStatus()}`),
      ],
    });
  }

  const foldRow = (open, label, count, toggle) => h('button', { class: 'fold-row', type: 'button', onclick: toggle },
    h('span', {}, `${open ? '▾' : '▸'} ${label}`), h('span', { class: 'fold-count' }, String(count)));

  return {
    node: h('div', { class: 'screen' },
      pageHead({
        eyebrow: 'Tour Docs', title: 'Your trips', subtitle: `Hello ${ctx.owner.name}`,
        action: h('span', { class: 'head-tools' }, syncDot(ctx),
          h('button', { class: 'avatar', type: 'button', 'aria-label': 'Account', onclick: openAccountSheet }, (ctx.owner.name || '?').trim().slice(0, 1).toUpperCase())),
      }),
      activeSection,
      h('button', { class: 'btn', type: 'button', onclick: openAddSheet }, '+ Add a trip'),
      fileInput,
      excelInput,
      message,
      archived.length > 0
        ? h('div', {}, foldRow(archivedOpen, 'Archived', archived.length, () => { archivedOpen = !archivedOpen; ctx.refresh(); }),
            archivedOpen ? h('div', {}, archived.map((trip) => archivedCard(ctx, trip))) : null)
        : null,
      deleted.length > 0
        ? h('div', {}, foldRow(deletedOpen, 'Recently deleted', deleted.length, () => { deletedOpen = !deletedOpen; ctx.refresh(); }),
            deletedOpen ? h('div', {}, deleted.map((trip) => deletedCard(ctx, trip))) : null)
        : null,
      h('p', { class: 'muted footer-note' }, `Tour Docs ${APP_VERSION}`)
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

// A trip in progress: the whole card opens it; the three less common actions (rename, duplicate, archive) sit behind a "···" button.
function activeCard(ctx, trip) {
  const more = h('button', { class: 'card-more', type: 'button', 'aria-label': `More about ${trip.name}`, onclick: (event) => {
    event.preventDefault();
    const row = (title, run) => h('button', { class: 'menu-row', type: 'button', onclick: () => { closeSheet(); run(); } },
      h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, title)), h('span', { class: 'menu-side' }, h('span', { class: 'row-chev' }, '›')));
    openSheet({ eyebrow: 'Trip', title: trip.name, cancelLabel: 'Close', body: h('div', { class: 'menu' },
      row('Rename', () => renameConfirm(ctx, trip)), row('Duplicate trip', () => duplicateConfirm(ctx, trip)), row('Archive', () => archiveConfirm(ctx, trip))) });
  } }, '···');
  return h('div', { class: 'card trip-card' },
    h('a', { class: 'trip-card-link', href: `#/trip/${trip.id}/use/destination` },
      h('span', { class: 'card-title' }, trip.name),
      h('span', { class: 'muted trip-line' }, tripDates(trip.start, trip.days)),
      h('span', { class: 'muted trip-line' }, `${trip.destinations.length} destinations · ${trip.guests.length} guests`)),
    more);
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

// Renaming the trip goes through the one change function, so it is journaled and undoable, like any
// other change — including for a freshly loaded or duplicated trip (given a default name it may want to change).
function renameConfirm(ctx, trip) {
  const input = h('input', { class: 'text-input', type: 'text', value: trip.name, 'aria-label': 'Trip name', maxlength: '120' });
  const confirm = h('button', {
    class: 'btn', type: 'button',
    onclick: () => save(ctx, trip.id, { type: 'rename-trip', name: input.value }, 'Trip renamed'),
  }, 'Save');

  openSheet({ eyebrow: 'Trips screen', title: 'Rename trip', body: [input, confirm], cancelLabel: 'Cancel' });
}

// Duplicating makes a whole new trip, so it gets a plain-language confirmation, with a chance to give
// the copy its own name right away. It does not go through the single change function (it is a fresh
// trip being created, like loading one from a file).
function duplicateConfirm(ctx, trip) {
  const input = h('input', {
    class: 'text-input', type: 'text', value: `${trip.name} (copy)`, 'aria-label': 'New trip name', maxlength: '120',
  });

  openSheet({
    eyebrow: 'Trips screen', title: `Duplicate "${trip.name}"?`,
    body: [
      h('p', { class: 'muted' }, 'Makes a new trip with the same destinations, activities and settings. Guests, travel parties and sign-ups start empty.'),
      input,
      h('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          const name = input.value.trim() || `${trip.name} (copy)`;
          closeSheet();
          const copy = await ctx.duplicateTrip(trip, name);
          ctx.go(`#/trip/${copy.id}/settings`);
        },
      }, 'Duplicate trip'),
    ],
    cancelLabel: 'Cancel',
  });
}


// What the Excel file contains, in plain words, with the trip's name and code to confirm. `found` = { raw, summary, warnings }.
function importPreviewSheet(found, create) {
  const { raw, summary, warnings } = found;
  const name = h('input', { class: 'text-input', type: 'text', maxlength: '80', value: raw.trip.name, 'aria-label': 'Trip name' });
  const code = h('input', { class: 'text-input', type: 'text', maxlength: '20', value: raw.trip.code, 'aria-label': 'Trip code' });
  const lines = [
    `${summary.destinations} destinations, ${summary.days} days, starting ${raw.trip.start}`,
    `${summary.halfDays} half-days and ${summary.activities} activities`,
    `${summary.guests} guests, ${summary.signups} sign-ups`,
  ];
  openSheet({
    eyebrow: 'Import', title: 'This is what the file contains',
    body: [
      h('ul', { class: 'import-lines' }, lines.map((l) => h('li', {}, l))),
      ...warnings.map((w) => h('div', { class: 'notice' }, w)),
      h('div', { class: 'form-field' }, h('label', { class: 'form-label' }, 'Trip name', name)),
      h('div', { class: 'form-field' }, h('label', { class: 'form-label' }, 'Trip code (optional)', code), h('div', { class: 'form-hint' }, 'A short label, for example ZX-01.')),
    ],
    footer: h('button', {
      class: 'btn', type: 'button',
      onclick: () => {
        if (name.value.trim() === '') { name.focus(); return; }
        create({ ...raw, trip: { ...raw.trip, name: name.value.trim(), code: code.value.trim() } });
      },
    }, 'Create the trip'),
    cancelLabel: 'Cancel',
  });
}
