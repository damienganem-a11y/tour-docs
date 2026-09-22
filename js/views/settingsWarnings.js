// Settings > Warnings (SPEC.md, "7. Warnings screen"): everything across the whole trip that needs
// a human look — overbooked activities, guests with nothing chosen yet, and guests whose sign-up
// named an activity that matches nothing (a typo in the imported file). It only shows: tap a row to
// go straight to that half-day, where the usual tools (tap a guest, Cancel tour...) fix it.

import { h } from '../dom.js';
import { pageHead } from './chrome.js';
import { tripWarnings, displayNames } from '../rules.js';
import { formatTime, formatWeekdayDate } from '../time.js';

export function warningsSettingsPage(ctx, trip) {
  const { overbooked, blank, unknown } = tripWarnings(trip);
  const names = displayNames(trip.guests);
  const total = overbooked.length + blank.length + unknown.length;

  const sections = [
    { title: 'Overbooked activities', items: overbooked, row: overbookedRow },
    { title: 'Nothing chosen yet', items: blank, row: (trip_, item) => guestRow(trip_, item, names) },
    { title: 'Unknown activity names', items: unknown, row: (trip_, item) => guestRow(trip_, item, names) },
  ].filter((s) => s.items.length > 0);

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
      eyebrow: 'Warnings',
      title: 'Warnings',
      subtitle: total === 0 ? 'Nothing to warn about — everything looks good.' : `${total} thing${total === 1 ? '' : 's'} to look at.`,
    }),
    sections.map((section) => h('div', {},
      h('h3', { class: 'section-title' }, `${section.title} (${section.items.length})`),
      h('ul', { class: 'list' }, section.items.map((item) => section.row(trip, item))))));
}

function slotSub(trip, destination, slot) {
  return `${destination.name} · Day ${slot.day} · ${formatWeekdayDate(slot.date)} · ${slot.half}`;
}

function warningRow(trip, { slot, destination }, title, sub) {
  return h('li', {},
    h('a', { class: 'row', href: `#/trip/${trip.id}/use/destination/${destination.id}/${slot.id}` },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, title),
        h('div', { class: 'row-sub' }, sub)),
      h('span', { class: 'row-chev', 'aria-hidden': 'true' }, '›')));
}

function overbookedRow(trip, item) {
  const { activity, slot, destination, count } = item;
  const time = activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : '';
  const title = `${activity.name} — ${count} / ${activity.capacity} (over by ${count - activity.capacity})`;
  return warningRow(trip, item, title, [slotSub(trip, destination, slot), time].filter(Boolean).join(' · '));
}

function guestRow(trip, item, names) {
  const { guest, slot, destination, reason } = item;
  return warningRow(trip, item, `${names.get(guest.id)} — ${reason}`, slotSub(trip, destination, slot));
}
