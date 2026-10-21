// Settings > Brand: the look of ONE trip's printed documents (confirmation cards, group lists): the
// company's name, logo and colour, plus an optional note printed on every card. The looks of your companies are saved on the
// phone (see companyLook.js) and chosen when a trip is added; this page is where one trip can differ.
// Saved through the one change function, so it is journaled and the Undo button here takes it back.

import { h } from '../dom.js';
import { pageHead } from './chrome.js';
import { undoButton } from './undo.js';
import { brandForm } from './brandForm.js';
import { applyChange } from '../changes.js';
import { showToast } from '../ui.js';
import { BRANDING_UNDO_SCOPE } from '../journal.js';
import { defaultBranding, brandingFromLook } from '../loader.js';
import { openCompanyLooksManager } from './companyLook.js';

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

  // The looks saved on this device: one tap fills the form from it (name, colour, logo; the note stays), then Save applies it to this trip.
  const saved = ctx.companyLooks.map((look) => h('button', { class: 'btn btn--plain btn--small', type: 'button', onclick: () => form.fill(brandingFromLook(look)) }, `Use ${look.companyName || 'a saved look'}`));
  const manage = h('button', { class: 'btn btn--plain btn--small', type: 'button', onclick: () => openCompanyLooksManager(ctx) }, 'Manage my company looks');
  // And what is on the form can be kept for other trips.
  const keep = h('button', {
    class: 'btn btn--plain btn--small', type: 'button',
    onclick: async () => { const { companyName, accent, logo, teamLabel } = form.read(); await ctx.saveCompanyLook({ companyName: companyName.trim(), accent, logo, teamLabel: teamLabel.trim() }); ctx.refresh(); showToast('Kept for other trips'); },
  }, 'Keep this look for other trips');

  return h('div', {},
    pageHead({
      back: { href: `#/trip/${trip.id}/settings`, label: 'Settings' },
      eyebrow: 'Settings', title: 'Company look',
      subtitle: 'How this trip\'s printed documents look.',
      action: undoButton(ctx, trip, { scope: BRANDING_UNDO_SCOPE }),
    }),
    saved.length > 0 ? h('p', { class: 'muted' }, 'Looks saved on this phone') : null, saved.length > 0 ? h('div', { class: 'card-actions' }, saved) : null,
    form.node, saveButton, keep, manage);
}
