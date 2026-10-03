// Use > "Touring" (the bottom tab; internal route name is still "destination" — see trip.js): pick
// a destination, then a half-day, and see every activity with the guests on it and a count. Guests
// who are At leisure are a category of their own.
//
// Tap a card to open it: you see every name and the actions (Add guest, Cancel tour).
// Tap a name to move that guest. A guest who is in the tour by force (a move into a full tour) is shown in
// orange, first in the list; tapping that name shows who approved it and who added them.

import { h } from '../dom.js';
import { formatTime, formatWeekdayDate } from '../time.js';
import { alphabetical, displayNames, whoIsWhere, capacityInfo, countIn, slotLabel } from '../rules.js';
import { pageHead, accentTitle, destinationMenu, destinationSub } from './chrome.js';
import { startMove, startAddGuest, startCancelTour, showForcedInfo, proposePromotion } from './move.js';
import { undoButton } from './undo.js';
import { forcedPlacements, waitlistOrder, USE_UNDO_SCOPE } from '../journal.js';
import { applyChange } from '../changes.js';
import { findRollCall } from '../rollcall.js';
import { showToast, openSheet } from '../ui.js';
import { reopenRollCall } from './rollcall.js';


// Cards the owner has opened. Kept here so a card stays open after a change redraws the screen.

// destinationId and slotId come from the address; if they are missing or wrong we start at the first ones.
export function destinationPage(ctx, trip, destinationId, slotId) {
  const destination = trip.destinations.find((d) => d.id === destinationId) ?? trip.destinations[0];
  const slots = trip.slots.filter((s) => s.destinationId === destination.id);
  const slot = slots.find((s) => s.id === slotId) ?? slots[0];
  const base = `#/trip/${trip.id}/use/destination`;

  // Strip 1: destinations. Strip 2: the half-days of the chosen destination.
  const destinationStrip = destinationMenu(trip.destinations.map((d) => ({
    label: d.name, sub: destinationSub(trip, d), href: `${base}/${d.id}`, active: d.id === destination.id,
  })));
  const slotStrip = strip(slots.map((s) => ({
    label: `Day ${s.day} ${s.half}`, href: `${base}/${destination.id}/${s.id}`, active: s === slot,
  })), true);

  if (!slot) {
    return h('div', {}, destinationStrip,
      pageHead({ eyebrow: 'Touring', title: accentTitle(destination.name) }),
      h('p', { class: 'empty' }, 'This destination has no half-days yet.'));
  }

  const names = displayNames(trip.guests);
  const forced = forcedPlacements(trip, ctx.journal(trip.id)); // who is in a tour by force, right now
  const { byActivity, leisure, attention } = whoIsWhere(trip, slot);
  const activities = trip.activities.filter((a) => a.slotId === slot.id);

  const cards = activities.flatMap((activity) => {
    const guests = byActivity.get(activity.id);
    const count = capacityInfo(guests.length, activity.capacity);
    // Start time in the local time of the destination, then the meeting point.
    const detail = [activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : '', activity.meeting]
      .filter(Boolean).join(' · ');
    // A cancelled tour's waitlist was already swept to leisure when it was cancelled (changes.js), so
    // there is never anything to show here for one.
    const waiting = activity.cancelled ? [] : waitlistOrder(trip, ctx.journal(trip.id), activity);
    return [guestCard(ctx, trip, slot, {
      key: `${slot.id}|${activity.id}`, title: activity.name, detail, guests, names,
      // A guest put here by force (a move into a full tour) is shown in orange; tapping shows who approved it.
      forcedOf: (g) => { const entry = forced.get(`${g.id}|${slot.id}`); return entry?.to.activityId === activity.id ? entry : undefined; },
      countText: activity.cancelled ? 'Cancelled' : count.text, bad: activity.cancelled || count.tone === 'bad',
      cancelled: activity.cancelled,
      actions: activity.cancelled ? [] : [
        ...rollCallActions(ctx, trip, activity),
        ...(trip.archivedAt ? [] : [
          { label: '+ Add guest', run: () => startAddGuest(ctx, trip, slot, activity) },
          { label: 'Cancel tour', run: () => startCancelTour(ctx, trip, slot, activity) },
        ]),
      ],
      // Part of this same tour's card (not a card of its own — it is a queue for THIS tour, not a
      // second tour), waiting.length > 0 checked by guestCard itself.
      waitlist: { activity, waiting },
    })];
  });

  const leisureCard = guestCard(ctx, trip, slot, {
    key: `${slot.id}|leisure`, title: 'At leisure', detail: 'Not on any of our tours',
    countText: `${leisure.length} guests`, guests: leisure, names, soft: true, actions: [],
  });

  return h('div', {},
    destinationStrip,
    slotStrip,
    pageHead({
      eyebrow: 'Touring',
      title: accentTitle(destination.name),
      // The destination is the title right above and the day/half is already highlighted in the
      // strip above that, so the only thing worth repeating here is the calendar date — small, and
      // tucked under the title (tightSubtitle) rather than spanning full width below the row, so it
      // never sits lower than the compact Undo button beside it.
      subtitle: h('span', { class: 'subtitle-note' }, formatWeekdayDate(slot.date)),
      tightSubtitle: true,
      action: undoButton(ctx, trip, { scope: USE_UNDO_SCOPE }),
    }),
    cards,
    leisureCard,
    attention.length > 0 ? attentionCard(ctx, trip, slot, attention, names) : null
  );
}

