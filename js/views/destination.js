// Use > "By destination": pick a destination, then a half-day, and see every activity with the
// guests on it and a count. Guests who are At leisure are a category of their own.
//
// Tap a card to open it: you see every name and the actions (Add guest, Cancel tour).
// Tap a name to move that guest. A guest who is in the tour by force (a move into a full tour) is shown in
// orange, first in the list; tapping that name shows who approved it and who added them.

import { h } from '../dom.js';
import { formatTime, formatWeekdayDate } from '../time.js';
import { byName, displayNames, whoIsWhere, capacityInfo } from '../rules.js';
import { pageHead } from './chrome.js';
import { startMove, startAddGuest, startCancelTour, showForcedInfo } from './move.js';
import { undoButton } from './undo.js';
import { forcedPlacements } from '../journal.js';

const PREVIEW = 4; // names shown on a closed card

// Cards the owner has opened. Kept here so a card stays open after a change redraws the screen.
const openCards = new Set();

// destinationId and slotId come from the address; if they are missing or wrong we start at the first ones.
export function destinationPage(ctx, trip, destinationId, slotId) {
  const destination = trip.destinations.find((d) => d.id === destinationId) ?? trip.destinations[0];
  const slots = trip.slots.filter((s) => s.destinationId === destination.id);
  const slot = slots.find((s) => s.id === slotId) ?? slots[0];
  const base = `#/trip/${trip.id}/use/destination`;

  // Strip 1: destinations. Strip 2: the half-days of the chosen destination.
  const destinationStrip = strip(trip.destinations.map((d) => ({
    label: d.name, href: `${base}/${d.id}`, active: d.id === destination.id,
  })));
  const slotStrip = strip(slots.map((s) => ({
    label: `Day ${s.day} ${s.half}`, href: `${base}/${destination.id}/${s.id}`, active: s === slot,
  })), true);

  if (!slot) {
    return h('div', {}, destinationStrip,
      pageHead({ eyebrow: 'By destination', title: destination.name }),
      h('p', { class: 'empty' }, 'This destination has no half-days yet.'));
  }

  const names = displayNames(trip.guests);
  const forced = forcedPlacements(ctx.journal(trip.id)); // who is in a tour by force, right now
  const { byActivity, leisure, attention } = whoIsWhere(trip, slot);
  const activities = trip.activities.filter((a) => a.slotId === slot.id);

  const cards = activities.map((activity) => {
    const guests = byActivity.get(activity.id);
    const count = capacityInfo(guests.length, activity.capacity);
    // Start time in the local time of the destination, then the meeting point.
    const detail = [activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : '', activity.meeting]
      .filter(Boolean).join(' · ');
    return guestCard(ctx, trip, slot, {
      key: `${slot.id}|${activity.id}`, title: activity.name, detail, guests, names,
      // A guest put here by force (a move into a full tour) is shown in orange; tapping shows who approved it.
      forcedOf: (g) => { const entry = forced.get(`${g.id}|${slot.id}`); return entry?.to.activityId === activity.id ? entry : undefined; },
      countText: activity.cancelled ? 'Cancelled' : count.text, bad: activity.cancelled || count.tone === 'bad',
      cancelled: activity.cancelled,
      actions: activity.cancelled ? [] : [
        { label: '+ Add guest', run: () => startAddGuest(ctx, trip, slot, activity) },
        { label: 'Cancel tour', run: () => startCancelTour(ctx, trip, slot, activity) },
      ],
    });
  });

  const leisureCard = guestCard(ctx, trip, slot, {
    key: `${slot.id}|leisure`, title: 'At leisure', detail: 'Not on any of our tours',
    countText: `${leisure.length} guests`, guests: leisure, names, soft: true, actions: [],
  });

  return h('div', {},
    destinationStrip,
    slotStrip,
    pageHead({
      eyebrow: 'By destination',
      title: destination.name,
      subtitle: `Day ${slot.day} · ${formatWeekdayDate(slot.date)} · ${slot.half} · ${destination.name} time`,
      action: undoButton(ctx, trip),
    }),
    cards,
    leisureCard,
    attention.length > 0 ? attentionCard(ctx, trip, slot, attention, names) : null
  );
}

