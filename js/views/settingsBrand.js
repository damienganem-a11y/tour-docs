// Settings > Brand: the look of the printed confirmation cards (Phase 3 exports). The company's own
// name, logo and colour, plus an optional note printed on every card. Nothing about the company is fixed
// in the app: this is where it comes from. Saved through the one change function, so it is journaled and
// the Undo button here takes it back.

import { h } from '../dom.js';
import { pageHead } from './chrome.js';
import { undoButton } from './undo.js';
import { applyChange } from '../changes.js';
import { showToast } from '../ui.js';
import { BRANDING_UNDO_SCOPE } from '../journal.js';
import { defaultBranding } from '../loader.js';

// A picture from the phone -> a small JPEG (at most 320 wide) as a data URL, kept inside the trip. A
// transparent PNG is flattened onto white: the cards are white, and a PDF logo is a plain JPEG.
async function logoFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('That picture could not be read. Try a PNG or JPEG.'));
      image.src = url;
    });
    const scale = Math.min(1, 320 / image.naturalWidth);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    g.drawImage(image, 0, 0, width, height);
    return { data: canvas.toDataURL('image/jpeg', 0.85), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function brandSettingsPage(ctx, trip) {
  const brand = trip.branding ?? defaultBranding();
  let logo = brand.logo; // changed by the picture buttons below; only saved with the Save button

  const nameInput = h('input', { class: 'text-input', type: 'text', maxlength: '60', placeholder: 'Company name', 'aria-label': 'Company name', value: brand.companyName });
  const colorInput = h('input', { class: 'color-input', type: 'color', 'aria-label': 'Card colour', value: brand.accent });
  const noteInput = h('input', { class: 'text-input', type: 'text', maxlength: '200', placeholder: 'Note printed on every card (optional)', 'aria-label': 'Note on every card', value: brand.cardNote });

  const preview = h('div', { class: 'logo-preview' });
  const drawPreview = () => {
    preview.replaceChildren(logo
      ? h('img', { src: logo.data, alt: 'Logo', class: 'logo-preview-img' })
      : h('p', { class: 'muted' }, 'No logo yet: the company name is printed instead.'));
  };
  drawPreview();

  const fileInput = h('input', {
    class: 'file-input', type: 'file', accept: 'image/*',
    onchange: async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      try { logo = await logoFromFile(file); drawPreview(); } catch (error) { showToast(error.message, true); }
    },
  });
  const chooseButton = h('button', { class: 'btn btn--plain', type: 'button', onclick: () => fileInput.click() }, 'Choose a logo from this phone');
  const removeButton = h('button', { class: 'btn btn--plain btn--small', type: 'button', onclick: () => { logo = null; drawPreview(); } }, 'Remove the logo');

  let saving = false;
  const saveButton = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      if (saving) return;
      saving = true;
      const result = await applyChange(ctx, trip.id, {
        type: 'set-branding', companyName: nameInput.value, accent: colorInput.value, cardNote: noteInput.value, logo,
      });
      saving = false;
      if (result.ok) { ctx.refresh(); showToast('Brand saved'); } else showToast(result.error, true);
    },
  }, 'Save');

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
      eyebrow: 'Brand', title: 'Brand',
      subtitle: 'How your confirmation cards look.',
      action: undoButton(ctx, trip, { scope: BRANDING_UNDO_SCOPE }),
    }),
    nameInput, preview, fileInput, chooseButton, removeButton,
    h('label', { class: 'field-label' }, 'Colour', colorInput),
    noteInput, saveButton);
}
