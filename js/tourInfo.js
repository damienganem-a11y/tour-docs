// The information a guest can read about a tour (Phase 5, "Tour info point"): how long it lasts, what happens, how demanding it is, what to
// bring, what is included, and photos. Every part is optional; an activity with none of it simply shows its name, time and meeting point.
//
// Stored on the activity as  activity.info = { duration, description, difficulty, difficultyNote, bring, included, accessibility, photos }
// (`bring` is shown as "Good to know": dress, sun or rain, what is not allowed. `included` is no longer shown: everything is included with the private jet.)  (or no info at all).
// This file is the one place that says what is allowed, so the leader's form, the Excel import, the sample trip and the guest sheet agree.

export const DIFFICULTIES = ['easy', 'moderate', 'demanding'];
export const DIFFICULTY_LABEL = { easy: 'Easy', moderate: 'Moderate', demanding: 'Demanding' };

// What each level means in general, shown when the owner has not written a specific note. The owner's own note (distance, climb, steps,
// heat, tight spaces...) always comes first and is what makes the level precise.
export const DIFFICULTY_HELP = {
  easy: 'Suitable for most people: little walking, no steep parts.',
  moderate: 'Some walking, stairs or uneven ground. A normal level of fitness is enough.',
  demanding: 'A real effort: long distance, steep climbs or demanding conditions. Good fitness is needed.',
};

const LIMITS = { duration: 40, description: 1000, difficultyNote: 600, bring: 300, included: 200, accessibility: 400 };
const MAX_PHOTOS = 6;

// A photo address: a full https address, or a path inside the app (demo drawings, photos/ photographs). Nothing else (no scripts, no data pictures).
export const goodUrl = (url) => typeof url === 'string' && url.length <= 300 && (/^https:\/\/[^\s]+$/.test(url) || /^(demo|photos|photos\/tours)\/[A-Za-z0-9._-]+$/.test(url));

// Returns an error sentence, or null when `raw` (the fields as typed) is acceptable. Missing fields are fine.
export function tourInfoError(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') return 'The tour information is not valid.';
  for (const [field, max] of Object.entries(LIMITS)) {
    if (raw[field] !== undefined && raw[field] !== null && (typeof raw[field] !== 'string' || raw[field].trim().length > max)) {
      const names = { duration: 'The duration', description: 'The description', difficultyNote: 'The difficulty details', bring: 'The "good to know" text', included: 'The "included" line', accessibility: 'The accessibility text' };
      return `${names[field]} must be ${max} letters or fewer.`;
    }
  }
  if (raw.difficulty !== undefined && raw.difficulty !== null && raw.difficulty !== '' && !DIFFICULTIES.includes(raw.difficulty)) return 'The difficulty is Easy, Moderate or Demanding.';
  if (raw.photos !== undefined && raw.photos !== null) {
    if (!Array.isArray(raw.photos) || raw.photos.length > MAX_PHOTOS) return `A tour can have up to ${MAX_PHOTOS} photos.`;
    if (!raw.photos.every((p) => p && goodUrl(p.url) && (p.caption === undefined || (typeof p.caption === 'string' && p.caption.length <= 120)))) return 'A photo needs a web address starting with https://.';
  }
  return null;
}

// The clean stored form: trimmed text, no empty parts; null when nothing is left. `keepPhotos` is used when `raw` does not mention photos
// (the leader's form has no photo field yet, so editing text must not lose the photos).
export function cleanTourInfo(raw, keepPhotos = []) {
  if (!raw) return null;
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const photos = raw.photos === undefined || raw.photos === null ? keepPhotos : raw.photos.map((p) => ({ url: p.url, caption: text(p.caption) }));
  const info = {
    duration: text(raw.duration), description: text(raw.description),
    difficulty: DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : '',
    difficultyNote: text(raw.difficultyNote), bring: text(raw.bring), included: text(raw.included), accessibility: text(raw.accessibility), photos,
  };
  const empty = !info.duration && !info.description && !info.difficulty && !info.difficultyNote && !info.bring && !info.included && !info.accessibility && info.photos.length === 0;
  return empty ? null : info;
}
