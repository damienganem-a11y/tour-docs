// Pieces shared by several screens.

import { h } from '../dom.js';

// The top of a screen: an optional "‹ back" link, a small label, the big title, a line of detail.
// action: an optional button shown on the right of the title, taking all the room that is left
// (the Undo button uses this). The line of detail then goes underneath, across the full width.
// title is optional: a list screen already named by its eyebrow and its bottom tab (By guest, By
// destination) does not need to repeat itself in a second, bigger heading. With no title, the
// eyebrow and the action each get their own full-width line instead of sharing one row, so
// buttons (e.g. the A-Z/Seat switch next to Undo) have real room to sit side by side.
export function pageHead({ back, eyebrow, title, subtitle, action }) {
  const eyebrowEl = eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null;
  const detail = subtitle ? h('div', { class: 'subtitle' }, subtitle) : null;
  const backLink = back ? h('a', { class: 'back-link', href: back.href }, `‹ ${back.label}`) : null;

  if (!title) return h('header', { class: 'page-head' }, backLink, eyebrowEl, action, detail);

  const heading = h('div', { class: 'page-head-text' }, eyebrowEl, h('h1', { class: 'title' }, title));
  return h('header', { class: 'page-head' },
    backLink,
    action ? h('div', { class: 'page-head-row' }, heading, action) : heading,
    detail
  );
}