// The roll call buttons of an activity card: start the roll call the first time, then open it. Once it has ended:
// look at it, or re-open it (the guests End roll call moved to At leisure come back on the tour).
// An archived trip has no roll call: a roll call already started can only be looked at (read-only), and
// there is no way to start, continue or re-open one.
function rollCallActions(ctx, trip, activity) {
  const open = () => ctx.go(`#/trip/${trip.id}/rollcall/${activity.id}`);
  const rollCall = findRollCall(trip, activity.id);
  if (trip.archivedAt) return rollCall ? [{ label: 'View roll call', run: open }] : [];
  if (rollCall?.endedAt) {
    return [
      { label: 'Re-open roll call', primary: true, run: () => reopenRollCall(ctx, trip.id, activity) },
      { label: 'View roll call', run: open },
    ];
  }
  if (rollCall) return [{ label: 'Continue roll call', primary: true, run: open }];
  return [{
    label: 'Start roll call', primary: true,
    run: async () => {
      const result = await applyChange(ctx, trip.id, { type: 'rollcall-start', activityId: activity.id });
      if (result.ok) open(); else showToast(result.error, true);
    },
  }];
}

// A row of tappable pills that scrolls sideways.
function strip(items, small = false) {
  const node = h('nav', { class: `strip${small ? ' strip--small' : ''}` },
    items.map((i) => h('a', { class: `strip-item${i.active ? ' is-active' : ''}`, href: i.href }, i.label)));
  requestAnimationFrame(() => {
    const pill = node.querySelector('.is-active');
    if (pill) node.scrollLeft = pill.offsetLeft - 20;
  });
  return node;
}

