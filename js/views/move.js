// The screens for changing a booking. They only ASK questions; the change itself is made by
// applyChange() in changes.js, which is the one place that changes bookings.
//
//   startMove(...)        pick another activity (or At leisure) for a guest in a half-day
//   startAddGuest(...)    pick any guest to bring into an activity
//   startCancelTour(...)  cancel an activity
//
// Moving goes: pick a place -> (travel party prompt) -> confirmation screen -> saved.

import { h } from '../dom.js';
import { openSheet, closeSheet, showToast } from '../ui.js';
import { applyChange } from '../changes.js';
import { formatTime, formatMoment } from '../time.js';
import { alphabetical, plain, displayNames, guestPlace, countIn, capacityInfo, eligibilityProblems, partyMovers, partyPlan, slotLabel, plural, joinNames } from '../rules.js';

const placeText = (place) =>
  place.kind === 'activity' ? place.activity.name :
  place.kind === 'leisure' ? 'At leisure' :
  place.kind === 'dinner' ? `dining at ${place.restaurant.name} (${place.booking.seating})` :
  place.kind === 'waitlist' ? `waitlisted for ${place.activity.name}` :
  place.kind === 'unknown' ? `unknown activity "${place.raw}"` : 'nothing chosen yet';

// ---------- Small building blocks ----------

export const notice = (text) => h('div', { class: 'notice' }, text);

// One tappable row in a list inside a sheet.
export function choiceRow({ title, detail, side, badge, current = false, disabled = false, onclick }) {
  return h('button', {
    class: `choice${current ? ' is-current' : ''}`, type: 'button', disabled, 'aria-current': current ? 'true' : null, onclick,
  },
    h('div', { class: 'choice-main' },
      h('div', { class: 'choice-title' }, title),
      detail ? h('div', { class: 'slot-detail' }, detail) : null),
    h('div', { class: 'choice-side' },
      badge ? h('div', { class: `badge ${badge.bad ? 'badge--bad' : 'badge--current'}` }, badge.text) : null,
      side ? h('div', { class: 'muted' }, side) : null));
}

// Start time in the destination's local time, then the meeting point.
function activityDetail(trip, slot, activity) {
  const destination = trip.destinations.find((d) => d.id === slot.destinationId);
  return [activity.startsAt ? formatTime(activity.startsAt, destination.timeZone) : '', activity.meeting].filter(Boolean).join(' · ');
}

// ---------- 1. Pick a place for a guest ----------

// True, with a toast, if the trip is archived: read-only, no booking changes. Every screen that starts
// a change (a tap on a guest, Add guest, Cancel tour, roll call...) checks this FIRST, before opening
// anything, so an archived trip never lets you get halfway through a change only to be refused at the end.
function blockedIfArchived(trip) {
  if (!trip.archivedAt) return false;
  showToast('This trip is archived: read-only. Un-archive it on the Trips screen to make changes.', true);
  return true;
}

// guest, slot: who and which half-day. Called from a tap on a guest anywhere in the app.
// options.askParty === false: no travel party question (the roll call: speed first).
export function startMove(ctx, trip, guest, slot, options = {}) {
  if (blockedIfArchived(trip)) return;
  const names = displayNames(trip.guests);
  const here = guestPlace(trip, guest, slot);

  const leisureRow = choiceRow({
    title: 'At leisure', detail: 'Not on any of our tours',
    badge: here.kind === 'leisure' ? { text: '✓ Current' } : null, current: here.kind === 'leisure',
    onclick: () => afterPick(ctx, trip, guest, slot, { kind: 'leisure' }, options),
  });

  const activityRows = trip.activities.filter((a) => a.slotId === slot.id).map((activity) => {
    const count = capacityInfo(countIn(trip, activity), activity.capacity);
    const isCurrent = here.kind === 'activity' && here.activity.id === activity.id;
    const full = activity.capacity !== null && countIn(trip, activity) >= activity.capacity;
    // A full activity can still be chosen: the dispatcher may FORCE it (the confirmation warns first).
    // A cancelled one cannot be chosen at all.
    return choiceRow({
      title: activity.name, detail: activityDetail(trip, slot, activity), side: activity.cancelled ? null : count.text,
      current: isCurrent,
      badge: activity.cancelled ? { text: 'Cancelled', bad: true } : isCurrent ? { text: '✓ Current' } : full ? { text: 'Full', bad: true } : null,
      disabled: activity.cancelled,
      onclick: () => (isCurrent ? closeSheet() : afterPick(ctx, trip, guest, slot, { kind: 'activity', activity }, options)),
    });
  });

  openSheet({
    eyebrow: 'Move',
    title: names.get(guest.id),
    subtitle: `${slotLabel(trip, slot)} · now: ${placeText(here)}`,
    body: [leisureRow, ...activityRows],
  });
}

