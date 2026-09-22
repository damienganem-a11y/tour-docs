// Settings > Guests (step 7d, owner only): a guest's own name, their travel party, and "Guest left the trip".
//
//   List screen:    every guest still on the trip, alphabetical, tap to open; guests who left are folded
//                    away under "N guests who left" (like a replaced destination's cancelled tours).
//   Detail screen:  Edit name, "Change travel party" (the one place a party change is made — see also
//                    Settings > Travel parties, which only shows them), and "Guest left the trip" /
//                    "Bring the guest back".
//
// "Guest left the trip" does not touch a single booking: the guest is simply left out of every day-to-day
// list and count from then on (see rules.js), and brought back exactly as they were, any time.
//
// Every change here goes through the one change function (changes.js), so it is in the Journal and Undo works.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { alphabetical, displayNames, partyLabel, plain, plural } from '../rules.js';
import { pageHead } from './chrome.js';
import { undoButton } from './undo.js';
import { notice, choiceRow } from './move.js';

// Whether the "guests who left" section is unfolded. Module-level like the cancelled-tours fold, so it
// survives a redraw; there is only ever one guest list, so a single flag (not a Set) is enough.
let leftSectionOpen = false;

// Saves one change; closes the sheet and redraws on success, shows the reason on failure.
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

export function guestsSettingsPage(ctx, trip, guestId) {
  const guest = trip.guests.find((g) => g.id === guestId);
  return guest ? detailPage(ctx, trip, guest) : listPage(ctx, trip);
}

function listPage(ctx, trip) {
  const names = displayNames(trip.guests);
  const inOrder = alphabetical(names);
  const active = trip.guests.filter((g) => !g.leftAt).sort(inOrder);
  const left = trip.guests.filter((g) => g.leftAt).sort(inOrder);

  const row = (g) => h('a', { class: 'row', href: `#/trip/${trip.id}/settings/guests/${g.id}` },
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, names.get(g.id)), h('div', { class: 'row-sub' }, partyLabel(trip, g, names))),
    h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›'));

  return h('div', {},
    pageHead({ back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' }, eyebrow: 'Settings', title: 'Guests', subtitle: `${active.length} on the trip` }),
    h('ul', { class: 'list' }, active.map((g) => h('li', {}, row(g)))),
    left.length > 0
      ? h('div', {},
          h('button', {
            class: 'btn btn--plain btn--small', type: 'button', style: 'margin-top: 12px;',
            onclick: () => { leftSectionOpen = !leftSectionOpen; ctx.refresh(); },
          }, `${leftSectionOpen ? '▾' : '▸'} ${plural(left.length, 'guest')} who left`),
          leftSectionOpen ? h('ul', { class: 'list' }, left.map((g) => h('li', {}, row(g)))) : null)
      : null);
}

function detailPage(ctx, trip, guest) {
  const names = displayNames(trip.guests);

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings/guests`, label: 'Guests' },
      eyebrow: 'Guest', title: names.get(guest.id), subtitle: partyLabel(trip, guest, names),
      action: undoButton(ctx, trip),
    }),
    guest.leftAt ? notice(`Left the trip on ${new Date(guest.leftAt).toLocaleString()}.`) : null,
    h('button', { class: 'btn btn--plain btn--small', type: 'button', onclick: () => editName(ctx, trip, guest) }, 'Edit name'),
    h('button', { class: 'btn btn--plain btn--small', type: 'button', onclick: () => changeParty(ctx, trip, guest) }, 'Change travel party'),
    h('button', {
      class: `btn btn--small ${guest.leftAt ? '' : 'btn--danger'}`, type: 'button', style: 'margin-top: 32px;',
      onclick: () => (guest.leftAt
        ? save(ctx, trip.id, { type: 'guest-return', guestId: guest.id }, `${names.get(guest.id)} is back on the trip`)
        : leftConfirm(ctx, trip, guest)),
    }, guest.leftAt ? 'Bring the guest back' : 'Guest left the trip'));
}

// ---------- Sheets ----------

function editName(ctx, trip, guest) {
  const firstInput = h('input', { class: 'text-input', type: 'text', value: guest.first, placeholder: 'First name', 'aria-label': 'First name', maxlength: '60' });
  const lastInput = h('input', { class: 'text-input', type: 'text', value: guest.last, placeholder: 'Last name', 'aria-label': 'Last name', maxlength: '60' });

  const confirm = h('button', {
    class: 'btn', type: 'button',
    onclick: () => save(ctx, trip.id, { type: 'edit-guest', guestId: guest.id, first: firstInput.value, last: lastInput.value }, 'Name updated'),
  }, 'Save');

  openSheet({
    eyebrow: 'Guest', title: 'Edit name',
    subtitle: 'The name shown on screen (like "John S.") is worked out from this automatically.',
    body: [firstInput, lastInput, confirm], cancelLabel: 'Cancel',
  });
}

// "Guest left the trip" is a real change (a rare emergency), so it gets its own plain-language warning,
// like Cancel tour or Replace this destination.
function leftConfirm(ctx, trip, guest) {
  const names = displayNames(trip.guests);
  const confirm = h('button', {
    class: 'btn btn--danger', type: 'button',
    onclick: () => save(ctx, trip.id, { type: 'guest-left', guestId: guest.id }, `${names.get(guest.id)} marked as having left the trip`),
  }, 'Guest left the trip');

  openSheet({
    eyebrow: 'Rare change', title: `${names.get(guest.id)} left the trip?`,
    body: [
      notice(`${names.get(guest.id)} will no longer show up on any day-to-day list or count. Their whole history stays in the Journal, and this can be undone any time with "Bring the guest back".`),
      confirm,
    ],
    cancelLabel: 'Keep them on the trip',
  });
}

// Pick another guest to join their travel party, or give this guest their own new one.
function changeParty(ctx, trip, guest) {
  const names = displayNames(trip.guests);
  const inOrder = alphabetical(names);
  const others = trip.guests.filter((g) => g.id !== guest.id).sort(inOrder);
  const list = h('div', {});

  function fill() {
    const words = plain(search.value).split(/\s+/).filter(Boolean);
    const shown = others.filter((g) => words.every((w) => plain(`${g.first} ${g.last}`).includes(w)));
    list.replaceChildren(...(shown.length === 0
      ? [h('p', { class: 'empty' }, 'No guest matches that search.')]
      : shown.map((g) => choiceRow({
          title: names.get(g.id), detail: partyLabel(trip, g, names), current: g.partyId === guest.partyId,
          onclick: () => save(ctx, trip.id, { type: 'join-party', guestId: guest.id, partyId: g.partyId }, `${names.get(guest.id)} joined the travel party`),
        }))));
  }

  const search = h('input', {
    class: 'text-input', type: 'search', placeholder: 'Search guests',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search guests',
    oninput: fill,
  });
  fill();

  const solo = h('button', {
    class: 'btn btn--plain', type: 'button',
    onclick: () => save(ctx, trip.id, { type: 'make-solo', guestId: guest.id }, `${names.get(guest.id)} now travels solo`),
  }, 'Give them their own travel party (solo)');

  openSheet({
    eyebrow: 'Travel party', title: `Change ${names.get(guest.id)}'s travel party`,
    subtitle: 'Join another guest’s party, or make them solo.',
    body: [solo, search, list], cancelLabel: 'Cancel',
  });
}
