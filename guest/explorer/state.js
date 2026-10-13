// Passport Explorer, the guest's progress (SPEC.md, "Passport Explorer"). Pure and small, so the leader's tests can check every rule: no page, no network.
// Progress belongs to the guest's phone ONLY: it is not trip data, it never goes to the server and it never goes through the journal.
//
// One entry per destination, found by its key (name + first date, like the passport stamps):
//   { steps: [bool, bool], stars: [n, n, n], best: n, stamp: "2027-08-29" | null }
//   steps    the two games (action, local tradition): playing one to the end, WIN OR LOSE, completes it (nobody gets stuck on a game)
//   stars    0 or 1 for each of the three steps (two games and the quiz): a bonus, it only ever goes up
//   best     the best quiz score so far (right answers out of 5)
//   stamp    the day the stamp was earned: 3 right answers out of 5 in the quiz. A retry never takes it away.

export const STAMP_NEEDED = 3;
export const QUIZ_LENGTH = 5;

import { dayIn } from '../passport.js';

export const emptyEntry = () => ({ steps: [false, false], stars: [0, 0, 0], best: 0, stamp: null });

// The entry of a destination in the whole progress object (a fresh one when there is none yet; never stored by this call).
export const entryOf = (all, key) => ({ ...emptyEntry(), ...(all?.[key] ?? {}) });

// Is the destination's explorer open? It opens when the TRAVEL day begins (the day before the first day there; for a wrap-up, the trip's last day),
// in the time zone the sheet names, so a guest can play on the plane. `now` is a Date, or a plain "YYYY-MM-DD" to pretend.
export function explorerOpen(ex, now = new Date()) {
  return Boolean(ex) && dayIn(ex.unlockTz || 'UTC', now) >= ex.unlockOn;
}

// Steps open in order: the first game, then the second, then the quiz (which needs both games done).
export function stepOpen(entry, index) {
  return index === 0 || (index === 1 && entry.steps[0]) || (index === 2 && entry.steps[0] && entry.steps[1]);
}

// A game played to the end (won or lost): the step is done, and a star is added only if it was won well.
export function finishStep(entry, index, star) {
  const steps = [...entry.steps]; steps[index] = true;
  const stars = [...entry.stars]; stars[index] = Math.max(stars[index], star ? 1 : 0);
  return { ...entry, steps, stars };
}

// A quiz finished with `score` right answers out of 5, on `today`. The stamp is earned from 3 right answers and is never removed; the best score and
// the stars only go up.
export function finishQuiz(entry, score, today) {
  const stars = [...entry.stars]; stars[2] = Math.max(stars[2], score === QUIZ_LENGTH ? 1 : 0);
  return { ...entry, stars, best: Math.max(entry.best, score), stamp: entry.stamp ?? (score >= STAMP_NEEDED ? today : null) };
}

// The totals at the top of the Passport: stamps earned and stars won.
export function totals(all, keys) {
  let stamps = 0, stars = 0;
  for (const key of keys) { const e = entryOf(all, key); if (e.stamp) stamps++; stars += e.stars.reduce((a, b) => a + b, 0); }
  return { stamps, stars };
}

// A quiz: one question of each category, drawn at random, answers shuffled. `rnd` is Math.random (or a seeded one, to test). `lastIds` are the ids
// of the previous quiz: when a category has two questions or more, the same one is never drawn twice in a row.
export function drawQuiz(questions, categories, rnd = Math.random, lastIds = []) {
  const quiz = [];
  for (const category of categories) {
    const pool = questions.map((q, id) => ({ q, id })).filter((x) => x.q.category === category);
    if (pool.length === 0) continue;
    const fresh = pool.filter((x) => !lastIds.includes(x.id));
    const choices = fresh.length > 0 ? fresh : pool;
    const { q, id } = choices[Math.floor(rnd() * choices.length)];
    const options = [q.right, ...q.wrong].map((text) => ({ text, right: text === q.right }));
    for (let i = options.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [options[i], options[j]] = [options[j], options[i]]; }
    quiz.push({ id, category, q: q.q, options, explain: q.explain });
  }
  return quiz;
}