// ---------- The story of a forced move ----------

// Shown when you tap a guest who is in a full tour because the move was forced: who approved it, who added
// them, when, and from where. From here you can also move the guest.
export function showForcedInfo(ctx, trip, guest, slot, entry) {
  const names = displayNames(trip.guests);
  const activity = trip.activities.find((a) => a.id === entry.to.activityId);
  const fact = (label, value) => h('div', { class: 'line' }, h('span', { class: 'muted' }, label), h('strong', {}, value));

  openSheet({
    eyebrow: 'Forced into a full tour',
    title: names.get(guest.id),
    subtitle: `${entry.to.label} · ${slotLabel(trip, slot)}`,
    body: [
      h('div', { class: 'card' },
        fact('Approved by', entry.approvedBy ?? 'Not written down'),
        fact('Added by', entry.who.name),
        entry.forceReason ? fact('Reason', entry.forceReason) : null,
        // Shown in the local time of the place, with the place named.
        fact('When', `${formatMoment(entry.at, entry.place.timeZone)} ${entry.place.name} time`),
        fact('Moved from', entry.from.kind === 'blank' ? 'Nothing chosen yet' : entry.from.label),
        activity ? fact('The tour now', capacityInfo(countIn(trip, activity), activity.capacity).text) : null),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: () => startMove(ctx, trip, guest, slot) }, 'Move this guest'),
    ],
    cancelLabel: 'Close',
  });
}

// ---------- 2. Add a guest to an activity ----------

// Search all guests, see where each one is now, tap one to bring them into this activity.
// (During a roll call the guest just joins the tour and appears in the list; they are NOT put in a vehicle.)
export function startAddGuest(ctx, trip, slot, activity) {
  if (blockedIfArchived(trip)) return;
  const names = displayNames(trip.guests);
  const guests = trip.guests.filter((g) => !g.leftAt).sort(alphabetical(names)); // a guest who left is brought back in Settings, not here
  const list = h('div', {});
  const now = countIn(trip, activity);
  const full = activity.capacity !== null && now >= activity.capacity;

  function fill() {
    const words = plain(search.value).split(/\s+/).filter(Boolean);
    const shown = guests.filter((g) => words.every((w) => plain(`${g.first} ${g.last}`).includes(w)));
    list.replaceChildren(...(shown.length === 0
      ? [h('p', { class: 'empty' }, 'No guest matches that search.')]
      : shown.map((guest) => {
          const here = guestPlace(trip, guest, slot);
          const already = here.kind === 'activity' && here.activity.id === activity.id;
          return choiceRow({
            title: names.get(guest.id), detail: `Now: ${placeText(here)}`,
            badge: already ? { text: '✓ Already here' } : null, disabled: already,
            onclick: () => afterPick(ctx, trip, guest, slot, { kind: 'activity', activity }),
          });
        })));
  }

  const search = h('input', {
    class: 'text-input', type: 'search', placeholder: 'Search guests',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search guests', oninput: fill,
  });
  fill();

  openSheet({
    eyebrow: 'Add guest',
    title: activity.name,
    subtitle: `${slotLabel(trip, slot)} · ${capacityInfo(now, activity.capacity).text}`,
    body: [full ? notice(`This tour is full (${now} / ${activity.capacity}). Adding a guest needs FORCE: you will be asked to confirm.`) : null, search, list],
  });
}

