// Settings > This phone (owner's request, 18 Oct 2026): what belongs to THIS phone, not to the trip: Check this phone, notifications, and the look (light / dark).

import { h } from '../dom.js';
import { pageHead } from './chrome.js';
import { notificationsCard } from './settingsRequests.js';
import { THEMES, getTheme, setTheme } from '../theme.js';

const back = (trip) => ({ href: `#/trip/${trip.id}/settings/section/phone`, label: 'This phone' });

export function notificationsPage(ctx, trip) {
  return h('div', {},
    pageHead({ back: back(trip), eyebrow: 'This phone', title: 'Notifications', subtitle: 'Told at once when a guest or a colleague writes or asks.' }),
    notificationsCard(ctx));
}

export function appearancePage(ctx, trip) {
  const looks = h('div', { class: 'switch', role: 'group', 'aria-label': 'Appearance' });
  const draw = () => looks.replaceChildren(...THEMES.map(([id, label]) => h('button', {
    class: `switch-item${getTheme() === id ? ' is-active' : ''}`, type: 'button', 'aria-pressed': String(getTheme() === id),
    onclick: () => { setTheme(id); draw(); },
  }, label)));
  draw();
  return h('div', {},
    pageHead({ back: back(trip), eyebrow: 'This phone', title: 'Appearance', subtitle: 'Light, dark, or follow the phone. Only this phone changes.' }),
    looks);
}
