// Reading what was written in a guest's "Allergies / dietary needs" (v0.153.0): the usual needs are recognised as short tags, so the allergy
// page can be filtered ("Gluten: 3 guests"). Pure: no screen. The full text written by the owner is always shown too: a tag only helps to find.
// Never used in an export, never in the journal (CLAUDE.md).

// [tag, words that mean it]. Order = the order of the filter chips. A severe allergy first, then intolerances, then diets.
export const DIET_TAGS = [
  ['Nuts', /\b(nut|nuts|peanut|peanuts|almond|hazelnut|walnut|cashew|pistachio|pecan)\b/i],
  ['Shellfish', /\b(shellfish|crustacean|shrimp|prawn|lobster|crab|mussel|oyster|scallop|clam)s?\b/i],
  ['Fish', /\bfish\b|\bseafood\b/i],
  ['Gluten', /\b(gluten|coeliac|celiac|wheat)\b/i],
  ['Dairy', /\b(dairy|lactose|milk|cheese|butter|cream)\b/i],
  ['Egg', /\beggs?\b/i],
  ['Sesame', /\bsesame\b/i],
  ['Soy', /\b(soy|soya)\b/i],
  ['Vegan', /\bvegan\b/i],
  ['Vegetarian', /\b(vegetarian|veggie)\b/i],
  ['Pescatarian', /\bpesc[ae]tarian\b/i],
  ['Halal', /\bhalal\b/i],
  ['Kosher', /\bkosher\b/i],
  ['No pork', /\b(no pork|pork[- ]free|without pork)\b/i],
  ['No alcohol', /\b(no alcohol|alcohol[- ]free|teetotal|non[- ]?alcoholic)\b/i],
  ['Diabetic', /\b(diabetic|diabetes|sugar[- ]free|no sugar)\b/i],
];
const SEVERE = /\b(severe|anaphyla\w*|epipen|epi-pen|life[- ]threatening|deadly)\b/i;

// The tags of one text, in the order above. "Vegan" also counts as vegetarian? No: each tag is only what is written.
export function dietTags(text) {
  const t = String(text ?? '');
  if (!t.trim()) return [];
  // "No fish" or "fish allergy" are both "Fish"; "Shellfish" alone must not also count as "Fish".
  return DIET_TAGS.filter(([tag, pattern]) => (tag === 'Fish' ? pattern.test(t.replace(/shellfish/gi, '')) : pattern.test(t))).map(([tag]) => tag);
}

// A need written as dangerous (anaphylaxis, EpiPen, severe): shown first, in red.
export const isSevere = (text) => SEVERE.test(String(text ?? ''));

// The guests with a need, the severe ones first, then by name; and how many guests carry each tag.
// guests: the trip's guests; nameOf: (guest) => shown name.
export function dietaryList(guests, nameOf) {
  const withNeed = guests.filter((g) => !g.leftAt && String(g.dietary ?? '').trim());
  const rows = withNeed.map((g) => ({ guest: g, text: g.dietary.trim(), tags: dietTags(g.dietary), severe: isSevere(g.dietary) }))
    .sort((a, b) => Number(b.severe) - Number(a.severe) || nameOf(a.guest).localeCompare(nameOf(b.guest)));
  const counts = DIET_TAGS.map(([tag]) => [tag, rows.filter((r) => r.tags.includes(tag)).length]).filter(([, n]) => n > 0);
  const other = rows.filter((r) => r.tags.length === 0).length;
  return { rows, counts, other };
}
