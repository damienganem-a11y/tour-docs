// Explore: a real map of each stop for the guests (v0.145.0, owner's choice "Option 1, visible offline", 5 Nov 2026). Pure: no screen, no network.
//
// trip.destinations[i].explore = {
//   dock: { lat, lng, label },            where the ship is docked (or the hotel): the anchor of the map and of "walk back"
//   backBy: '17:30' | null,                "Back on board by": shown on the map, local time of the destination
//   places: [{ id, name, kind, lat, lng, price, hours, tip }],   the team's picks, in the team's order (numbered pins)
//   streets: { path, at, size } | null     the offline street plan (a small file the app made from OpenStreetMap data, see compactStreets)
// }
// Offline: the guest's phone keeps the street plan and draws it itself (streets, river, parks), with the pins and the blue dot (GPS works without
// internet). Online, the usual detailed map pictures are shown on top. OpenStreetMap's map pictures are never downloaded in advance (their rules).

export const PLACE_KINDS = [
  { key: 'sight', label: 'Sight', emoji: '🏛' },
  { key: 'food', label: 'Food & drink', emoji: '☕' },
  { key: 'shop', label: 'Shop', emoji: '🛍' },
  { key: 'market', label: 'Market', emoji: '🧺' },
  { key: 'nature', label: 'Park & nature', emoji: '🌳' },
  { key: 'practical', label: 'Practical', emoji: 'ℹ️' },
];
export const kindOf = (key) => PLACE_KINDS.find((k) => k.key === key) ?? PLACE_KINDS[0];

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());
const okLat = (n) => Number.isFinite(n) && Math.abs(n) <= 90;
const okLng = (n) => Number.isFinite(n) && Math.abs(n) <= 180;
const round = (n) => Math.round(n * 1e6) / 1e6;

// A place from what the team pastes: a Google Maps or Apple Maps link, or the two numbers ("43.6777, 4.6309"). Returns { lat, lng } or null.
// A short link (maps.app.goo.gl/...) cannot be read without opening it: the screen then asks for the full link or the numbers.
export function parseLocation(text) {
  const t = clean(text);
  if (!t) return null;
  const pair = (a, b) => { const lat = Number(a); const lng = Number(b); return okLat(lat) && okLng(lng) ? { lat: round(lat), lng: round(lng) } : null; };
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns = [
    new RegExp(`!3d${num}!4d${num}`),            // Google: the exact place (better than the map's centre)
    new RegExp(`[?&](?:q|ll|daddr|destination|query|sll)=${num}(?:,|%2C)\\s*${num}`, 'i'), // Google/Apple ...?q=lat,lng
    new RegExp(`@${num},${num}`),                // Google: the map's centre
    new RegExp(`^${num}\\s*[,; ]\\s*${num}$`),   // just the two numbers
  ];
  for (const p of patterns) { const m = t.match(p); if (m) { const found = pair(m[1], m[2]); if (found) return found; } }
  return null;
}

// Straight-line distance in metres, and the walking time (the town's streets add about a third to the straight line; 4.5 km/h).
export function distanceMeters(a, b) {
  const R = 6371000; const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad; const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const walkMinutes = (meters) => Math.max(1, Math.round((meters * 1.3) / 75));
export function distanceText(meters) {
  return `${meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`} · ${walkMinutes(meters)} min walk`;
}
// The direction to walk, in degrees from north (for the arrow that points the way offline).
export function bearing(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

// "Take me there": the phone's own maps app with walking directions from where the guest stands.
export function directionsUrl(to, apple) {
  return apple
    ? `https://maps.apple.com/?daddr=${to.lat},${to.lng}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=walking`;
}

// A sentence when the team's Explore data is not valid (the change function refuses it), else null.
export function exploreError(explore) {
  if (explore === null) return null;
  if (!explore || typeof explore !== 'object') return 'The map data is not valid.';
  const { dock, backBy, places } = explore;
  if (dock !== null && dock !== undefined && (!okLat(dock.lat) || !okLng(dock.lng) || clean(dock.label).length > 40)) return 'The dock point is not a valid place.';
  if (backBy !== null && backBy !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(backBy)) return '"Back on board by" must look like 17:30.';
  if (!Array.isArray(places) || places.length > 40) return 'At most 40 places on a map.';
  for (const p of places) {
    if (!p || typeof p.id !== 'string' || !clean(p.name) || clean(p.name).length > 60) return 'Every place needs a name of 60 letters or fewer.';
    if (!okLat(p.lat) || !okLng(p.lng)) return `"${p.name}" has no valid place on the map.`;
    if (!PLACE_KINDS.some((k) => k.key === p.kind)) return `"${p.name}": unknown kind.`;
    if (clean(p.price).length > 40 || clean(p.hours).length > 80 || clean(p.tip).length > 300) return `"${p.name}": the price, hours or tip is too long.`;
  }
  if (explore.streets !== null && explore.streets !== undefined && (typeof explore.streets.path !== 'string' || explore.streets.path.length > 200)) return 'The offline street plan is not valid.';
  return null;
}

// What the guest's programme carries for a destination's map (null when there is nothing to show yet).
export function exploreForGuest(destination, streetsBaseUrl) {
  const ex = destination.explore;
  if (!ex || (!ex.dock && !(ex.places ?? []).length)) return null;
  return {
    dock: ex.dock ?? null, backBy: ex.backBy ?? null,
    places: (ex.places ?? []).map(({ id, name, kind, lat, lng, price, hours, tip }) => ({ id, name, kind, lat, lng, price: price || '', hours: hours || '', tip: tip || '' })),
    streets: ex.streets?.path ? `${streetsBaseUrl}${ex.streets.path}` : null,
  };
}

// ---------- The offline street plan (made by the staff app once per stop, from OpenStreetMap data, © OpenStreetMap contributors, ODbL) ----------

export const STREETS_RADIUS = 1600; // metres around the dock point (a good walk each way)
export function overpassQuery({ lat, lng }, radius = STREETS_RADIUS) {
  const around = `(around:${radius},${lat},${lng})`;
  return `[out:json][timeout:60];(
way${around}["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|service|footway|path|steps|cycleway|track)$"];
way${around}["natural"="water"];way${around}["waterway"~"^(river|canal|riverbank)$"];relation${around}["natural"="water"];
way${around}["leisure"~"^(park|garden)$"];way${around}["landuse"~"^(grass|forest)$"];
);out geom;`;
}
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const PATHS = new Set(['footway', 'path', 'steps', 'cycleway', 'track', 'pedestrian']);
const flat = (geometry) => (geometry ?? []).flatMap((p) => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]);

// Overpass answer -> { v, center, radius, major, minor, paths, water, rivers, green } with each line or area as a flat list [lat, lng, lat, lng...]
// (5 decimals: about one metre). Names are left out: the file only draws the streets.
export function compactStreets(overpass, center, radius = STREETS_RADIUS) {
  const out = { v: 1, center, radius, major: [], minor: [], paths: [], water: [], rivers: [], green: [] };
  for (const el of overpass?.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === 'way' && el.geometry?.length > 1) {
      const line = flat(el.geometry);
      if (t.highway) (MAJOR.has(t.highway) ? out.major : PATHS.has(t.highway) ? out.paths : out.minor).push(line);
      else if (t.natural === 'water' || t.waterway === 'riverbank') out.water.push(line);
      else if (t.waterway) out.rivers.push(line);
      else out.green.push(line);
    } else if (el.type === 'relation') {
      for (const m of el.members ?? []) if (m.role === 'outer' && m.geometry?.length > 1) out.water.push(flat(m.geometry));
    }
  }
  return out;
}
