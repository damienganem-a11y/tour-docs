// Settings > Dining (Phase 3 step 1, owner only): set up restaurants. Separate from Touring
// (settingsTouring.js) — the owner said (24 Sep 2026) touring and dining should be two clearly
// separate places to work in, since not every destination has dining. A flat list of every
// restaurant in the trip, not grouped by destination first: most destinations have none, so
// picking a destination before seeing anything would mean clicking through mostly-empty ones.
// "Add restaurant" picks its destination from a menu instead (like "Add activity" picks its
// half-day). Nothing can be booked onto a restaurant yet — that is the next step.
//
// Every change here goes through the one change function (changes.js), so it is in the Journal and Undo works.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { plural } from '../rules.js';
import { pageHead } from './chrome.js';
import { undoButton } from './undo.js';
import { DINING_UNDO_SCOPE } from '../journal.js';
import { parseMenuText, menuToText, MENU_TAGS } from '../menuCard.js';

// Saves one settings change; closes the sheet and redraws on success, shows the reason on failure.
let saving = false;
async function save(ctx, tripId, change, done) {
  if (saving) return false;
  saving = true;
  const result = await applyChange(ctx, tripId, change);
  saving = false;
  if (result.ok) { closeSheet(); ctx.refresh(); if (done) showToast(done); return true; }
  showToast(result.error, true);
  return false;
}

export function diningSettingsPage(ctx, trip) {
  const restaurantsByDestination = new Map(trip.destinations.map((d) => [d.id, d]));
  const restaurants = [...trip.restaurants].sort((a, b) => {
    const da = restaurantsByDestination.get(a.destinationId)?.name ?? '';
    const db = restaurantsByDestination.get(b.destinationId)?.name ?? '';
    return da.localeCompare(db) || a.name.localeCompare(b.name);
  });

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
      eyebrow: 'Settings', title: 'Dining',
      subtitle: `${plural(restaurants.length, 'restaurant')} set up`,
      action: undoButton(ctx, trip, { scope: DINING_UNDO_SCOPE }),
    }),
    restaurants.length === 0
      ? h('p', { class: 'empty' }, 'No restaurants set up yet.')
      : h('div', {}, restaurants.map((r) => restaurantRow(ctx, trip, restaurantsByDestination.get(r.destinationId), r))),
    h('button', {
      class: 'btn btn--plain', type: 'button', disabled: Boolean(trip.archivedAt),
      onclick: () => addRestaurant(ctx, trip),
    }, '+ Add restaurant'));
}

// One restaurant, tap to edit it. Phase 3 step 1: no capacity/full-up state to show yet — nothing
// books onto it until the next step.
function restaurantSummary(r) {
  const mode = r.mode === 'flexible'
    ? `Flexible · ${r.seatsPerSeating} seats/seating · max table ${r.maxTableSize}`
    : `Strict · ${plural(r.tables.length, 'table')} (${r.tables.map((t) => t.size).join(', ')})`;
  return `${mode} · ${r.seatings.join(', ')}`;
}

function restaurantRow(ctx, trip, destination, restaurant) {
  const head = h('button', {
    class: 'card-head', type: 'button', disabled: Boolean(trip.archivedAt),
    onclick: () => editRestaurant(ctx, trip, destination, restaurant),
  },
    h('div', { class: 'card-row' },
      h('div', { class: 'act-name' }, restaurant.name),
      h('div', { class: 'count' }, destination?.name ?? '')),
    h('div', { class: 'muted' }, restaurantSummary(restaurant)));
  const cardLine = restaurant.card
    ? `Presentation and menu: ${restaurant.card.sections.reduce((n, sec) => n + sec.items.length, 0)} dishes · prices ${restaurant.card.showPrices ? 'shown' : 'hidden'}`
    : 'No presentation or menu yet';
  const cardButton = h('button', {
    class: 'btn btn--plain', type: 'button', disabled: Boolean(trip.archivedAt),
    onclick: () => editCard(ctx, trip, destination, restaurant),
  }, restaurant.card ? 'Edit presentation and menu' : '+ Presentation and menu');
  return h('div', { class: 'card' }, head, h('div', { class: 'muted' }, cardLine), cardButton);
}

// ---------- Sheets ----------

