// Settings > Brand: the look of ONE trip's printed documents (confirmation cards, group lists): the
// company's name, logo and colour, plus an optional note printed on every card. New trips start with the
// company look set under Trips > My company (see companyLook.js); this page is where one trip can differ.
// Saved through the one change function, so it is journaled and the Undo button here takes it back.

import { h } from '../dom.js';
import { pageHead } from './chrome.js';
import { undoButton } from './undo.js';
import { brandForm } from './brandForm.js';
import { applyChange } from '../changes.js';
import { showToast } from '../ui.js';
import { BRANDING_UNDO_SCOPE } from '../journal.js';
import { defaultBranding, brandingFromLook } from '../loader.js';

export function brandSettingsPage(ctx, trip) {
  const form = brandForm({ initial: trip.branding ?? defaultBranding(), withNote: true });

  let saving = false;
  const saveButton = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      if (saving) return;
      saving = true;
      const result = await applyChange(ctx, trip.id, { type: 'set-branding', ...form.read() });
      saving = false;
      if (result.ok) { ctx.refresh(); showToast('Brand saved'); } else showToast(result.error, true);
    },
  }, 'Save');

  // Only when a company look exists: fills the form from it (name, colour, logo; the note stays).
  const useCompany = ctx.companyLook
    ? h('button', { class: 'btn btn--plain', type: 'button', onclick: () => form.fill(brandingFromLook(ctx.companyLook)) }, 'Use my company look')
    : null;

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
      eyebrow: 'Settings', title: 'Company look',
      subtitle: 'How this trip\'s printed documents look.',
      action: undoButton(ctx, trip, { scope: BRANDING_UNDO_SCOPE }),
    }),
    useCompany, form.node, saveButton);
}
