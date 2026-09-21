// Pieces shared by several screens.

import { h } from '../dom.js';

// The top of a screen: an optional "‹ back" link, a small label, the big title, a line of detail.
export function pageHead({ back, eyebrow, title, subtitle }) {
  return h('header', { class: 'page-head' },
    back ? h('a', { class: 'back-link', href: back.href }, `‹ ${back.label}`) : null,
    eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null,
    h('h1', { class: 'title' }, title),
    subtitle ? h('div', { class: 'subtitle' }, subtitle) : null
  );
}
