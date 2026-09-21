// Pieces shared by several screens.

import { h } from '../dom.js';

// The top of a screen: an optional "‹ back" link, a small label, the big title, a line of detail.
// action: an optional button shown on the right, next to the title (the Undo button uses this).
export function pageHead({ back, eyebrow, title, subtitle, action }) {
  const text = h('div', { class: 'page-head-text' },
    eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null,
    h('h1', { class: 'title' }, title),
    subtitle ? h('div', { class: 'subtitle' }, subtitle) : null
  );

  return h('header', { class: 'page-head' },
    back ? h('a', { class: 'back-link', href: back.href }, `‹ ${back.label}`) : null,
    action ? h('div', { class: 'page-head-row' }, text, action) : text
  );
}
