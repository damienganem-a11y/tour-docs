// Settings > This phone (owner's request, 18 Oct 2026): what belongs to THIS phone, not to the trip: Check this phone, notifications, and the look (light / dark).

import { h } from '../dom.js';
import { pageHead } from './chrome.js';
import { notificationsCard } from './settingsRequests.js';
import { THEMES, getTheme, setTheme, TEXT_SIZES, getTextSize, setTextSize, ACCENTS, getAccent, setAccent } from '../theme.js';
import { putIn } from '../put.js';

const back = (trip) => ({ href: `#/trip/${trip.id}/settings/section/phone`, label: 'This phone' });

export function notificationsPage(ctx, trip) {
  return h('div', {},
    pageHead({ back: back(trip), eyebrow: 'This phone', title: 'Notifications', subtitle: 'Told at once when a guest or a colleague writes or asks.' }),
    notificationsCard(ctx));
}

export function appearancePage(ctx, trip) {
  const looks = h('div', { class: 'switch', role: 'group', 'aria-label': 'Appearance' });
  const draw = () => putIn(looks, ...THEMES.map(([id, label]) => h('button', {
    class: `switch-item${getTheme() === id ? ' is-active' : ''}`, type: 'button', 'aria-pressed': String(getTheme() === id),
    onclick: () => { setTheme(id); draw(); },
  }, label)));
  draw();
  // The size of the text: the sample line below changes at once, so the choice is made by eye.
  const sizes = h('div', { class: 'switch', role: 'group', 'aria-label': 'Size of the text' });
  const drawSizes = () => putIn(sizes, ...TEXT_SIZES.map(([id, label]) => h('button', {
    class: `switch-item${getTextSize() === id ? ' is-active' : ''}`, type: 'button', 'aria-pressed': String(getTextSize() === id),
    onclick: () => { setTextSize(id); drawSizes(); },
  }, label)));
  drawSizes();
  const accents = h('div', { class: 'switch', role: 'group', 'aria-label': 'Accent colour' });
  const drawAccents = () => putIn(accents, ...ACCENTS.map(([id, label]) => h('button', {
    class: `switch-item${getAccent() === id ? ' is-active' : ''}`, type: 'button', 'aria-pressed': String(getAccent() === id),
    onclick: () => { setAccent(id); drawAccents(); },
  }, label)));
  drawAccents();
  return h('div', {},
    pageHead({ back: back(trip), eyebrow: 'This phone', title: 'Appearance', subtitle: 'Only this phone changes.' }),
    h('h3', { class: 'section-title' }, 'Size of the text'),
    sizes,
    h('p', { class: 'muted' }, 'Everything grows together: the words, the buttons and the lists.'),
    h('h3', { class: 'section-title' }, 'Light or dark'),
    looks,
    h('p', { class: 'muted' }, 'Automatic follows the phone.'),
    h('h3', { class: 'section-title' }, 'Accent colour'),
    accents,
    h('p', { class: 'muted' }, trip.branding?.accent ? 'Company colour: the colour of this trip\'s company look, on the small titles and the "now" marks. Buttons stay dark.' : 'This trip has no company colour yet (Settings › Company look): Brass is used.'));
}
