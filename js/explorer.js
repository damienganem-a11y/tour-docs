// Passport Explorer, the trip-file side (SPEC.md, "Passport Explorer"): the optional `explorer` block of a destination, in the trip file.
// Pure and small: no page, no network. The block holds ALL the content of a destination's games (nothing is hard-coded for one place or one company):
//   status       'draft' or 'validated'. Only validated content reaches the guests. Content written by AI is always draft until the owner switches it on.
//   theme        how the destination page looks: pattern and scene names (drawn by the app's own library), colours, title typeface
//   greeting     a word in the local language, what it means, and (optional) a second greeting
//   facts        one or two short facts shown on the destination page ("Elevation 11,150 ft")
//   steps        exactly TWO: the action game and the local tradition (engine, skin, title, blurb, intro, fact). The quiz is the third step
//   questions    at least 2 per category (landmark, history, tradition, nature, food): each quiz draws one per category
//   etiquette    short tips shown once the stamp is earned
//   wrapUp       true for the last stop of a round trip (a final "welcome home" passport page): it unlocks on the trip's last day, not before arrival

export const QUIZ_CATEGORIES = ['landmark', 'history', 'tradition', 'nature', 'food'];
export const GAME_ENGINES = ['runner', 'catch', 'rhythm', 'flap', 'hidden', 'archery', 'mirror', 'spot', 'maze', 'fit', 'sequence', 'pour', 'carve', 'pipes'];
export const STAMP_NEEDED = 3; // right answers out of 5 that earn the stamp