// A card with a title, the time and place, and how full it is. Tapping it opens a sheet with the guests as name pills (tap a name to move that
// guest), the waiting list and the actions (roll call, add a guest, cancel).
// waitlist (optional): { activity, waiting } — who is waiting for a seat on THIS tour. Shown inside
// this same card, set off by a divider, never as a card of its own: it is this tour's own queue, not
// a second tour, and a separate card next to it reads as exactly that at a glance (the owner's own
// feedback, 25 Sep 2026).
function guestCard(ctx, trip, slot, { key, title, detail, countText, bad = false, guests, names, forcedOf, cancelled = false, soft = false, actions, waitlist }) {
  // Alphabetical. Guests who are here by force (orange) come first as a group, so they are seen first in the list.
  const isForced = (g) => Boolean(forcedOf?.(g));
  const inOrder = alphabetical(names);
  const sorted = [...guests].sort((a, b) => Number(isForced(b)) - Number(isForced(a)) || inOrder(a, b));

  // What opens when the card is tapped (owner's request, 3 Oct 2026: the card itself only says name, time, place and how full it is):
  // everybody on the tour, the waiting list, and the actions (add a guest, roll call, cancel).
  const openDetails = () => {
    const count = h('div', { class: `count${bad ? ' count--bad' : ''}` }, countText);
    openSheet({
      eyebrow: slotLabel(trip, slot), title, subtitle: detail || null, titleBadge: count, cancelLabel: 'Close',
      body: [
        sorted.length === 0
          ? (cancelled ? null : h('p', { class: 'muted nobody' }, 'Nobody'))
          : h('div', { class: 'chips' }, sorted.map((g) => {
              const entry = forcedOf?.(g);
              return h('button', {
                class: `chip${entry ? ' chip--forced' : ''}`, type: 'button',
                disabled: Boolean(trip.archivedAt),
                'aria-label': entry ? `${names.get(g.id)}, forced into this tour. Tap to see who approved it.` : null,
                onclick: () => (entry ? showForcedInfo(ctx, trip, g, slot, entry) : startMove(ctx, trip, g, slot)),
              }, names.get(g.id));
            })),
        waitlist && waitlist.waiting.length > 0 ? waitlistSection(ctx, trip, slot, waitlist, names) : null,
        actions.length > 0
          ? h('div', { class: 'card-actions' }, actions.map((a) => h('button', { class: `btn btn--small${a.primary ? '' : ' btn--plain'}`, type: 'button', onclick: a.run }, a.label)))
          : null,
      ],
    });
  };

  const head = h('button', { class: 'card-head', type: 'button', onclick: openDetails },
    h('div', { class: 'card-row' },
      h('div', { class: 'act-name' }, title),
      h('div', { class: `count${bad ? ' count--bad' : ''}` }, countText)),
    detail ? h('div', { class: 'muted' }, detail) : null,
    // A tour with someone in it by force says so on the closed card, so it is not missed.
    sorted.some(isForced) ? h('div', { class: 'forced-note' }, 'Someone is here by force') : null);

  return h('div', { class: `card${soft ? ' card--soft' : ''}${cancelled ? ' card--cancelled' : ''}` }, head);
}

// Who is waiting for a full tour, in the order they joined, rendered INSIDE that tour's own card
// (see guestCard above — this is a section of it, not a card of its own). Numbered so the queue order
// is plain to see; tapping a name opens the ordinary Move sheet (they can be moved elsewhere, or their
// travel party seen, like any other guest). Once there is room, the first name in line gets a one-tap
// proposal to promote them — never automatic (no way yet to tell a real guest on the ground they've
// been added): the owner always confirms, through the ordinary move/force-confirm flow.
function waitlistSection(ctx, trip, slot, { activity, waiting }, names) {
  const hasRoom = activity.capacity === null || countIn(trip, activity) < activity.capacity;
  const first = waiting[0];
  return h('div', { class: 'waitlist-section' },
    h('div', { class: 'waitlist-heading' }, `Waitlist (${waiting.length})`),
    h('div', { class: 'chips' },
      waiting.map((guest, i) => h('button', {
        class: 'chip', type: 'button', disabled: Boolean(trip.archivedAt),
        onclick: () => startMove(ctx, trip, guest, slot),
      }, `${i + 1}. ${names.get(guest.id)}`))),
    hasRoom && !trip.archivedAt
      ? h('div', { class: 'card-actions' },
          h('button', {
            class: 'btn btn--small', type: 'button',
            onclick: () => proposePromotion(ctx, trip, first, slot, activity),
          }, `Promote ${names.get(first.id)}`))
      : null);
}

// Guests with no valid booking in this half-day. Never hidden: every guest is always counted somewhere.
// Tap a name to give that guest a proper place.
function attentionCard(ctx, trip, slot, attention, names) {
  return h('div', { class: 'card card--warn' },
    h('div', { class: 'act-name' }, `Needs a look (${attention.length})`),
    [...attention].sort((a, b) => alphabetical(names)(a.guest, b.guest)).map(({ guest, reason }) =>
      h('button', {
        class: 'line line--button', type: 'button', disabled: Boolean(trip.archivedAt),
        onclick: () => startMove(ctx, trip, guest, slot),
      }, h('span', {}, names.get(guest.id)), h('span', {}, reason))));
}
