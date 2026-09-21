// Two small pieces of screen furniture used by several views:
//   - a bottom sheet (a panel that slides up to let you pick something)
//   - a toast (a short message at the top, e.g. "Moved Helen N. to Old City walk")

import { h } from './dom.js';

// ---------- Bottom sheet ----------

let openBackdrop = null;   // the sheet currently on screen, if any
let removeKeyHandler = null;

export function closeSheet() {
  if (!openBackdrop) return;
  openBackdrop.remove();
  document.body.classList.remove('sheet-open');
  document.removeEventListener('keydown', removeKeyHandler);
  openBackdrop = null;
}

// eyebrow: small label above the title. title/subtitle: text at the top. body: elements to show inside.
// footer: something that stays in view under the scrolling list (for example the Confirm button of a long list).
// cancelLabel: the words on the button that closes the sheet. cancelDanger: draw that button in red.
// Opening a sheet while another is open replaces it, so a flow can go from step to step.
export function openSheet({ eyebrow, title, subtitle, body, footer, cancelLabel = 'Cancel', cancelDanger = false }) {
  closeSheet();

  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      eyebrow ? h('div', { class: 'eyebrow eyebrow--grey' }, eyebrow) : null,
      h('h2', {}, title),
      subtitle ? h('div', { class: 'muted' }, subtitle) : null
    ),
    h('div', { class: 'sheet-body' }, body),
    footer ? h('div', { class: 'sheet-footer' }, footer) : null,
    h('button', { class: `btn ${cancelDanger ? 'btn--danger' : 'btn--plain'}`, type: 'button', onclick: closeSheet }, cancelLabel)
  );

  // Tapping the dark area outside the sheet closes it.
  openBackdrop = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === openBackdrop) closeSheet(); } }, sheet);
  removeKeyHandler = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', removeKeyHandler);

  document.body.classList.add('sheet-open'); // stops the page behind from scrolling
  document.body.append(openBackdrop);
}

// ---------- Toast ----------

let toast = null;
let toastTimer = null;

export function showToast(text, isError = false) {
  toast?.remove();
  clearTimeout(toastTimer);
  toast = h('div', { class: `toast${isError ? ' toast--error' : ''}`, role: 'status' }, text);
  document.body.append(toast);
  toastTimer = setTimeout(() => toast?.remove(), isError ? 6000 : 3000);
}
