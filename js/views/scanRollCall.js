// Roll call by scanning (v0.146.0, owner's decision, 5 Nov 2026: one scan per family). Opened with "Scan boarding passes" on a roll call:
//   - the camera fills the screen; the vehicles stay at the top (tap one: the next scans go into it; + adds one), with "34 of 48 on board";
//   - a scan checks the whole family on the pass into the chosen vehicle at once (green, a buzz, their names). "Not all here?" takes someone out;
//   - already in another vehicle: "Move to V2" or leave them; booked on another tour: in red, "Add them anyway" or "Not them";
//   - a code that is not a boarding pass of this trip says so.
// Every scan is an ordinary check-in through the one change function (journaled, Undo, live for colleagues). The QR code is read on this phone by
// jsQR (Apache licence, part of the app in vendor/jsqr), so it works without internet. Tapping names on the roll call still works as before.

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { showToast } from '../ui.js';
import { displayNames, joinNames } from '../rules.js';
import { findRollCall, vehicleLabel, rollCallState } from '../rollcall.js';
import { readPass } from '../boardingPass.js';
import { putIn } from '../put.js';

let jsqrLoading = null;
function loadReader() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsqrLoading) {
    jsqrLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('vendor/jsqr/jsQR.js', new URL('./', location.href)).href;
      script.onload = () => resolve(window.jsQR); script.onerror = () => { jsqrLoading = null; reject(new Error('reader')); };
      document.head.append(script);
    });
  }
  return jsqrLoading;
}

// What a scan means for the roll call, before anything is changed (pure, tested): which guests go in, which are already in a vehicle, which are elsewhere.
export function scanPlan(trip, activityId, vehicleId, text) {
  const read = readPass(trip, activityId, text);
  if (!read.ok) return read;
  const rollCall = findRollCall(trip, activityId);
  const inVehicle = (g) => rollCall?.checkins?.[g.id] ?? null;
  return {
    ok: true,
    checkIn: read.onThisTour.filter((g) => !inVehicle(g)),
    alreadyHere: read.onThisTour.filter((g) => inVehicle(g) === vehicleId),
    inOther: read.onThisTour.filter((g) => inVehicle(g) && inVehicle(g) !== vehicleId),
    elsewhere: read.elsewhere,
  };
}

