// "My company" (Trips screen): the look every NEW trip starts with, set once on this device instead of
// trip by trip (owner's request, 1 Oct 2026): logo, colour and name. It is copied into each trip when the
// trip is loaded, so the trip carries its own copy (it syncs and backs up with the trip). Saved on this
// device only for now: a second phone gets it with any trip it pulls, or from "Copy from" below.

import { h } from '../dom.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { brandForm } from './brandForm.js';
import { defaultBranding } from '../loader.js';

// onSaved(look) runs after a successful save (used to also apply the look to the trip just loaded).
export function openCompanyLookSheet(ctx, { onSaved, title = 'Company look', skipLabel = 'Cancel' } = {}) {
  const look = ctx.companyLook ?? defaultBranding();
  const form = brandForm({ initial: look, withNote: false });

  const save = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      const { companyName, accent, logo } = form.read();
      const saved = { companyName: companyName.trim(), accent, logo };
      await ctx.saveCompanyLook(saved);
      closeSheet();
      showToast('Company look saved');
      onSaved?.(saved);
    },
  }, 'Save');

  // A phone that never had a look set (a second phone, say) can borrow one from a trip it already holds.
  const donors = ctx.companyLook ? [] : ctx.trips.filter((t) => t.branding && (t.branding.logo || t.branding.companyName));
  const copyButtons = donors.slice(0, 3).map((t) => h('button', {
    class: 'btn btn--plain btn--small', type: 'button', onclick: () => form.fill(t.branding),
  }, `Copy from "${t.name}"`));

  openSheet({
    eyebrow: 'Company', title,
    subtitle: 'Used for every new trip: the logo, colour and name on your printed documents.',
    body: [form.node, ...copyButtons],
    footer: save,
    cancelLabel: skipLabel,
  });
}
