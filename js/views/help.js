// The "?" in the top bar (v0.151.0, owner's request of 10 Nov 2026: colleagues who are not at ease with phones). One tap says, in three short
// lines, what THIS screen is for and what a tap does on it. Nothing here changes anything: it only explains.

import { h } from '../dom.js';
import { openSheet } from '../ui.js';
import { icon } from './icons.js';
import { openPractice } from './practice.js';

// One entry per main screen: a title and three lines (what you see, what a tap does, how to take it back).
export const HELP = {
  today: { title: 'Today', lines: [
    'This is your starting point: the next tour, and anything that is waiting for you.',
    'Tap the next tour to open it. From there you start the roll call.',
    'Nothing on this page changes the trip: you can tap anything to look.',
  ] },
  tours: { title: 'Tours', lines: [
    'The tours of one half-day. Change the place or the day with the two lines at the top.',
    'Tap a tour to see who is on it. Tap a name to move that guest to another tour.',
    'A mistake? Tap "Undo" right after: it takes back your last change.',
  ] },
  dining: { title: 'Dining', lines: [
    'The restaurants of one evening, and who eats where.',
    'Tap a restaurant to see its tables. Tap a guest to give them a table.',
    'A mistake? Tap "Undo" right after: it takes back your last change.',
  ] },
  guests: { title: 'Guests', lines: [
    'Every guest, in alphabetical order. Type a name in the box to find someone fast.',
    'Tap a guest to see their whole trip, half-day by half-day.',
    'On a guest\'s page, tap a half-day to move them to another tour.',
  ] },
  messages: { title: 'Messages', lines: [
    '"Guests": the conversations with each guest. "Team": the chat between colleagues.',
    'Tap a conversation to read it and answer. A red number means somebody is waiting.',
    'A message cannot be changed or deleted once it is sent.',
  ] },
  rollcall: { title: 'Roll call', lines: [
    'Choose the vehicle at the top, then tap each guest as they board. They leave the list.',
    'The three dots next to a name are for a guest who is not coming, or who goes on another tour.',
    'A mistake? Tap "Undo". When everybody is on board, tap "End roll call" at the bottom.',
  ] },
};

export function openHelp(key) {
  const help = HELP[key] ?? HELP.today;
  openSheet({
    eyebrow: 'Help', title: help.title, cancelLabel: 'Got it',
    body: [
      h('ol', { class: 'help-steps' }, help.lines.map((line) => h('li', {}, line))),
      // Where a roll call is near: try one for nothing first (views/practice.js). No trip is touched.
      ['today', 'tours', 'rollcall'].includes(key) ? h('button', { class: 'btn btn--plain', type: 'button', onclick: () => openPractice() }, 'Try a practice roll call (nothing is saved)') : null,
    ],
  });
}

export function helpButton(key) {
  return h('button', { class: 'top-btn', type: 'button', 'aria-label': 'Help: what is this screen for?', onclick: () => openHelp(key) }, icon('help'), h('span', {}, 'Help'));
}