export function openScanner(ctx, tripId, activity, { vehicleId, onVehicle }) {
  let trip = ctx.trip(tripId);
  let chosen = vehicleId;
  let stream = null; let timer = null; let closed = false;
  let lastText = ''; let lastAt = 0; let busy = false;

  const video = h('video', { class: 'scan-video', playsinline: '', muted: '', autoplay: '' });
  video.muted = true; video.setAttribute('playsinline', '');
  const canvas = document.createElement('canvas');
  const counter = h('div', { class: 'scan-count' });
  const vehicles = h('div', { class: 'scan-vehicles' });
  const result = h('div', { class: 'scan-result', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'scan-hint' }, 'Point the camera at a boarding pass'));
  const overlay = h('div', { class: 'scan', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Scan boarding passes' },
    h('div', { class: 'scan-top' },
      h('div', { class: 'scan-title' }, h('small', {}, 'Roll call · scan'), h('b', {}, activity.name)),
      counter,
      h('button', { class: 'scan-close', type: 'button', 'aria-label': 'Close the camera', onclick: () => close() }, 'Done')),
    vehicles,
    h('div', { class: 'scan-frame' }, video, h('div', { class: 'scan-aim', 'aria-hidden': 'true' })),
    result);
  document.body.append(overlay);
  document.body.classList.add('sheet-open');

  const names = () => displayNames(trip.guests);
  const who = (guests) => joinNames(guests.map((g) => names().get(g.id)));
  const rollCall = () => findRollCall(trip, activity.id);
  const label = (v) => vehicleLabel(trip, v);
  const chosenVehicle = () => rollCall().vehicles.find((v) => v.id === chosen) ?? rollCall().vehicles[0];

  function drawTop() {
    trip = ctx.trip(tripId);
    const rc = rollCall();
    if (!rc) { close(); return; }
    if (!rc.vehicles.some((v) => v.id === chosen)) chosen = rc.vehicles[0].id;
    const state = rollCallState(trip, rc);
    counter.textContent = `${state.checkedIn.length} of ${state.booked.length} on board`;
    putIn(vehicles, 
      ...rc.vehicles.map((v) => h('button', { class: `scan-vehicle${v.id === chosen ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(v.id === chosen),
        onclick: () => { chosen = v.id; onVehicle?.(v.id); drawTop(); say('info', `Next scans go into ${label(v)}`); } },
        h('b', {}, label(v)), h('span', {}, String((state.perVehicle.get(v.id) ?? []).length)))),
      h('button', { class: 'scan-vehicle scan-vehicle--add', type: 'button', 'aria-label': 'Add a vehicle', onclick: async () => {
        const r = await applyChange(ctx, tripId, { type: 'vehicle-add', activityId: activity.id });
        if (r.ok) { chosen = r.entries[0].vehicleId; onVehicle?.(chosen); drawTop(); say('info', `${label(chosenVehicle())} added: next scans go into it`); } else showToast(r.error, true);
      } }, '+'));
  }

  function say(tone, text, ...actions) {
    result.className = `scan-result scan-result--${tone}`;
    const shown = actions.filter(Boolean);
    putIn(result, ...[h('div', { class: 'scan-msg' }, text), shown.length ? h('div', { class: 'scan-actions' }, shown) : null].filter(Boolean)); // never a "null" on screen
  }
  const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* no vibration on this phone */ } };

  async function apply(changes) {
    const r = await applyChange(ctx, tripId, changes);
    if (!r.ok) { say('bad', r.error); buzz([60, 60, 60]); return false; }
    ctx.refresh(); drawTop(); return true;
  }
  const checkin = (guests, vehicle) => guests.map((g) => ({ type: 'checkin', activityId: activity.id, guestId: g.id, vehicleId: vehicle.id }));

  async function handle(text) {
    trip = ctx.trip(tripId);
    const vehicle = chosenVehicle();
    const plan = scanPlan(trip, activity.id, vehicle.id, text);
    if (!plan.ok) { say('bad', plan.why === 'other-trip' ? 'This boarding pass is not for this trip.' : 'This is not a Tour Docs boarding pass.'); buzz([60, 60, 60]); return; }
    const lines = [];
    if (plan.checkIn.length) {
      if (!(await apply(checkin(plan.checkIn, vehicle)))) return;
      buzz(90);
      lines.push(`✓ ${who(plan.checkIn)} → ${label(vehicle)}`);
    }
    if (plan.alreadyHere.length) lines.push(`${who(plan.alreadyHere)} already in ${label(vehicle)}`);
    const actions = [];
    if (plan.checkIn.length > 1) actions.push(h('button', { class: 'scan-btn scan-btn--plain', type: 'button', onclick: () => notAllHere(plan.checkIn) }, 'Not all here?'));
    if (plan.inOther.length) {
      const where = rollCall().vehicles.find((v) => v.id === rollCall().checkins[plan.inOther[0].id]);
      lines.push(`${who(plan.inOther)} ${plan.inOther.length === 1 ? 'is' : 'are'} in ${where ? label(where) : 'another vehicle'}`);
      actions.push(h('button', { class: 'scan-btn', type: 'button', onclick: async () => { if (await apply(checkin(plan.inOther, vehicle))) say('good', `✓ ${who(plan.inOther)} moved to ${label(vehicle)}`); } }, `Move to ${label(vehicle)}`));
    }
    if (plan.elsewhere.length) {
      const slotId = activity.slotId;
      const place = (g) => { const b = trip.bookings?.[g.id]?.[slotId]; return b?.kind === 'activity' ? trip.activities.find((a) => a.id === b.activityId)?.name ?? 'another tour' : 'At leisure'; };
      lines.push(`${who(plan.elsewhere)}: booked on ${[...new Set(plan.elsewhere.map(place))].join(', ')}, not this tour`);
      actions.push(
        h('button', { class: 'scan-btn', type: 'button', onclick: async () => {
          const moves = plan.elsewhere.map((g) => ({ type: 'move', guestId: g.id, slotId, to: { kind: 'activity', activityId: activity.id } }));
          const r = await applyChange(ctx, tripId, moves);
          if (!r.ok) { say('bad', `${r.error} (Use the roll call's "+ Add guest" to force it.)`); return; }
          trip = ctx.trip(tripId);
          if (await apply(checkin(plan.elsewhere, chosenVehicle()))) say('good', `✓ ${who(plan.elsewhere)} added to this tour → ${label(chosenVehicle())}`);
        } }, 'Add them anyway'),
        h('button', { class: 'scan-btn scan-btn--plain', type: 'button', onclick: () => say('info', 'Not checked in. Next pass, please.') }, 'Not them'));
    }
    const tone = plan.elsewhere.length ? 'bad' : plan.inOther.length ? 'warn' : plan.checkIn.length ? 'good' : 'info';
    if (tone !== 'good') buzz(plan.elsewhere.length ? [60, 60, 60] : 40);
    say(tone, lines.join(' · '), ...actions);
  }

  // Someone of the family is not there: take them out again (back on the list).
  function notAllHere(guests) {
    say('info', 'Tap who is NOT here:', ...guests.map((g) => h('button', { class: 'scan-btn scan-btn--plain', type: 'button', onclick: async () => {
      if (await apply({ type: 'checkout', activityId: activity.id, guestId: g.id })) say('info', `${names().get(g.id)} is back on the list`);
    } }, names().get(g.id))));
  }

  async function tick() {
    if (closed) return;
    if (!busy && video.readyState >= 2 && window.jsQR) {
      const w = Math.min(640, video.videoWidth); const hgt = Math.round(video.videoHeight * (w / video.videoWidth));
      if (w > 0 && hgt > 0) {
        canvas.width = w; canvas.height = hgt;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        g.drawImage(video, 0, 0, w, hgt);
        const found = window.jsQR(g.getImageData(0, 0, w, hgt).data, w, hgt, { inversionAttempts: 'dontInvert' });
        const now = Date.now();
        if (found?.data && (found.data !== lastText || now - lastAt > 4000)) {
          lastText = found.data; lastAt = now; busy = true;
          try { await handle(found.data); } finally { busy = false; }
        }
      }
    }
    timer = setTimeout(tick, 180);
  }

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    overlay.remove();
    document.body.classList.remove('sheet-open');
    ctx.refresh();
  }

  drawTop();
  (async () => {
    try {
      await loadReader();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      tick();
    } catch (error) {
      say('bad', error?.message === 'reader' ? 'The scanner could not start. Close and try again.'
        : 'The camera could not open. Allow the camera for Tour Docs (iPhone: Settings > Safari > Camera, or the app\'s own settings), then try again. You can still tap names on the roll call.');
    }
  })();
  return { close };
}
