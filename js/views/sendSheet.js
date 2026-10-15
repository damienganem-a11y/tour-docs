// The "Send" button (owner's request, 15 Oct 2026): the phone's share icon (a square with an arrow leaving it) next to the sync light on the main screens.
// It asks what to send, Dining or Tours, without going to Settings, and the file goes STRAIGHT to the phone's share sheet as a PDF or Excel file (never
// through a viewer, never as a link). The documents themselves are the same as in Settings > Documents, and are kept there too.

import { h } from '../dom.js';
import { openSheet, closeSheet } from '../ui.js';
import { icon } from './icons.js';
import { choiceRow } from './move.js';
import { dinnerCountIn } from '../rules.js';
import { pickDestination, pickCardsEvening, pickReservationEvening, finalExport } from './settingsExports.js';

export function sendButton(ctx, trip) {
  return h('button', { class: 'send-btn', type: 'button', 'aria-label': 'Send a list or sheet', title: 'Send', onclick: () => sendSheet(ctx, trip) }, icon('share'));
}

function sendSheet(ctx, trip) {
  const hasRestaurants = trip.restaurants.length > 0;
  openSheet({
    eyebrow: 'Send', title: 'What do you want to send?',
    body: [
      hasRestaurants ? choiceRow({ title: 'Dining', detail: 'Reservation sheet, confirmation cards', onclick: () => diningSheet(ctx, trip) }) : null,
      choiceRow({ title: 'Tours', detail: 'Guest lists of a destination or half-day, the whole trip', onclick: () => toursSheet(ctx, trip) }),
    ],
    cancelLabel: 'Cancel',
  });
}

function diningSheet(ctx, trip) {
  const hasTables = trip.dinnerBookings.some((b) => dinnerCountIn(trip, b) > 0);
  openSheet({
    eyebrow: 'Send', title: 'Dining',
    body: [
      choiceRow({ title: 'Reservation sheet', detail: 'One evening, every restaurant, for the restaurants', onclick: () => { closeSheet(); pickReservationEvening(ctx, trip, true); } }),
      hasTables ? choiceRow({ title: 'Confirmation cards', detail: 'One card per travel party and table, for the guests', onclick: () => { closeSheet(); pickCardsEvening(ctx, trip, true); } }) : null,
    ],
    cancelLabel: 'Cancel',
  });
}

function toursSheet(ctx, trip) {
  openSheet({
    eyebrow: 'Send', title: 'Tours',
    body: [
      choiceRow({ title: 'A destination or half-day', detail: 'Who is on each tour', onclick: () => { closeSheet(); pickDestination(ctx, trip, true); } }),
      choiceRow({ title: 'The whole trip', detail: 'Summary page, every tour, every guest', onclick: () => { closeSheet(); finalExport(ctx, trip, true); } }),
    ],
    cancelLabel: 'Cancel',
  });
}
