// Pieces shared by several screens.

import { h } from '../dom.js';

// The top of a screen: an optional "‹ back" link, a small label, the big title, a line of detail.
// action: an optional button shown on the right of the title, taking all the room that is left
// (the Undo button uses this). The line of detail then goes underneath, across the full width.
export function pageHead({ back, eyebrow, title, subtitle, action }) {
  const heading = h('div', { class: 'page-head-text' },
    eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null,
    h('h1', { class: 'title' }, title)
  );
  const detail = subtitle ? h('div', { class: 'subtitle' }, subtitle) : null;

  return h('header', { class: 'page-head' },
    back ? h('a', { class: 'back-link', href: back.href }, `‹ ${back.label}`) : null,
    action ? h('div', { class: 'page-head-row' }, heading, action) : heading,
    detail
  );
}