// The fields shared by "Add a restaurant" and "Edit a restaurant". mode picks one of two ways a
// restaurant's capacity works:
//   Flexible   a number of seats per seating, and the biggest table it can seat at once
//   Strict     the restaurant's actual tables, one size per table, and whether tables can be pushed together
// Seating times and table sizes are typed as a comma-separated list (e.g. "19:00, 21:00" or "4, 4, 6, 8")
// rather than one row per entry: simple to type, and a restaurant rarely has more than a couple of each.
// No "tables can be joined" option (removed 24 Sep 2026, the owner's call): a Strict booking always
// fits on exactly one table or becomes a Special request.
// A destination picker is included when adding (unlike Touring's activity form, which infers the
// destination from the screen it is opened on) since Dining's own list is flat, not
// destination-first. Not shown when editing: which destination a restaurant belongs to does not
// change here, same as an activity cannot be moved to another destination either.
function restaurantFields(trip, restaurant) {
  const destinationSelect = h('select', { class: 'text-input', 'aria-label': 'Destination' },
    trip.destinations.map((d) => h('option', { value: d.id }, d.name)));
  destinationSelect.value = restaurant?.destinationId ?? trip.destinations[0]?.id;

  const nameInput = h('input', { class: 'text-input', type: 'text', value: restaurant?.name ?? '', placeholder: 'Restaurant name', 'aria-label': 'Name', maxlength: '80' });
  const seatingsInput = h('input', {
    class: 'text-input', type: 'text', value: restaurant?.seatings.join(', ') ?? '', placeholder: 'Seating times, e.g. 19:00, 21:00', 'aria-label': 'Seating times',
  });
  const modeSelect = h('select', { class: 'text-input', 'aria-label': 'Capacity mode' },
    h('option', { value: 'flexible' }, 'Flexible: seats + max table size'),
    h('option', { value: 'strict' }, 'Strict: exact tables'));
  modeSelect.value = restaurant?.mode ?? 'flexible';

  const seatsPerSeatingInput = h('input', {
    class: 'text-input', type: 'number', min: '1', inputmode: 'numeric', value: restaurant?.seatsPerSeating ?? '', placeholder: 'Seats per seating', 'aria-label': 'Seats per seating',
  });
  const maxTableSizeInput = h('input', {
    class: 'text-input', type: 'number', min: '1', inputmode: 'numeric', value: restaurant?.maxTableSize ?? '', placeholder: 'Max table size', 'aria-label': 'Max table size',
  });
  const flexibleFields = h('div', {}, seatsPerSeatingInput, maxTableSizeInput);

  const tableSizesInput = h('input', {
    class: 'text-input', type: 'text', value: restaurant?.tables?.map((t) => t.size).join(', ') ?? '', placeholder: 'Table sizes, e.g. 4, 4, 6, 8', 'aria-label': 'Table sizes',
  });
  const strictFields = h('div', {}, tableSizesInput);

  const showMode = () => {
    flexibleFields.hidden = modeSelect.value !== 'flexible';
    strictFields.hidden = modeSelect.value !== 'strict';
  };
  showMode();
  modeSelect.addEventListener('change', showMode);

  const nodes = restaurant
    ? [nameInput, seatingsInput, modeSelect, flexibleFields, strictFields]
    : [destinationSelect, nameInput, seatingsInput, modeSelect, flexibleFields, strictFields];
  const buildChange = () => ({
    name: nameInput.value,
    seatings: seatingsInput.value.split(',').map((t) => t.trim()).filter(Boolean),
    mode: modeSelect.value,
    seatsPerSeating: seatsPerSeatingInput.value.trim() === '' ? null : Number(seatsPerSeatingInput.value),
    maxTableSize: maxTableSizeInput.value.trim() === '' ? null : Number(maxTableSizeInput.value),
    tableSizes: tableSizesInput.value.trim() === '' ? [] : tableSizesInput.value.split(',').map((t) => Number(t.trim())),
  });
  return { nameInput, nodes, buildChange, destinationSelect };
}

