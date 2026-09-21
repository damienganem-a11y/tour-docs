// Use > "By destination": pick a destination, then a half-day, and see every activity with the
// guests on it and a count. Guests who are At leisure are a category of their own.
// (Changing a booking comes in step 3; for now this screen only shows.)

import { h } from '../dom.js';
import { formatTime, formatWeekdayDate } from '../time.js';
import { byName, displayNames, whoIsWhere, capacityInfo } from '../rules.js';
import { pageHead } from './chrome.js';

const PREVIEW = 4; // names shown on a closed card; tap the card to see everybody

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
  const { byActivity, leisure, attention } = whoIsWhere(trip, slot);
  const activities = trip.activities.filter((a) => a.slotId === slot.id);

  const cards = activities.map((activity) => {
    const guests = byActivity.get(activity.id);
    const count = capacityInfo(guests.length, activity.capacity);
    // Start time in the local time of the destination, then the meeting point.
    const detail = [activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : '', activity.meeting]
      .filter(Boolean).join(' · ');
    return guestCard({ title: activity.name, detail, countText: count.text, bad: count.tone === 'bad', guests, names });
  });

  const leisureCard = guestCard({
    title: 'At leisure', detail: 'Not on any of our tours', countText: `${leisure.length}`, guests: leisure, names, soft: true,
  });

  return h('div', {},
    destinationStrip,
    slotStrip,
    pageHead({
      eyebrow: 'By destination',
      title: destination.name,
      subtitle: `Day ${slot.day} · ${formatWeekdayDate(slot.date)} · ${slot.half} · ${destination.name} time`,
    }),
    cards,
    leisureCard,
    attention.length > 0 ? attentionCard(attention, names) : null
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

// A card with a title, a count and the guests as small name pills. Tap it to see all the names.
function guestCard({ title, detail, countText, bad = false, guests, names, soft = false }) {
  let open = false;
  const sorted = [...guests].sort(byName);
  const pills = h('div', { class: 'chips' });

  const fill = () => {
    const shown = open ? sorted : sorted.slice(0, PREVIEW);
    const more = !open && sorted.length > PREVIEW ? [h('span', { class: 'chip chip--more' }, `+${sorted.length - PREVIEW}`)] : [];
    pills.replaceChildren(
      ...(sorted.length === 0 ? [h('span', { class: 'muted' }, 'Nobody')] : shown.map((g) => h('span', { class: 'chip' }, names.get(g.id)))),
      ...more
    );
  };
  fill();

  return h('button', {
    class: `card card--tap${soft ? ' card--soft' : ''}`, type: 'button', 'aria-expanded': 'false',
    onclick: (event) => {
      open = !open;
      event.currentTarget.setAttribute('aria-expanded', String(open));
      fill();
    },
  },
    h('div', { class: 'card-row' },
      h('div', { class: 'act-name' }, title),
      h('div', { class: `count${bad ? ' count--bad' : ''}` }, soft ? `${countText} guests` : countText)),
    detail ? h('div', { class: 'muted' }, detail) : null,
    pills
  );
}

// Guests with no valid booking in this half-day. Never hidden: every guest is always counted somewhere.
function attentionCard(attention, names) {
  return h('div', { class: 'card card--warn' },
    h('div', { class: 'act-name' }, `Needs a look (${attention.length})`),
    attention.map(({ guest, reason }) => h('div', { class: 'line' }, h('span', {}, names.get(guest.id)), h('span', {}, reason)))
  );
}
