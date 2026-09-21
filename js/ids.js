// Unique IDs (UUIDs) for everything the app creates: trips, guests, activities, journal entries...
//
// Every phone makes its own IDs without asking a server, and two phones can never make the same one.
// That is what lets phase 2 merge changes from several phones.
//
// We build the ID ourselves instead of using crypto.randomUUID(), because that function is
// switched off by the browser on pages that are not https (for example when testing over home wifi).

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // marks it as a "version 4" (random) UUID
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
