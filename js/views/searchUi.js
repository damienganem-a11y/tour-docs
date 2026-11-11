// The "Search everything" screen (v0.153.0): a full page with one box, results as you type, grouped (Guests with their face, Tours, Restaurants,
// Stops, pages of the app). A tap goes there. The rules are in search.js.

import { h } from '../dom.js';
import { openFullScreen, closeFullScreen } from '../ui.js';
import { putIn } from '../put.js';
import { searchTrip } from '../search.js';
import { face } from './faceUi.js';
import { icon } from './icons.js';

// The pages of the app a person may look for by name (only the ones they can open).
function pagesFor(ctx, trip, sections) {
  const role = ctx.roleFor(trip.id);
  const pages = [
    { title: 'Allergies & diets', detail: 'Every guest with a need, with their photo', href: `#/trip/${trip.id}/use/dietary` },
    { title: 'Messages', detail: 'Guests and team', href: `#/trip/${trip.id}/use/messages` },
  ];
  if (role === 'viewer') return pages;
  for (const section of sections.filter((x) => !x.hidden || x.key === 'advanced')) {
    for (const item of section.items) {
      if (item.preview || (item.ownerOnly && role !== 'owner') || (ctx.simpleFor(trip.id) && !['requests', 'exports', 'warnings', 'check', 'notifications', 'appearance'].includes(item.page))) continue;
      pages.push({ title: item.label, detail: item.hint, href: `#/trip/${trip.id}/settings/${item.page}` });
    }
  }
  return pages;
}

export function openSearch(ctx, trip, sections = []) {
  const pages = pagesFor(ctx, trip, sections);
  const results = h('div', { class: 'search-results', 'aria-live': 'polite' });
  const go = (href) => { closeFullScreen(); ctx.go(href); };
  const input = h('input', { class: 'text-input search-input', type: 'search', placeholder: 'A guest, a tour, a restaurant, a stop…', 'aria-label': 'Search everything', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const draw = () => {
    const q = input.value;
    if (!q.trim()) { putIn(results, h('p', { class: 'muted' }, 'Type a few letters: "ann", "machu", "salsa", "notif"…')); return; }
    const groups = searchTrip(trip, q, { pages });
    putIn(results, ...(groups.length === 0 ? [h('p', { class: 'empty' }, 'Nothing found. Check the spelling, or type fewer letters.')]
      : groups.map((g) => h('section', { class: 'search-group' },
          h('h3', { class: 'section-title' }, g.group),
          h('div', { class: 'menu' }, g.items.map((item) => h('button', { class: 'menu-row search-row', type: 'button', onclick: () => go(item.href) },
            item.guest ? face(item.guest, 40) : null,
            h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, item.title), item.detail ? h('span', { class: 'menu-hint' }, item.detail) : null),
            h('span', { class: 'menu-side' }, h('span', { class: 'row-chev' }, '›'))))),
          g.more ? h('p', { class: 'muted' }, `And ${g.more} more: type more letters.`) : null))));
  };
  input.addEventListener('input', draw);
  draw();
  openFullScreen({ eyebrow: trip.ref || trip.name, title: 'Search', body: [
    h('div', { class: 'search-bar' }, input, h('button', { class: 'btn btn--plain search-close', type: 'button', onclick: closeFullScreen }, 'Close')),
    results] });
  setTimeout(() => input.focus(), 50);
}

// The search box at the top of Today: it looks like a box, and opens the search page.
export function searchLauncher(ctx, trip, sections) {
  return h('button', { class: 'search-launch', type: 'button', onclick: () => openSearch(ctx, trip, sections) },
    icon('search'), h('span', {}, 'Search a guest, a tour, a restaurant…'));
}