const text = (v, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// A plain hex colour (#c0392b, or the short #fff written out in full); anything else is dropped.
const colour = (v) => (/^#[0-9a-f]{3}$/i.test(v ?? '') ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : /^#[0-9a-f]{6}$/i.test(v ?? '') ? v : null);

// A clean copy of a destination's explorer block from a trip file, or null if there is none. Never throws: content that is not good enough is
// reported by explorerProblems (shown in Warnings, and it stops the owner switching the destination on for guests).
export function cleanExplorer(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const list = (v, max) => (Array.isArray(v) ? v.map((x) => text(x)).filter(Boolean).slice(0, max) : []);
  const theme = raw.theme && typeof raw.theme === 'object' ? raw.theme : {};
  const greeting = raw.greeting && typeof raw.greeting === 'object' ? raw.greeting : {};
  return {
    status: raw.status === 'validated' ? 'validated' : 'draft',
    wrapUp: raw.wrapUp === true,
    theme: {
      pattern: text(theme.pattern, 40), page: colour(theme.page), card: colour(theme.card), surface: colour(theme.surface), accent: colour(theme.accent),
      onAccent: colour(theme.onAccent), titleFont: text(theme.titleFont, 60), stampInk: colour(theme.stampInk),
    },
    scene: text(raw.scene, 40),
    greeting: {
      word: text(greeting.word, 60), language: text(greeting.language, 40), meaning: text(greeting.meaning),
      alt: text(greeting.alt, 60), altLanguage: text(greeting.altLanguage, 40), altMeaning: text(greeting.altMeaning),
    },
    facts: list(raw.facts, 3),
    steps: (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 2).map((s) => ({
      engine: text(s?.engine, 20), skin: text(s?.skin, 30), title: text(s?.title, 80), blurb: text(s?.blurb), intro: text(s?.intro, 900), fact: text(s?.fact, 900),
    })),
    questions: (Array.isArray(raw.questions) ? raw.questions : []).map((q) => ({
      category: text(q?.category, 20), q: text(q?.q), right: text(q?.right, 200), wrong: list(q?.wrong, 3), explain: text(q?.explain, 900),
    })),
    etiquette: list(raw.etiquette, 4),
  };
}

// The guest-facing words of an explorer block (everything a guest could read), for the units check.
function guestWords(explorer) {
  return [
    explorer.greeting.meaning, explorer.greeting.altMeaning, ...explorer.facts, ...explorer.etiquette,
    ...explorer.steps.flatMap((s) => [s.title, s.blurb, s.intro, s.fact]),
    ...explorer.questions.flatMap((q) => [q.q, q.right, ...q.wrong, q.explain]),
  ].filter(Boolean);
}

// Guests read miles, feet and Fahrenheit (owner's decision). Returns the metric units found, as short quotes, e.g. ['"3,400 m"'].
export function explorerUnitWarnings(explorer) {
  if (!explorer) return [];
  const found = [];
  for (const words of guestWords(explorer)) {
    for (const m of words.matchAll(/(\d[\d,.]*)\s?(km|kilomet(?:er|re)s?|m|meters?|metres?|cm|kg|°\s?C)(?![\p{L}\d])/giu)) found.push(`"${m[0]}"`);
  }
  return [...new Set(found)];
}

// What is missing or wrong in an explorer block, as plain sentences (empty list: it can be switched on for guests).
export function explorerProblems(explorer) {
  if (!explorer) return [];
  const problems = [];
  if (!explorer.greeting.word || !explorer.greeting.meaning) problems.push('the greeting needs a word and its meaning');
  if (explorer.steps.length !== 2) problems.push('it needs exactly two steps (an action game and a local tradition)');
  explorer.steps.forEach((s, i) => {
    if (!GAME_ENGINES.includes(s.engine)) problems.push(`step ${i + 1} has an unknown game "${s.engine}"`);
    if (!s.skin || !s.title || !s.intro || !s.fact) problems.push(`step ${i + 1} needs a skin, a title, an introduction and a fact`);
  });
  for (const category of QUIZ_CATEGORIES) {
    const n = explorer.questions.filter((q) => q.category === category).length;
    if (n < 2) problems.push(`it needs at least 2 "${category}" questions (it has ${n})`);
  }
  explorer.questions.forEach((q, i) => {
    if (!QUIZ_CATEGORIES.includes(q.category)) problems.push(`question ${i + 1} has an unknown category "${q.category}"`);
    else if (!q.q || !q.right || q.wrong.length !== 3 || !q.explain) problems.push(`question ${i + 1} needs a question, the right answer, three wrong answers and an explanation`);
  });
  const metric = explorerUnitWarnings(explorer);
  if (metric.length > 0) problems.push(`guests read miles, feet and Fahrenheit: ${metric.slice(0, 3).join(', ')}`);
  return problems;
}

// "2027-09-01" minus one day, as a date (no time zone involved: these are calendar dates).
const dayBefore = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

// When a destination's games open, as { on: "2027-09-01", tz }: the moment that day begins in that time zone (owner's rule: the TRAVEL day, so the guests
// can play on the plane). Normally the day before the group's first day there; for a wrap-up destination, the trip's last day (in the last stop's zone).
export function explorerUnlock(trip, destination) {
  const dates = (d) => trip.slots.filter((s) => s.destinationId === d.id).map((s) => s.date).sort();
  if (destination.explorer?.wrapUp) {
    const last = [...trip.destinations].sort((a, b) => a.order - b.order).filter((d) => dates(d).length > 0).at(-1);
    const all = last ? dates(last) : [];
    return all.length > 0 ? { on: all.at(-1), tz: last.timeZone } : null;
  }
  const mine = dates(destination);
  return mine.length > 0 ? { on: dayBefore(mine[0]), tz: destination.timeZone } : null;
}

// What a guest's sheet carries of a destination's explorer content: nothing unless the owner validated it.
export function explorerForGuest(trip, destination) {
  const ex = destination.explorer;
  if (!ex || ex.status !== 'validated' || explorerProblems(ex).length > 0) return null;
  const unlock = explorerUnlock(trip, destination);
  if (!unlock) return null;
  const { status, ...content } = ex;
  // The games open when the guest wants (owner's decision, 26 Oct 2026): any time, from the start. The owner can switch back to "on the travel day" (trip.gamesAnytime = false).
  // `travelDay` stays the day the games would open, for the card on Today.
  const anytime = trip.gamesAnytime !== false;
  return { ...content, unlockOn: anytime ? '2000-01-01' : unlock.on, unlockTz: unlock.tz, travelDay: unlock.on };
}
