// Settings > Explore maps (v0.145.0, owner's choice: a real map, visible offline, 5 Nov 2026). For each stop:
//   - where the ship is docked (or the hotel): paste a Google Maps or Apple Maps link, or the two numbers;
//   - "Back on board by" (optional);
//   - the team's picks (sights, cafés, shops...): a link or the numbers, then name, kind, price, hours and a tip;
//   - "Prepare the offline map": the phone fetches the street plan around the dock once (OpenStreetMap data) and saves it as a small file that every
//     guest's phone keeps, so the map works with no signal.
// Every change goes through the one change function (journaled, Undo). The guests see the map once the programmes are sent.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { pageHead } from './chrome.js';
import { notice } from './move.js';
import { undoButton } from './undo.js';
import { EXPLORE_UNDO_SCOPE } from '../journal.js';
import { newId } from '../ids.js';
import { PLACE_KINDS, kindOf, parseLocation, distanceMeters, distanceText, overpassQuery, compactStreets } from '../explore.js';

const emptyExplore = () => ({ dock: null, backBy: null, places: [], streets: null });

export function exploreListPage(ctx, trip) {
  const rows = [...trip.destinations].sort((a, b) => a.order - b.order).map((d) => {
    const ex = d.explore;
    const state = !ex ? 'Not set up' : [ex.dock ? 'Dock set' : 'No dock point', `${(ex.places ?? []).length} place${(ex.places ?? []).length === 1 ? '' : 's'}`, ex.streets ? 'offline map ready' : 'no offline map yet'].join(' · ');
    return h('a', { class: 'menu-row', href: `#/trip/${trip.id}/settings/explore/${d.id}` },
      h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, d.name), h('span', { class: 'menu-hint' }, state)), h('span', { class: 'row-chev' }, '›'));
  });
  return h('div', {},
    pageHead({ back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' }, eyebrow: 'Guest app', title: 'Explore maps', subtitle: 'A real map of each stop for the guests, with the team\'s picks, that works offline' }),
    notice('Guests see the map of a stop on their Today page while they are there: the ship (or hotel), your places with their hours and price, their own blue dot, and one tap to walk there. It works without signal once the offline map is prepared.'),
    h('div', { class: 'menu' }, rows));
}

