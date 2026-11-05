// "No longer on this tour" (owner's report of 5 Nov 2026): guests who still have a colour on a tour they are no longer booked on (they changed tour after
// the colours were given). Shown at the top of the tour's own sheet in Tours (as soon as the tour is opened) and at the top of its colours page, with
// only two choices:
//   Remove them        they lose this tour's colour; everybody else keeps theirs
//   Redo the groups    starts from scratch: everybody booked on the tour now is spread over the colours again (families together, Easy Walkers to
//                      their group, groups travelling together whole when there is room)
// Both are one change each (journaled, one Undo takes it back).

import { h } from '../dom.js';
import { applyChange } from '../changes.js';
import { closeSheet, showToast } from '../ui.js';
import { displayNames, alphabetical, joinNames, tourSplitState, tourSplitPlan } from '../rules.js';

// The changes for "Redo the groups": a plan from empty colours for everybody booked now; whoever the plan could not place (no room left) and
// whoever left the tour lose their colour.
export function redoGroupsChange(trip, split) {
  const state = tourSplitState(trip, split);
  const { plan, warnings } = tourSplitPlan(trip, { ...split, assignments: {} }, state.booked.map((g) => g.id));
  const placed = new Set(plan.map((a) => a.guestId));
  const out = [...state.stale, ...state.booked.filter((g) => !placed.has(g.id))].map((g) => ({ guestId: g.id, groupId: null }));
  return { change: { type: 'assign-guests', splitId: split.id, assignments: [...plan, ...out] }, warning: warnings[0] ?? null };
}

export function staleWarning(ctx, trip, split) {
  const state = tourSplitState(trip, split);
  if (state.stale.length === 0) return null;
  const names = displayNames(trip.guests);
  const who = joinNames([...state.stale].sort(alphabetical(names)).map((g) => names.get(g.id)));
  const locked = Boolean(trip.archivedAt) || ctx.roleFor?.(trip.id) === 'viewer';
  let busy = false;
  const run = async (change, done) => {
    if (busy) return;
    busy = true;
    const result = await applyChange(ctx, trip.id, change);
    busy = false;
    if (result.ok) { closeSheet(); ctx.refresh(); showToast(done); } else showToast(result.error, true);
  };
  const n = state.stale.length;
  return h('div', { class: 'card card--warn stale-card' },
    h('div', { class: 'act-name' }, `${n === 1 ? '1 guest is' : `${n} guests are`} no longer on this tour`),
    h('div', {}, who),
    h('div', { class: 'muted' }, split.validatedAt
      ? 'They still have a colour here. The colours are validated: whatever you choose reaches the guests\' phones at once.'
      : 'They still have a colour here (a draft: guests do not see it yet).'),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn btn--small', type: 'button', disabled: locked,
        onclick: () => run({ type: 'assign-guests', splitId: split.id, assignments: state.stale.map((g) => ({ guestId: g.id, groupId: null })) }, `${n === 1 ? 'Removed' : `${n} removed`} from the colours`) }, 'Remove them'),
      h('button', { class: 'btn btn--small btn--plain', type: 'button', disabled: locked,
        onclick: () => { const { change, warning } = redoGroupsChange(trip, split); run(change, warning ?? 'The groups were made again from scratch'); } }, 'Redo the groups')));
}

// One line on the tour's closed card, so it is seen before the tour is even opened.
export function staleNote(trip, split) {
  const n = tourSplitState(trip, split).stale.length;
  return n ? h('div', { class: 'forced-note' }, `${n === 1 ? '1 guest' : `${n} guests`} no longer on this tour: open to fix the colours`) : null;
}