function addRestaurant(ctx, trip) {
  const { nameInput, nodes, buildChange, destinationSelect } = restaurantFields(trip, null);
  const confirm = h('button', {
    class: 'btn', type: 'button',
    onclick: () => save(ctx, trip.id, { type: 'add-restaurant', destinationId: destinationSelect.value, ...buildChange() }, `"${nameInput.value.trim()}" added`),
  }, 'Add');

  openSheet({
    eyebrow: 'Dining', title: 'Add a restaurant',
    subtitle: 'Seating times and table sizes are typed as a list, e.g. "19:00, 21:00".',
    body: [...nodes, confirm], cancelLabel: 'Cancel',
  });
}

function editRestaurant(ctx, trip, destination, restaurant) {
  const { nameInput, nodes, buildChange } = restaurantFields(trip, restaurant);
  const confirm = h('button', {
    class: 'btn', type: 'button',
    onclick: () => save(ctx, trip.id, { type: 'edit-restaurant', restaurantId: restaurant.id, ...buildChange() }, `"${nameInput.value.trim()}" updated`),
  }, 'Save');

  openSheet({
    eyebrow: destination?.name ?? 'Dining', title: `Edit "${restaurant.name}"`,
    subtitle: 'Seating times and table sizes are typed as a list, e.g. "19:00, 21:00".',
    body: [...nodes, confirm], cancelLabel: 'Cancel',
  });
}

// The restaurant's presentation (how it feels) and menu (rewritten the same way for every restaurant), shown to guests in their app.
// The menu is typed or pasted in one box: a line starting with # is a section, a dish is  name | description | price | tags.
// (Claude can turn an uploaded menu into exactly this text; see SPEC.md "Restaurant menus".)
function editCard(ctx, trip, destination, restaurant) {
  const card = restaurant.card;
  const text = (label, value, max, placeholder) => h('input', { class: 'text-input', type: 'text', value: value ?? '', maxlength: String(max), placeholder, 'aria-label': label });
  const area = (label, value, rows, placeholder) => h('textarea', { class: 'text-input', rows: String(rows), placeholder, 'aria-label': label }, value ?? '');
  const cuisine = text('Kind of food', card?.cuisine, 60, 'Kind of food, e.g. Modern Australian');
  const vibe = text('Atmosphere', card?.vibe, 80, 'Atmosphere, e.g. Relaxed, barefoot-friendly');
  const about = area('Description', card?.about, 3, 'A short description of the restaurant');
  const interior = area('Inside', card?.interior, 2, 'Inside: lighting, style, noise');
  const outdoor = area('Outside', card?.outdoor, 2, 'Outside: terrace, garden, view');
  const photos = area('Photos', (card?.photos ?? []).map((p) => (p.caption ? `${p.url} | ${p.caption}` : p.url)).join('\n'), 3, 'Photos: one web address (https://...) per line, then | and a caption');
  const menu = area('Menu', menuToText(card?.sections), 10, '# Shareables\nBurrata | Tomato, basil | 16 | vegetarian, to share\n# Mains\nBarramundi | Grilled, lemon butter | 38');
  const currency = text('Currency', card?.currency, 6, 'Currency, e.g. AUD');
  const prices = h('input', { type: 'checkbox', checked: card?.showPrices === true, 'aria-label': 'Show prices to guests' });
  const priceRow = h('label', { class: 'check-row' }, prices, ' Show prices to guests (off: prices are not even sent)');
  const buildCard = () => ({
    cuisine: cuisine.value, vibe: vibe.value, about: about.value, interior: interior.value, outdoor: outdoor.value,
    photos: photos.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [url, ...rest] = l.split('|'); return { url: url.trim(), caption: rest.join('|').trim() }; }),
    showPrices: prices.checked, currency: currency.value, sections: parseMenuText(menu.value),
  });
  const confirm = h('button', {
    class: 'btn', type: 'button',
    onclick: () => save(ctx, trip.id, { type: 'restaurant-card', restaurantId: restaurant.id, card: buildCard() }, `"${restaurant.name}" saved`),
  }, 'Save');
  openSheet({
    eyebrow: destination?.name ?? 'Dining', title: `${restaurant.name}: presentation and menu`,
    subtitle: `Menu: # starts a section; a dish is name | description | price | tags. Tags: ${MENU_TAGS.join(', ')}.`,
    body: [cuisine, vibe, about, interior, outdoor, photos, menu, currency, priceRow, confirm], cancelLabel: 'Cancel',
  });
}