// ---------- 3. Travel party prompt ----------

// After a place is picked: if the guest travels with people who are in the same place, ask whether to
// move them too. Splitting a party must stay possible. The question is asked the same way whether the
// tour has room or not:
//   - there is room for everyone: Yes and No both save the move straight away (the question IS the confirmation);
//   - not everyone fits: the question says so, and whatever does not fit goes to the FORCE confirmation
//     (the dispatcher decides, and may write who approved it).
function afterPick(ctx, trip, guest, slot, target, options = {}) {
  const plan = partyPlan(trip, guest, slot, target);
  const { movers, room } = plan;
  // Age rules count like capacity: a move that breaks one goes to the FORCE confirmation.
  const clean = (people) => target.kind !== 'activity' || eligibilityProblems(trip, target.activity, people.map((g) => g.id)).length === 0;
  const guestFits = plan.guestFits && clean([guest]);
  const everyoneFits = plan.everyoneFits && clean([guest, ...movers]);
  if (movers.length === 0 || options.askParty === false) return confirmMove(ctx, trip, guest, slot, target, [], options);

  if (movers.length >= 2) { familySheet(ctx, trip, guest, slot, target, movers); return; }

  const withParty = moveFacts(trip, guest, slot, target, movers);
  const alone = moveFacts(trip, guest, slot, target, []);
  const moverNames = joinNames([...movers].sort(alphabetical(alone.names)).map((m) => alone.names.get(m.id)));

  // What to say about the room in the target tour.
  let roomNote = null;
  if (target.kind === 'activity' && target.activity.capacity !== null) {
    const tour = target.activity;
    const now = countIn(trip, tour);
    if (!plan.guestFits) roomNote = `"${tour.name}" is full (${now} / ${tour.capacity}). Moving anyone in needs FORCE.`;
    else if (!plan.everyoneFits) roomNote = `Only ${plural(room, 'seat')} left in "${tour.name}". Moving everyone makes it ${now + 1 + movers.length} / ${tour.capacity}: that needs FORCE.`;
    else if (room <= 3) roomNote = `Only ${plural(room, 'seat')} left in "${tour.name}".`;
  }

  // Yes: everyone. No: only the tapped guest. Either one goes to the FORCE confirmation if it does not fit.
  const yes = () => (everyoneFits ? saveChanges(ctx, trip, withParty.changes, withParty.done) : confirmMove(ctx, trip, guest, slot, target, movers));
  const no = () => (guestFits ? saveChanges(ctx, trip, alone.changes, alone.done) : confirmMove(ctx, trip, guest, slot, target, []));

  // Taking someone off a dinner table says so in words ("remove"), since the party question is easy to
  // mistake for something else when the destination is just "At leisure".
  const leavingTable = guestPlace(trip, guest, slot).kind === 'dinner' && target.kind !== 'dinner';
  openSheet({
    eyebrow: 'Travel party', title: leavingTable ? 'Also remove their travel party from the table?' : 'Also move their travel party?',
    subtitle: `Move ${alone.who}${alone.from} to ${alone.to} · ${alone.detail}`,
    body: [
      roomNote ? notice(roomNote) : null,
      h('button', { class: 'btn', type: 'button', onclick: yes }, leavingTable ? `Yes, remove ${moverNames} too` : `Yes, move ${moverNames} too`),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: no }, `No, only ${alone.who}`),
    ],
    cancelDanger: true,
  });
}

