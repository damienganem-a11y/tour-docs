// The form fields for a company look: name, logo, colour (and, for one trip, a note printed on every
// card). Used both by Settings > Brand (one trip) and by "My company" on the Trips screen (the look every
// new trip starts with), so the two can never drift apart.

import { h } from '../dom.js';
import { showToast } from '../ui.js';

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

// initial: { companyName, accent, cardNote?, logo }. withNote adds the per-trip card note field.
// Returns { node, read(), fill(look) }: read() gives what is on screen now; fill() replaces name, colour
// and logo (never the note) with a saved look.
export function brandForm({ initial, withNote = false }) {
  let logo = initial.logo ?? null;

  const nameInput = h('input', { class: 'text-input', type: 'text', maxlength: '60', placeholder: 'Company name', 'aria-label': 'Company name', value: initial.companyName ?? '' });
  const colorInput = h('input', { class: 'color-input', type: 'color', 'aria-label': 'Colour', value: initial.accent });
  const noteInput = withNote
    ? h('input', { class: 'text-input', type: 'text', maxlength: '200', placeholder: 'Note printed on every card (optional)', 'aria-label': 'Note on every card', value: initial.cardNote ?? '' })
    : null;

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

  return {
    node: h('div', {}, nameInput, preview, fileInput, chooseButton, removeButton,
      h('label', { class: 'field-label' }, 'Colour', colorInput), noteInput),
    read: () => ({ companyName: nameInput.value, accent: colorInput.value, cardNote: noteInput?.value ?? '', logo }),
    fill: (look) => { nameInput.value = look.companyName ?? ''; colorInput.value = look.accent; logo = look.logo ?? null; drawPreview(); },
  };
}
