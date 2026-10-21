// Company looks (owner's request, 18 Oct 2026): the logo, colour and name of a company (Nat Geo, Disney...), saved on this device so they are made ONCE
// and chosen per trip. A trip carries its own copy (it syncs and backs up with the trip): choosing a look copies it into the trip.
//   openCompanyLookSheet   make a NEW look (saved in the device's list)
//   openCompanyLookChooser the question asked when a trip is added: one of the saved looks, a new one, or none

import { h } from '../dom.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { brandForm } from './brandForm.js';
import { defaultBranding, brandingFromLook } from '../loader.js';
import { applyChange } from '../changes.js';

// onSaved(look) runs after a successful save (used to also apply the look to the trip just loaded).
export function openCompanyLookSheet(ctx, { onSaved, title = 'New company look', skipLabel = 'Cancel', look = null } = {}) {
  const form = brandForm({ initial: look ?? defaultBranding(), withNote: false });

  const save = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      const { companyName, accent, logo, teamLabel } = form.read();
      const saved = await ctx.saveCompanyLook({ ...(look ? { id: look.id } : {}), companyName: companyName.trim(), accent, logo, teamLabel: teamLabel.trim() });
      closeSheet();
      showToast('Company look saved');
      onSaved?.(saved);
    },
  }, 'Save');

  // A phone with no saved look (a second phone, say) can borrow one from a trip it already holds.
  const donors = ctx.companyLooks.length > 0 ? [] : ctx.trips.filter((t) => t.branding && (t.branding.logo || t.branding.companyName));
  const copyButtons = donors.slice(0, 3).map((t) => h('button', {
    class: 'btn btn--plain btn--small', type: 'button', onclick: () => form.fill(t.branding),
  }, `Copy from "${t.name}"`));

  openSheet({
    eyebrow: 'Company', title,
    subtitle: 'The logo, colour and name on your printed documents. Saved on this phone, so you can pick it again for other trips.',
    body: [form.node, ...copyButtons],
    footer: save,
    cancelLabel: skipLabel,
  });
}

// Applies a saved look to one trip (through the one change function, so the journal has it and Undo takes it back).
export async function applyLookToTrip(ctx, trip, look) {
  const current = ctx.trip(trip.id) ?? trip;
  const result = await applyChange(ctx, trip.id, { type: 'set-branding', ...brandingFromLook(look, current.branding?.cardNote ?? '') });
  if (!result.ok) showToast(result.error, true);
  return result.ok;
}

// "Which company look for this trip?" One tap on a saved look, or a new one, or none (Tour Docs orange).
export function openCompanyLookChooser(ctx, trip) {
  const saved = ctx.companyLooks;
  const rows = saved.map((look) => h('button', {
    class: 'btn btn--plain', type: 'button',
    onclick: async () => { closeSheet(); if (await applyLookToTrip(ctx, trip, look)) showToast(`${look.companyName || 'Company look'} applied`); },
  }, look.companyName || 'Unnamed company'));
  openSheet({
    eyebrow: 'New trip', title: 'Which company look for this trip?',
    subtitle: saved.length > 0 ? 'Choose one you already made, or make a new one.' : 'Make one now, or skip: you can do it later in Settings > Company look.',
    body: [...rows,
      h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); setTimeout(() => openCompanyLookSheet(ctx, { onSaved: (look) => applyLookToTrip(ctx, trip, look) }), 150); } }, '+ New company look')],
    cancelLabel: 'No company look',
  });
}

// "Company looks": the list of identities saved on this phone (owner's request, 21 Oct 2026): make them once, delete the ones no longer needed, make a new one.
// Reached from the account menu (avatar) and from a trip's Settings > Company look.
export function openCompanyLooksManager(ctx) {
  const draw = () => {
    const looks = ctx.companyLooks;
    openSheet({
      eyebrow: 'This phone', title: 'Company looks',
      subtitle: 'Each company you work for: name, colour, logo and what you call your team. You choose one when you add a trip.',
      body: [
        ...(looks.length === 0 ? [h('p', { class: 'muted' }, 'None yet.')] : looks.map((look) => h('div', { class: 'card' },
          h('div', { class: 'act-name' }, look.companyName || 'Unnamed company'),
          h('div', { class: 'muted' }, [look.teamLabel ? `Team: ${look.teamLabel}` : null, look.logo ? 'With a logo' : 'No logo'].filter(Boolean).join(' · ')),
          h('div', { class: 'card-actions' },
            h('button', { class: 'btn btn--small btn--plain', type: 'button', onclick: () => { closeSheet(); setTimeout(() => openCompanyLookSheet(ctx, { look, title: 'Edit company look', onSaved: () => setTimeout(draw, 200) }), 150); } }, 'Edit'),
            h('button', { class: 'btn btn--small btn--danger', type: 'button', onclick: async () => { await ctx.deleteCompanyLook(look.id); draw(); } }, 'Delete'))))),
        h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); setTimeout(() => openCompanyLookSheet(ctx, { onSaved: () => setTimeout(draw, 200) }), 150); } }, '+ New company look'),
      ],
      cancelLabel: 'Close',
    });
  };
  draw();
}