// A bigger family (two or more others in the same place): a checklist instead of Yes/No, so you tick exactly who goes
// (grandparents and children together, a parent staying behind...). Ages are shown, and a line under the list says at once
// whether the choice breaks a rule (a child with no adult of the family, a minimum age) or does not fit. Then the usual
// confirmation (which asks for FORCE when needed).
function familySheet(ctx, trip, guest, slot, target, movers) {
  const names = displayNames(trip.guests);
  const everyone = [guest, ...movers].sort(alphabetical(names));
  const checked = new Set(everyone.map((g) => g.id));
  const label = (g) => `${names.get(g.id)}${typeof g.age === 'number' ? ` · ${g.age}` : ''}${g.id === guest.id ? ' (tapped)' : ''}`;
  const say = h('div', { class: 'notice' });
  const go = h('button', { class: 'btn', type: 'button' }, '');
  const chosen = () => everyone.filter((g) => checked.has(g.id));
  function update() {
    const group = chosen();
    const lines = [];
    if (target.kind === 'activity') {
      const problems = eligibilityProblems(trip, target.activity, group.map((g) => g.id));
      if (problems.length > 0) lines.push(`${problems[0].text}${problems.length > 1 ? `, and ${plural(problems.length - 1, 'other problem')}` : ''}. This needs FORCE.`);
      if (target.activity.capacity !== null) {
        const room = target.activity.capacity - countIn(trip, target.activity);
        if (room < group.length) lines.push(`"${target.activity.name}" has ${room > 0 ? plural(room, 'seat') : 'no seat'} left for ${group.length}: that needs FORCE.`);
      }
    }
    say.textContent = lines.length ? lines.join(' ') : 'Nothing in the way.';
    say.classList.toggle('notice--calm', lines.length === 0);
    go.textContent = group.length === 0 ? 'Tick at least one person' : `Move ${group.length === 1 ? names.get(group[0].id) : `${group.length} people`}`;
    go.disabled = group.length === 0;
    go.onclick = () => {
      if (group.length === 0) return;
      const lead = group.find((g) => g.id === guest.id) ?? group[0];
      closeSheet();
      const rest = group.filter((g) => g.id !== lead.id);
      const facts = moveFacts(trip, lead, slot, target, rest);
      const fits = target.kind !== 'activity' || (lines.length === 0);
      if (fits) saveChanges(ctx, trip, facts.changes, facts.done); else confirmMove(ctx, trip, lead, slot, target, rest);
    };
  }
  update();
  const rows = everyone.map((g) => {
    const box = h('input', { type: 'checkbox', checked: true, 'aria-label': names.get(g.id) });
    box.addEventListener('change', () => { if (box.checked) checked.add(g.id); else checked.delete(g.id); update(); });
    return h('label', { class: 'tick-row' }, box, h('span', {}, label(g)));
  });
  openSheet({
    eyebrow: 'Travel party', title: 'Who goes?', subtitle: `${slotLabel(trip, slot)} · to ${target.kind === 'leisure' ? 'At leisure' : target.activity.name}`,
    body: [...rows, say], footer: [go], cancelLabel: 'Cancel', cancelDanger: true,
  });
}

// What a move says about itself: the words for the screens, and the list of changes to apply.
// group: the guests moving together (the tapped guest, and party members if you said Yes).
function moveFacts(trip, guest, slot, target, movers, options = {}) {
  const names = displayNames(trip.guests);
  const group = [guest, ...movers];
  const who = joinNames([...group].sort(alphabetical(names)).map((g) => names.get(g.id)));
  const here = guestPlace(trip, guest, slot);
  const to = target.kind === 'leisure' ? 'At leisure' : target.activity.name;
  const from = here.kind === 'blank' ? '' : ` from ${here.kind === 'unknown' ? `"${here.raw}"` : placeText(here)}`;
  const detail = target.kind === 'activity'
    ? `${slotLabel(trip, slot)} · ${activityDetail(trip, slot, target.activity)}`
    : slotLabel(trip, slot);
  const changes = group.map((g) => ({
    type: 'move', guestId: g.id, slotId: slot.id,
    to: target.kind === 'leisure' ? { kind: 'leisure' } : { kind: 'activity', activityId: target.activity.id },
  }));
  return { names, group, who, here, to, from, detail, changes, done: `Moved ${who} to ${to}` };
}

// ---------- 4. Confirmation screen ----------