export function exploreDestinationPage(ctx, trip, destinationId) {
  const destination = trip.destinations.find((d) => d.id === destinationId);
  if (!destination) return h('p', { class: 'empty' }, 'This destination is not in the trip.');
  const ex = structuredClone(destination.explore ?? emptyExplore());
  const locked = Boolean(trip.archivedAt) || ctx.roleFor(trip.id) === 'viewer';

  async function save(next, what) {
    const result = await applyChange(ctx, trip.id, { type: 'set-explore', destinationId, explore: next, what });
    if (result.ok) { closeSheet(); ctx.refresh(); showToast(what); return true; }
    showToast(result.error, true); return false;
  }

  // Where the ship is docked
  function dockSheet() {
    const link = h('input', { class: 'text-input', type: 'text', placeholder: 'Google Maps link, or 43.6777, 4.6309', value: ex.dock ? `${ex.dock.lat}, ${ex.dock.lng}` : '', 'aria-label': 'Where' });
    const label = h('select', { class: 'text-input', 'aria-label': 'What it is' }, ['The ship', 'The hotel', 'The bus', 'Meeting point'].map((l) => h('option', { value: l, selected: ex.dock?.label === l ? '' : null }, l)));
    const back = h('input', { class: 'text-input', type: 'time', value: ex.backBy ?? '', 'aria-label': 'Back on board by' });
    const found = h('div', { class: 'muted', role: 'status' });
    const check = () => { const p = parseLocation(link.value); found.textContent = p ? `✓ Found: ${p.lat}, ${p.lng}` : link.value.trim() ? 'Not found. In Google Maps, press and hold the spot: the two numbers appear at the top; copy them here. (A short "maps.app.goo.gl" link cannot be read.)' : ''; return p; };
    link.addEventListener('input', check); check();
    openSheet({
      eyebrow: destination.name, title: 'Where guests start from',
      subtitle: 'The anchor of the map, and where "Walk back" leads.',
      body: [h('label', { class: 'form-label' }, 'Place'), link, found, h('label', { class: 'form-label' }, 'It is'), label, h('label', { class: 'form-label' }, 'Back on board by (optional)'), back],
      footer: [h('button', { class: 'btn', type: 'button', onclick: () => {
        const p = check();
        if (!p) { showToast('Paste a full map link or the two numbers first.', true); return; }
        const moved = !ex.dock || distanceMeters(ex.dock, p) > 300;
        save({ ...ex, dock: { ...p, label: label.value }, backBy: back.value || null, streets: moved ? null : ex.streets }, `Map of ${destination.name}: ${label.value.toLowerCase()} placed`);
      } }, 'Save')],
      cancelLabel: 'Cancel',
    });
  }

  // One place (new or changed)
  function placeSheet(place) {
    const p = place ?? { id: newId(), name: '', kind: 'sight', lat: null, lng: null, price: '', hours: '', tip: '' };
    const link = h('input', { class: 'text-input', type: 'text', placeholder: 'Google Maps link, or 43.6777, 4.6309', value: p.lat !== null ? `${p.lat}, ${p.lng}` : '', 'aria-label': 'Where' });
    const found = h('div', { class: 'muted', role: 'status' });
    const check = () => {
      const at = parseLocation(link.value);
      found.textContent = at ? `✓ Found${ex.dock ? `: ${distanceText(distanceMeters(ex.dock, at))} from ${ex.dock.label.toLowerCase()}` : ''}` : link.value.trim() ? 'Not found: paste the full link, or press and hold the spot in Google Maps and copy the two numbers.' : '';
      return at;
    };
    link.addEventListener('input', check); check();
    const name = h('input', { class: 'text-input', type: 'text', maxlength: '60', value: p.name, 'aria-label': 'Name' });
    const kind = h('select', { class: 'text-input', 'aria-label': 'Kind' }, PLACE_KINDS.map((k) => h('option', { value: k.key, selected: k.key === p.kind ? '' : null }, `${k.emoji} ${k.label}`)));
    const price = h('input', { class: 'text-input', type: 'text', maxlength: '40', value: p.price, placeholder: '€9, Free...', 'aria-label': 'Price' });
    const hours = h('input', { class: 'text-input', type: 'text', maxlength: '80', value: p.hours, placeholder: '9:00 to 18:00, closed Mondays', 'aria-label': 'Hours' });
    const tip = h('textarea', { class: 'text-input', rows: '3', maxlength: '300', placeholder: 'Go up the tower for the view. Quieter after 15:00.', 'aria-label': 'Tip' });
    tip.value = p.tip;
    openSheet({
      eyebrow: destination.name, title: place ? place.name : 'Add a place',
      body: [h('label', { class: 'form-label' }, 'Where'), link, found, h('label', { class: 'form-label' }, 'Name'), name, h('label', { class: 'form-label' }, 'Kind'), kind,
        h('label', { class: 'form-label' }, 'Price'), price, h('label', { class: 'form-label' }, 'Opening hours'), hours, h('label', { class: 'form-label' }, 'The team\'s tip'), tip],
      footer: [
        h('button', { class: 'btn', type: 'button', onclick: () => {
          const at = check();
          if (!at) { showToast('Paste a map link or the two numbers first.', true); return; }
          if (!name.value.trim()) { showToast('Give the place a name.', true); return; }
          const next = { ...p, ...at, name: name.value.trim(), kind: kind.value, price: price.value.trim(), hours: hours.value.trim(), tip: tip.value.trim() };
          const places = place ? ex.places.map((x) => (x.id === p.id ? next : x)) : [...ex.places, next];
          save({ ...ex, places }, place ? `${next.name} changed on the map of ${destination.name}` : `${next.name} added to the map of ${destination.name}`);
        } }, 'Save'),
        place ? h('button', { class: 'btn btn--plain', type: 'button', onclick: () => save({ ...ex, places: ex.places.filter((x) => x.id !== p.id) }, `${p.name} removed from the map of ${destination.name}`) }, 'Remove this place') : null,
      ].filter(Boolean),
      cancelLabel: 'Cancel',
    });
  }

  const move = (i, step) => {
    const places = [...ex.places]; const j = i + step;
    if (j < 0 || j >= places.length) return;
    [places[i], places[j]] = [places[j], places[i]];
    save({ ...ex, places }, `Order changed on the map of ${destination.name}`);
  };

  // The offline street plan: fetched once from OpenStreetMap's data service (Overpass), made small, saved as a public file.
  let preparing = false;
  async function prepareOffline(button) {
    if (preparing || !ex.dock) return;
    preparing = true; button.disabled = true; button.textContent = 'Fetching the streets… (up to a minute)';
    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: overpassQuery(ex.dock) }) });
      if (!response.ok) throw new Error(`The map service answered ${response.status}. Try again in a few minutes.`);
      const streets = compactStreets(await response.json(), { lat: ex.dock.lat, lng: ex.dock.lng });
      const lines = streets.major.length + streets.minor.length + streets.paths.length;
      if (lines < 5) throw new Error('Almost no streets were found around this point: is the dock point right?');
      const text = JSON.stringify(streets);
      button.textContent = 'Saving it…';
      const path = await ctx.uploadStreets(trip.id, destinationId, streets);
      await save({ ...ex, streets: { path, at: new Date().toISOString(), size: text.length } }, `Offline map of ${destination.name} ready (${Math.round(text.length / 1024)} KB)`);
    } catch (error) {
      showToast(error?.message?.startsWith('The ') || error?.message?.startsWith('Almost') ? error.message : 'Could not prepare it. Are you online? (Settings > Check this phone if it keeps failing.)', true);
      button.disabled = false; button.textContent = 'Prepare the offline map';
    }
    preparing = false;
  }

  const offlineButton = h('button', { class: `btn${ex.streets ? ' btn--plain' : ''}`, type: 'button', disabled: locked || !ex.dock, onclick: (e) => prepareOffline(e.currentTarget) }, ex.streets ? 'Prepare it again' : 'Prepare the offline map');
  return h('div', {},
    pageHead({ back: { href: `#/trip/${trip.id}/settings/explore`, label: 'Explore maps' }, eyebrow: 'Explore map', title: destination.name, subtitle: 'What guests see on the map of this stop', action: undoButton(ctx, trip, { scope: EXPLORE_UNDO_SCOPE }) }),
    h('div', { class: 'card' },
      h('div', { class: 'act-name' }, ex.dock ? `${ex.dock.label}` : 'Where guests start from'),
      h('div', { class: 'muted' }, ex.dock ? `${ex.dock.lat}, ${ex.dock.lng}${ex.backBy ? ` · back on board by ${ex.backBy}` : ''}` : 'Not set yet: the ship\'s berth, or the hotel.'),
      h('div', { class: 'card-actions' }, h('button', { class: 'btn btn--small', type: 'button', disabled: locked, onclick: dockSheet }, ex.dock ? 'Change' : 'Set it'))),
    h('div', { class: 'card' },
      h('div', { class: 'act-name' }, 'Offline map'),
      h('div', { class: 'muted' }, !ex.dock ? 'Set where guests start from first.'
        : ex.streets ? `Ready: the streets about 1.5 km around (${Math.round((ex.streets.size ?? 0) / 1024)} KB, ${new Date(ex.streets.at).toLocaleDateString()}). Guests' phones keep it, so the map works with no signal.`
        : 'Not prepared yet: without it, the streets only show with signal (the pins, the blue dot and the distances always work).'),
      h('div', { class: 'card-actions' }, offlineButton),
      h('div', { class: 'muted small-print' }, 'Street data © OpenStreetMap contributors.')),
    h('h2', { class: 'section-title' }, `Places (${ex.places.length})`),
    ex.places.length === 0 ? h('p', { class: 'empty' }, 'No place yet. Add the sights, cafés, shops and markets the team recommends.') : null,
    ...ex.places.map((p, i) => h('div', { class: 'card' },
      h('div', { class: 'card-row' }, h('div', { class: 'act-name' }, `${i + 1}. ${kindOf(p.kind).emoji} ${p.name}`), ex.dock ? h('div', { class: 'muted' }, distanceText(distanceMeters(ex.dock, p))) : null),
      h('div', { class: 'muted' }, [p.price, p.hours].filter(Boolean).join(' · ')),
      p.tip ? h('div', { class: 'muted' }, p.tip) : null,
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn--small btn--plain', type: 'button', disabled: locked, onclick: () => placeSheet(p) }, 'Change'),
        h('button', { class: 'btn btn--small btn--plain', type: 'button', disabled: locked || i === 0, 'aria-label': 'Move up', onclick: () => move(i, -1) }, '↑'),
        h('button', { class: 'btn btn--small btn--plain', type: 'button', disabled: locked || i === ex.places.length - 1, 'aria-label': 'Move down', onclick: () => move(i, 1) }, '↓')))),
    h('button', { class: 'btn', type: 'button', disabled: locked || ex.places.length >= 40, onclick: () => placeSheet(null) }, '+ Add a place'),
    h('p', { class: 'muted' }, 'Guests get the map with their next programme update (Settings > Guest links > Send programmes now).'));
}