// A row of tappable pills that scrolls sideways.
function strip(items, small = false) {
  const node = h('nav', { class: `strip${small ? ' strip--small' : ''}` },
    items.map((i) => h('a', { class: `strip-item${i.active ? ' is-active' : ''}`, href: i.href }, i.label)));
  // Once the strip is on screen, scroll it so the chosen pill is visible (12 destinations do not fit).
  requestAnimationFrame(() => {
    const pill = node.querySelector('.is-active');
    if (pill) node.scrollLeft = pill.offsetLeft - 20;
  });
  return node;
}

// A card with a title, a count and the guests as name pills.
// Tapping the top of the card opens it (all names, plus the actions); tapping a name moves that guest.
function guestCard(ctx, trip, slot, { key, title, detail, countText, bad = false, guests, names, forcedOf, cancelled = false, soft = false, actions }) {
  // Forced guests come first, so they are seen even on a closed card; then everybody by name.
  const isForced = (g) => Boolean(forcedOf?.(g));
  const sorted = [...guests].sort((a, b) => Number(isForced(b)) - Number(isForced(a)) || byName(a, b));
  const body = h('div', {});

  // Open or close the card (the "+4" pill does the same as tapping the top of the card).
  const toggle = () => {
    if (openCards.has(key)) openCards.delete(key); else openCards.add(key);
    head.setAttribute('aria-expanded', String(openCards.has(key)));
    fill();
  };

  const fill = () => {
    const open = openCards.has(key);
    const shown = open ? sorted : sorted.slice(0, PREVIEW);

    body.replaceChildren(
      ...(sorted.length === 0
        ? (cancelled ? [] : [h('p', { class: 'muted nobody' }, 'Nobody')])
        : [h('div', { class: 'chips' },
            ...shown.map((g) => {
              const entry = forcedOf?.(g);
              return h('button', {
                class: `chip${entry ? ' chip--forced' : ''}`, type: 'button',
                'aria-label': entry ? `${names.get(g.id)}, forced into this tour. Tap to see who approved it.` : null,
                onclick: () => (entry ? showForcedInfo(ctx, trip, g, slot, entry) : startMove(ctx, trip, g, slot)),
              }, names.get(g.id));
            }),
            !open && sorted.length > PREVIEW ? h('button', { class: 'chip chip--more', type: 'button', onclick: toggle }, `+${sorted.length - PREVIEW}`) : null)]),
      ...(open && actions.length > 0
        ? [h('div', { class: 'card-actions' }, actions.map((a) => h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: a.run }, a.label)))]
        : [])
    );
  };

  const head = h('button', { class: 'card-head', type: 'button', 'aria-expanded': String(openCards.has(key)), onclick: toggle },
    h('div', { class: 'card-row' },
      h('div', { class: 'act-name' }, title),
      h('div', { class: `count${bad ? ' count--bad' : ''}` }, countText)),
    detail ? h('div', { class: 'muted' }, detail) : null);

  fill();
  return h('div', { class: `card${soft ? ' card--soft' : ''}${cancelled ? ' card--cancelled' : ''}` }, head, body);
}

// Guests with no valid booking in this half-day. Never hidden: every guest is always counted somewhere.
// Tap a name to give that guest a proper place.
function attentionCard(ctx, trip, slot, attention, names) {
  return h('div', { class: 'card card--warn' },
    h('div', { class: 'act-name' }, `Needs a look (${attention.length})`),
    attention.map(({ guest, reason }) =>
      h('button', { class: 'line line--button', type: 'button', onclick: () => startMove(ctx, trip, guest, slot) },
        h('span', {}, names.get(guest.id)), h('span', {}, reason))));
}