function confirmMove(ctx, trip, guest, slot, target, movers, options = {}) {
  const { names, group, who, here, to, from, detail, changes, done } = moveFacts(trip, guest, slot, target, movers, options);

  // Warnings (shown in the warning colour): a full tour, a nearly full tour, a split travel party.
  const warnings = [];
  const limited = target.kind === 'activity' && target.activity.capacity !== null;
  const roomBefore = limited ? target.activity.capacity - countIn(trip, target.activity) : Infinity;
  const partyHere = partyMovers(trip, guest, slot);
  // (In a roll call nobody asks about the travel party, so there is nobody "left behind" to warn about.)
  const leftBehind = options.askParty === false ? [] : partyHere.filter((m) => !movers.includes(m));

  // The group does not fit in the tour: the dispatcher can still decide to put them in, by FORCING it.
  const overCapacity = limited && roomBefore < group.length;
  const ageProblems = target.kind === 'activity' ? eligibilityProblems(trip, target.activity, group.map((g) => g.id)) : [];
  const needsForce = overCapacity || ageProblems.length > 0;

  for (const problem of ageProblems) warnings.push(`${problem.text}. Moving them needs FORCE, with a reason.`);
  if (overCapacity) {
    const now = countIn(trip, target.activity);
    warnings.push(`"${target.activity.name}" is full (${now} / ${target.activity.capacity}). Forcing this makes it ${now + group.length} / ${target.activity.capacity}.`);
    if (leftBehind.length > 0) {
      const stay = leftBehind.length === 1 ? 'stays' : 'stay';
      warnings.push(`Their travel party will be split: ${joinNames(leftBehind.map((m) => names.get(m.id)))} ${stay} in ${placeText(here)}.`);
    }
  } else if (leftBehind.length > 0) {
    // (Party members are only "in the same place" when the guest is in an activity or At leisure.)
    const stay = leftBehind.length === 1 ? 'stays' : 'stay';
    warnings.push(`Their travel party will be split: ${joinNames(leftBehind.map((m) => names.get(m.id)))} ${stay} in ${placeText(here)}.`);
  }
  // A nearly full tour.
  if (limited && !overCapacity && !needsForce) {
    const left = roomBefore - group.length;
    if (left === 0) warnings.unshift(`Only ${plural(roomBefore, 'seat')} left: the tour will be full after this.`);
    else if (left <= 3) warnings.unshift(`${plural(left, 'seat')} left after this.`);
  }

  // When forcing is needed, the dispatcher gets a second option: join the tour's waitlist instead of
  // overriding capacity. Never offered otherwise — there is no waitlist to join when there is room.
  const secondary = overCapacity && target.kind === 'activity'
    ? {
        label: `Add ${who} to the waitlist instead`,
        changes: group.map((g) => ({ type: 'move', guestId: g.id, slotId: slot.id, to: { kind: 'waitlist', activityId: target.activity.id } })),
        done: `${who} added to the waitlist for "${target.activity.name}"`,
      }
    : null;

  confirmSheet(ctx, trip, {
    title: `Move ${who}${from} to ${to}?`, detail, warnings,
    confirmLabel: needsForce ? 'Force move' : 'Confirm', force: needsForce, forceEyebrow: overCapacity ? 'Over capacity' : 'Needs a decision', changes, done, secondary,
  });
}

// ---------- Promote a waitlisted guest ----------

// A seat has freed up on a full tour: offer the first waitlisted guest that seat. Reached from the
// waitlist card's one-tap proposal (destination.js), not the Move sheet. Reuses the ordinary "pick a
// place" flow (the travel-party prompt, then confirm) — promotion is never automatic, and never
// bypasses capacity: it is simply already known there is room, since the card only shows the proposal
// once countIn(trip, activity) < activity.capacity.
export function proposePromotion(ctx, trip, guest, slot, activity) {
  if (blockedIfArchived(trip)) return;
  afterPick(ctx, trip, guest, slot, { kind: 'activity', activity });
}

// ---------- Cancel tour ----------

