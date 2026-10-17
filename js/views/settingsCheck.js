// Settings > Control > Check this phone (owner's request, 16 Oct 2026): one screen that says, in plain words, what works on THIS device and what does not:
// the version, the connection, the sign-in, what the server has, the notifications, and for each trip the role and whether changes are applied live.
// "Copy the report" puts it in the clipboard, so it can be pasted into a message.

import { h } from '../dom.js';
import { showToast } from '../ui.js';
import { pageHead } from './chrome.js';

const MARK = { ok: '✓', warn: '!', bad: '✗' };

export function checkSettingsPage(ctx, trip) {
  const list = h('div', {}, h('p', { class: 'muted' }, 'Checking…'));
  let report = [];
  const run = () => {
    list.replaceChildren(h('p', { class: 'muted' }, 'Checking…'));
    ctx.checkPhone().then((rows) => {
      report = rows;
      list.replaceChildren(...rows.map((r) => h('div', { class: `check-line check-line--${r.status}` },
        h('span', { class: 'check-mark', 'aria-hidden': 'true' }, MARK[r.status]), h('div', {}, h('b', {}, r.label), h('div', { class: 'muted' }, r.detail)))));
    }).catch(() => list.replaceChildren(h('p', { class: 'muted' }, 'The check could not run.')));
  };
  run();
  const copy = async () => {
    const text = ['Check this phone', ...report.map((r) => `${MARK[r.status]} ${r.label}: ${r.detail}`)].join('\n');
    try { await navigator.clipboard.writeText(text); showToast('Report copied'); } catch { showToast('Could not copy here.', true); }
  };
  return h('div', {},
    pageHead({ back: { href: `#/trip/${trip.id}/settings/section/phone`, label: 'This phone' }, eyebrow: 'This phone', title: 'Check this phone', subtitle: 'What works on this device, and what does not.' }),
    list,
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--small', type: 'button', onclick: run }, 'Check again'),
      h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: copy }, 'Copy the report')));
}
