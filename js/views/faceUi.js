// The guests' faces on the screens (v0.153.0): the round picture (or the two initials), taking or changing one, and a "photo session" that goes
// through every guest without a photo, one after the other (at the airport, at the welcome desk). The rules live in faces.js.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { displayNames, alphabetical } from '../rules.js';
import { faceFromFile, initialsOf } from '../faces.js';

// The round face of a guest: the photo, or the initials on a soft circle. size in pixels.
export function face(guest, size = 44) {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px`;
  return guest?.photo
    ? h('img', { class: 'face', src: guest.photo, alt: '', style, loading: 'lazy', decoding: 'async' })
    : h('span', { class: 'face face--initials', 'aria-hidden': 'true', style }, initialsOf(guest));
}

// Asks the phone for a picture (the camera first, on a phone) and saves it as the guest's face. Resolves true when saved.
export function takeFace(ctx, trip, guest) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', capture: 'user', hidden: '' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; input.remove();
      if (!file) { resolve(false); return; }
      try {
        const photo = await faceFromFile(file);
        const result = await applyChange(ctx, trip.id, { type: 'set-photo', guestId: guest.id, photo });
        if (result.ok) { ctx.refresh(); resolve(true); } else { showToast(result.error, true); resolve(false); }
      } catch (error) { showToast(error.message, true); resolve(false); }
    });
    document.body.append(input);
    input.click();
  });
}

// The face of a guest's own page, with what can be done with it.
export function faceBlock(ctx, trip, guest) {
  const canChange = ctx.roleFor(trip.id) !== 'viewer' && !trip.archivedAt;
  const names = displayNames(trip.guests);
  const remove = async () => {
    closeSheet();
    const result = await applyChange(ctx, trip.id, { type: 'set-photo', guestId: guest.id, photo: null });
    if (result.ok) { ctx.refresh(); showToast('Photo removed'); } else showToast(result.error, true);
  };
  return h('div', { class: 'face-block' },
    h('button', { class: 'face-big', type: 'button', disabled: !canChange, 'aria-label': guest.photo ? `Photo of ${names.get(guest.id)}. Tap to change it.` : `Add a photo of ${names.get(guest.id)}`,
      onclick: () => (guest.photo
        ? openSheet({ eyebrow: names.get(guest.id), title: 'Photo', cancelLabel: 'Close', body: [
            h('img', { class: 'face-preview', src: guest.photo, alt: '' }),
            h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); takeFace(ctx, trip, guest); } }, 'Take a new photo'),
            h('button', { class: 'btn btn--plain', type: 'button', onclick: remove }, 'Remove the photo')] })
        : takeFace(ctx, trip, guest)) },
      face(guest, 96),
      canChange ? h('span', { class: 'face-edit' }, guest.photo ? 'Change' : 'Add photo') : null));
}

// Every guest still without a face, one after the other: a big name, "Take the photo", "Skip". Stops when the list is done or on "Stop".
export function photoSession(ctx, tripId) {
  const skipped = new Set();
  const next = () => {
    const trip = ctx.trip(tripId);
    const names = displayNames(trip.guests);
    const missing = trip.guests.filter((g) => !g.leftAt && !g.photo).sort(alphabetical(names));
    const guest = missing.find((g) => !skipped.has(g.id));
    if (!guest) {
      openSheet({ eyebrow: 'Photos', title: missing.length === 0 ? 'Every guest has a photo' : 'That is everyone for now', subtitle: missing.length ? `${missing.length} still without a photo (skipped).` : null, cancelLabel: 'Close', body: [] });
      return;
    }
    const party = trip.guests.filter((g) => g.partyId === guest.partyId && g.id !== guest.id && !g.leftAt).map((g) => names.get(g.id));
    openSheet({
      eyebrow: `Photos · ${missing.length} to go`, title: names.get(guest.id),
      subtitle: [guest.seat ? `Seat ${guest.seat}` : null, party.length ? `With ${party.join(', ')}` : 'Travelling solo'].filter(Boolean).join(' · '),
      cancelLabel: 'Stop',
      body: [
        h('div', { class: 'face-session' }, face(guest, 120)),
        h('button', { class: 'btn', type: 'button', onclick: async () => { closeSheet(); await takeFace(ctx, ctx.trip(tripId), guest); next(); } }, 'Take the photo'),
        h('button', { class: 'btn btn--plain', type: 'button', onclick: () => { skipped.add(guest.id); next(); } }, 'Skip this guest'),
      ],
    });
  };
  next();
}