export function startCancelTour(ctx, trip, slot, activity) {
  if (blockedIfArchived(trip)) return;
  const booked = countIn(trip, activity);
  confirmSheet(ctx, trip, {
    title: `Cancel ${activity.name}?`,
    detail: `${slotLabel(trip, slot)} · ${activityDetail(trip, slot, activity)}`,
    warnings: [booked === 0 ? 'Nobody is booked on it. It will stay visible as Cancelled.'
      : `${plural(booked, 'guest')} will move to At leisure. The tour stays visible as Cancelled.`],
    confirmLabel: 'Cancel this tour', danger: true, cancelLabel: 'Keep the tour',
    changes: [{ type: 'cancel-tour', activityId: activity.id }], done: `${activity.name} is cancelled`,
  });
}

// Makes the change (through the one change function), then closes the sheet and redraws the screen.
// If the change is refused, the sheet stays open with a message, so nothing is lost.
let saving = false; // ignore a second tap while the first is still being saved
async function saveChanges(ctx, trip, changes, done) {
  if (saving) return;
  saving = true;
  const result = await applyChange(ctx, trip.id, changes);
  saving = false;
  if (result.ok) {
    closeSheet();
    ctx.refresh();
    showToast(result.requested ? 'Request sent to the owner. It shows here once applied.' : done);
  } else {
    showToast(result.error, true);
  }
}

// The confirmation sheet: a summary, warnings, one Confirm button, and an optional second button
// (secondary: {label, changes, done} — e.g. "Add to the waitlist instead").
// A tour cancellation or a forced move has its own red button, so there the Cancel button stays plain.
// force: the move goes into a full tour. The button says "Force move", and an optional box lets you write
// who approved it ("Approved by Sam"); it is saved in the journal with the move.
function confirmSheet(ctx, trip, { title, detail, warnings, confirmLabel, danger = false, force = false, forceEyebrow = 'Over capacity', cancelLabel, changes, done, secondary = null }) {
  // The owner may write who approved it (optional). A Team colleague cannot force: they ASK, with a reason the owner reads, and the owner decides.
  const asking = force && ctx.roleFor?.(trip.id) === 'team';
  const approval = force
    ? (asking
      ? h('textarea', { class: 'text-input approval-input', rows: '3', maxlength: '200', placeholder: 'Why must this one be forced? (required)', 'aria-label': 'Why must this one be forced?' })
      : h('input', {
        class: 'text-input approval-input', type: 'text', placeholder: 'Approved by (optional)', 'aria-label': 'Approved by (optional)',
        maxlength: '60', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false',
      }))
    : null;

  const confirmButton = h('button', {
    class: `btn${danger || force ? ' btn--danger' : ''}`, type: 'button',
    onclick: () => {
      if (asking && !approval.value.trim()) { showToast('Write why this move must be forced.', true); return; }
      saveChanges(
        ctx, trip,
        force ? changes.map((change) => (asking ? { ...change, force: true, forceReason: approval.value.trim() } : { ...change, force: true, approvedBy: approval.value })) : changes,
        force ? (asking ? `${done} (asked: the owner decides)` : `${done} (forced)`) : done);
    },
  }, asking ? 'Ask to force' : confirmLabel);

  const secondaryButton = secondary
    ? h('button', { class: 'btn btn--plain', type: 'button', onclick: () => saveChanges(ctx, trip, secondary.changes, secondary.done) }, secondary.label)
    : null;

  openSheet({
    eyebrow: force ? forceEyebrow : 'Confirm change', title, subtitle: detail,
    // A colleague's choices are laid out so both are visible at once: the waiting list first (no one has to decide), then "ask the owner to force it" with its reason.
    body: asking
      ? [warnings.map(notice), secondaryButton, h('div', { class: 'form-label' }, 'Or ask the owner to force it'), approval, confirmButton, notice('The owner decides. They will see your reason, and can approve it, put the guest on the waiting list instead, or decline.')]
      : [warnings.map(notice), approval, confirmButton, secondaryButton],
    cancelLabel, cancelDanger: !(danger || force),
  });
}
