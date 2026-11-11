// A practice roll call (v0.152.0, owner's request of 11 Nov 2026): the roll call screen with eight invented guests, to try every gesture before
// the real day. NOTHING here touches a trip: no change is made, nothing is saved, nothing is sent. Closing it forgets everything.
// It looks and behaves like the real one (views/rollcall.js): choose a vehicle, tap a name, three dots for "not coming", Undo, End roll call.

import { h } from '../dom.js';
import { openFullScreen, closeFullScreen } from '../ui.js';
import { putIn } from '../put.js';
import { icon } from './icons.js';

const GUESTS = ['Anna A.', 'Ben A.', 'Carla B.', 'Dev C.', 'Elena C.', 'Felix D.', 'Greta D.', 'Hugo E.']; // invented names only

// What the coach says, from where the practice stands. Pure, so it can be tested.
//   state: { boarded: [{ name, vehicle }], away: [names], vehicle: 1 | 2, undone: boolean, ended: boolean }
export function practiceHint(state, total = GUESTS.length) {
  const left = total - state.boarded.length - state.away.length;
  if (state.ended) return 'Well done. That is all there is to it. Nothing was saved: this was only practice.';
  if (left === 0) return 'Everybody is accounted for. Tap "End roll call" at the bottom.';
  if (state.boarded.length === 0) return 'A guest arrives at the vehicle: tap their name. They are on board.';
  if (state.boarded.length < 2) return 'Good. They left the list and the count went up. Tap another name.';
  if (!state.undone) return 'Made a mistake? Tap "Undo" at the bottom: it takes back your last tap. Try it.';
  if (!state.boarded.some((b) => b.vehicle === 2)) return 'Now tap "V2" at the top, then a name: that guest goes into Vehicle 2.';
  if (state.away.length === 0) return 'One guest is not coming: tap the three dots at the end of their line.';
  return 'Carry on until the list is empty.';
}

export function openPractice() {
  let state = { boarded: [], away: [], vehicle: 1, undone: false, ended: false };
  const history = []; // the states before each tap, for Undo
  const box = h('div', { class: 'practice' });
  const change = (next, { undo = false } = {}) => { if (!undo) history.push(state); state = next; draw(); };

  function draw() {
    const waiting = GUESTS.filter((name) => !state.boarded.some((b) => b.name === name) && !state.away.includes(name));
    const inVehicle = (n) => state.boarded.filter((b) => b.vehicle === n).length;
    if (state.ended) {
      putIn(box,
        h('p', { class: 'practice-coach practice-coach--done' }, practiceHint(state)),
        h('p', { class: 'muted' }, `${state.boarded.length} on board, ${state.away.length} not coming.`),
        h('button', { class: 'btn', type: 'button', onclick: closeFullScreen }, 'Close'),
        h('button', { class: 'btn btn--plain', type: 'button', onclick: () => { history.length = 0; state = { boarded: [], away: [], vehicle: 1, undone: false, ended: false }; draw(); } }, 'Practise again'));
      return;
    }
    putIn(box,
      h('p', { class: 'practice-coach', role: 'status' }, practiceHint(state)),
      h('div', { class: 'rc-count' },
        h('span', { class: 'rc-count-big' }, String(state.boarded.length)), h('span', { class: 'rc-count-of' }, `of ${GUESTS.length - state.away.length} on board`),
        h('span', { class: 'rc-count-left' }, waiting.length === 0 ? 'Everybody is here' : `${waiting.length} still to come`)),
      h('div', { class: 'vehicles' }, [1, 2].map((n) => h('button', { class: `vehicle${state.vehicle === n ? ' is-selected' : ''}`, type: 'button', onclick: () => change({ ...state, vehicle: n }) },
        h('span', { class: 'vehicle-label' }, `V${n}`), h('span', { class: 'vehicle-count' }, `${inVehicle(n)} on board`)))),
      waiting.length === 0 ? h('p', { class: 'empty' }, 'Everybody is checked in.') : h('div', {}, waiting.map((name) => h('div', { class: 'rc-line' },
        h('button', { class: 'rc-guest', type: 'button', onclick: () => { try { navigator.vibrate?.(25); } catch { /* no buzz on this phone */ } change({ ...state, boarded: [...state.boarded, { name, vehicle: state.vehicle }] }); } },
          h('span', {}, name), h('span', { class: 'rc-tick' }, icon('check'))),
        h('button', { class: 'rc-more', type: 'button', 'aria-label': `${name}: not coming`, onclick: () => change({ ...state, away: [...state.away, name] }) }, icon('more'))))),
      h('div', { class: 'practice-bar' },
        h('button', { class: 'btn btn--plain', type: 'button', disabled: history.length === 0, onclick: () => { state = { ...history.pop(), undone: true }; draw(); } }, 'Undo'),
        h('button', { class: 'btn', type: 'button', onclick: () => change({ ...state, ended: true }) }, 'End roll call')),
      h('button', { class: 'btn btn--plain', type: 'button', onclick: closeFullScreen }, 'Stop the practice'));
  }

  draw();
  openFullScreen({ eyebrow: 'Practice: nothing is saved', title: 'Try a roll call', subtitle: 'Eight invented guests, two vehicles. Follow the line in the box.', body: box });
}
