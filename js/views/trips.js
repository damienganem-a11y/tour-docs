// The Trips screen: the trips on this phone, and the buttons to load one from a file.

import { h } from '../dom.js';
import { buildTrip } from '../loader.js';
import { tripDates } from '../time.js';
import { APP_VERSION } from '../version.js';
import { pageHead } from './chrome.js';

const SAMPLE_URL = './data/tour_docs_sample_trip_ZX-01.json';

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

  // Newest first, so a trip you just loaded is at the top.
  const trips = [...ctx.trips].sort((a, b) => b.loadedAt.localeCompare(a.loadedAt));
  const loadedOn = (trip) =>
    new Date(trip.loadedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const list = trips.length === 0
    ? h('div', { class: 'card' },
        h('h2', {}, 'No trip on this phone yet'),
        h('p', { class: 'muted' }, 'Load a trip to get started. It is saved on the phone and works without internet.'))
    : trips.map((trip) =>
        h('a', { class: 'card card--link', href: `#/trip/${trip.id}/use/destination` },
          h('div', { class: 'card-title' }, trip.name),
          h('div', { class: 'muted' }, tripDates(trip.start, trip.days)),
          h('div', { class: 'muted' }, `${trip.destinations.length} destinations · ${trip.guests.length} guests · loaded ${loadedOn(trip)}`)
        ));

  return {
    node: h('div', { class: 'screen' },
      pageHead({ eyebrow: 'Tour Docs', title: 'Your trips', subtitle: `Hello ${ctx.owner.name}` }),
      list,
      h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Load a trip file (.json)'),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: loadSample }, 'Load the sample trip'),
      fileInput,
      message,
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
