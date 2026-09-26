// A few small pieces used by several views:
//   - a bottom sheet (a panel that slides up to let you pick something)
//   - a toast (a short message at the top, e.g. "Moved Helen N. to Old City walk")
//   - handing a file to the phone's share sheet, or downloading it if there is none

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
// titleBadge: an element shown top-right, level with the title (e.g. a live "2 / 4" count) — same
// row layout as a card's own title+count (see guestCard, tableCard).
// footer: something that stays in view under the scrolling list (for example the Confirm button of a long list).
// cancelLabel: the words on the button that closes the sheet. cancelDanger: draw that button in red.
// Opening a sheet while another is open replaces it, so a flow can go from step to step.
export function openSheet({ eyebrow, title, subtitle, titleBadge, body, footer, cancelLabel = 'Cancel', cancelDanger = false }) {
  closeSheet();

  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      eyebrow ? h('div', { class: 'eyebrow eyebrow--grey' }, eyebrow) : null,
      titleBadge ? h('div', { class: 'sheet-title-row' }, h('h2', {}, title), titleBadge) : h('h2', {}, title),
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

// ---------- Sharing or downloading a file ----------

// Hands a file to the OS share sheet (the same mechanism WhatsApp itself sits behind, and — for a
// sensitive file like a backup — also "Save to Files"), or downloads it if the browser has none.
export async function shareOrDownloadFile(blob, filename, mimeType) {
  const file = new File([blob], filename, { type: mimeType });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return; // the owner backed out of the share sheet: nothing to say
      // any other error: fall through and offer a download instead
    }
  }
  downloadBlob(blob, filename);
  showToast('Your phone has no share sheet for files here, so the file was saved to your downloads instead.');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
