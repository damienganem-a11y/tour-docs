// Lighter programmes on the server (v0.136.0). No import here: the guest app uses this file as well as the leader's app.
// What travels to the server for each guest is the "slim" form of their sheet (version 2): the tours and the Passport games, which are the same for every
// guest, are replaced by short keys, and their content goes ONCE per trip into a shared part (table guest_shared). The guest's app puts the two together
// again (hydrateSheet) before showing anything, so everything else in the app reads an ordinary sheet (version 1). A sheet of about 105 KB becomes about 15 KB.
export const SLIM_SHEET_VERSION = 2;
// A short fingerprint of a text (the same content always gives the same key).
export function contentKey(text) {
  let n = 2166136261;
  for (let i = 0; i < text.length; i++) { n ^= text.charCodeAt(i); n = Math.imul(n, 16777619) >>> 0; }
  return n.toString(36) + text.length.toString(36);
}
// One guest's sheet -> { slim, shared: { tours: { key: tour }, ex: { key: games } } }. An ended (farewell) sheet has nothing to share: slim is the sheet itself.
export function slimSheet(sheet) {
  const shared = { tours: {}, ex: {} };
  if (!sheet || sheet.ended) return { slim: sheet, shared };
  const tours = (sheet.tours ?? []).map((tour) => { const k = contentKey(JSON.stringify(tour)); shared.tours[k] = tour; return { k, name: tour.name }; });
  const destinations = (sheet.destinations ?? []).map((d) => {
    if (!d.ex) return d;
    const { ex, ...rest } = d;
    const k = contentKey(JSON.stringify(ex));
    shared.ex[k] = ex;
    return { ...rest, exK: k };
  });
  return { slim: { ...sheet, v: SLIM_SHEET_VERSION, tours, destinations }, shared };
}
// The guest's app: a slim sheet and the trip's shared part -> the ordinary sheet (version 1). A piece missing from `shared` leaves the tour with its name only
// and the place without games, rather than failing.
export function hydrateSheet(slim, shared) {
  if (!slim || slim.v !== SLIM_SHEET_VERSION) return slim;
  const { shared: _version, ...rest } = slim;
  return {
    ...rest, v: 1, // the ordinary sheet (guestSheet.js SHEET_VERSION)
    tours: (slim.tours ?? []).map((t) => shared?.tours?.[t.k] ?? { name: t.name }),
    destinations: (slim.destinations ?? []).map((d) => { const { exK, ...place } = d; const ex = exK ? shared?.ex?.[exK] : null; return ex ? { ...place, ex } : place; }),
  };
}
