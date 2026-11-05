// Explore: the guest's map of a stop (v0.145.0, owner's choice "Option 1: a real map, visible offline", 5 Nov 2026).
//   - A real map they can move and zoom, the ship (or hotel), the team's places as numbered pins, and their own blue dot (GPS works without internet).
//   - Tap a pin: a card with the photo-free facts (kind, hours, price, the team's tip), how far it is from them, and "Take me there" (the phone's own maps
//     app, walking). Offline, an arrow points the way and the distance counts down.
//   - "Back on board by 17:30" at the top, with "Walk back".
//   - With signal: the usual detailed map pictures (OpenStreetMap). Without: the street plan the team prepared (kept on the phone) is drawn by the app.
// Leaflet (the map library, BSD licence) is part of the app (../vendor/leaflet), so the map itself opens offline too.

import { distanceMeters, distanceText, bearing, directionsUrl, kindOf } from '../js/explore.js';

const STREETS_CACHE = 'tourdocs-maps-v1';
let deps = null; // { h, plainHead }
export function initExplore(d) { deps = d; }

// ---------- The offline street plan: our own small file, kept in the phone's cache ----------

export async function keepStreets(url) {
  if (!url || !('caches' in window)) return null;
  try {
    const cache = await caches.open(STREETS_CACHE);
    const kept = await cache.match(url);
    if (kept) return kept.json();
    if (!navigator.onLine) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    await cache.put(url, response.clone());
    return response.json();
  } catch { return null; }
}
// Called when the programme arrives: the street plans of the stops of the next days are fetched ahead, so they are there at sea or without roaming.
export function keepUpcomingStreets(sheet, today) {
  for (const d of sheet?.destinations ?? []) {
    if (!d.map?.streets || !d.lastDate || d.lastDate < today) continue;
    keepStreets(d.map.streets);
  }
}

let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletLoading) {
    leafletLoading = new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '../vendor/leaflet/leaflet.css'; document.head.append(css);
      const script = document.createElement('script'); script.src = '../vendor/leaflet/leaflet.js';
      script.onload = () => resolve(window.L); script.onerror = () => { leafletLoading = null; reject(new Error('map library')); };
      document.head.append(script);
    });
  }
  return leafletLoading;
}

const isApple = () => /iPhone|iPad|Macintosh/.test(navigator.userAgent);

// The page. Returns { nodes, mount }: mount() runs once the page is on the screen (the map needs its box to exist).
export function exploreView(sheet, index, offlineBanner) {
  const { h, plainHead } = deps;
  const d = sheet.destinations[index];
  const map = d.map;
  const places = map.places ?? [];
  let me = null;             // { lat, lng, accuracy }
  let heading = null;        // degrees from north, when the phone gives it
  let selected = null;       // the place (or the dock) shown in the card

  const mapBox = h('div', { class: 'xm-map', role: 'application', 'aria-label': `Map of ${d.name}` });
  const card = h('div', { class: 'xm-card', hidden: true });
  const list = h('div', { class: 'xm-list' });
  const status = h('div', { class: 'xm-status', role: 'status' });
  const from = () => me ?? map.dock;

  const back = map.backBy && map.dock ? h('div', { class: 'xm-back' },
    h('span', {}, `Back on board by ${map.backBy}`),
    h('button', { type: 'button', onclick: () => select({ id: 'dock', name: map.dock.label, lat: map.dock.lat, lng: map.dock.lng, dock: true }) }, 'Walk back')) : null;

  function arrowFor(target) {
    if (!me) return null;
    const turn = (bearing(me, target) - (heading ?? 0) + 360) % 360;
    return h('span', { class: 'xm-arrow', style: `transform: rotate(${turn}deg)`, 'aria-label': heading === null ? 'Direction (north is up)' : 'Direction' }, '↑');
  }

  function drawCard() {
    if (!selected) { card.hidden = true; return; }
    const p = selected;
    const dist = from() ? distanceMeters(from(), p) : null;
    card.hidden = false;
    card.replaceChildren(...[
      h('button', { class: 'xm-close', type: 'button', 'aria-label': 'Close', onclick: () => { selected = null; drawCard(); } }, '✕'),
      h('small', {}, p.dock ? 'Back to' : `${places.indexOf(p) + 1} · ${kindOf(p.kind).emoji} ${kindOf(p.kind).label}`),
      h('b', { class: 'xm-name' }, p.name),
      dist !== null ? h('div', { class: 'xm-dist' }, arrowFor(p), `${distanceText(dist)}${me ? '' : ` from ${map.dock?.label?.toLowerCase() ?? 'the start'}`}`) : null,
      [p.hours, p.price].filter(Boolean).length ? h('div', { class: 'xm-facts' }, [p.hours, p.price].filter(Boolean).join(' · ')) : null,
      p.tip ? h('p', { class: 'xm-tip' }, p.tip) : null,
      h('a', { class: 'xm-go', href: directionsUrl(p, isApple()), target: '_blank', rel: 'noopener' }, p.dock ? 'Walk back' : 'Take me there'),
      !me ? h('button', { class: 'xm-locate', type: 'button', onclick: locate }, 'Show where I am') : null].filter(Boolean)); // an empty spot left out (it would show as "null")
  }

  function drawList() {
    list.replaceChildren(...places.map((p, i) => h('button', { class: `xm-row${selected === p ? ' is-on' : ''}`, type: 'button', onclick: () => select(p) },
      h('span', { class: 'xm-num' }, String(i + 1)),
      h('span', { class: 'xm-row-text' }, h('b', {}, p.name), h('small', {}, [`${kindOf(p.kind).emoji} ${kindOf(p.kind).label}`, p.hours, from() ? distanceText(distanceMeters(from(), p)) : null].filter(Boolean).join(' · '))))));
  }

  let leafletMap = null; let L = null; const pins = new Map(); let meDot = null; let meRing = null;
  function select(p) {
    selected = p; drawCard(); drawList();
    if (leafletMap) leafletMap.panTo([p.lat, p.lng], { animate: true });
    for (const [id, marker] of pins) marker.getElement()?.classList.toggle('is-on', id === p.id);
  }

  // The blue dot: the phone's GPS (no internet needed).
  let watching = false;
  function locate() {
    if (!navigator.geolocation) { status.textContent = 'This phone cannot give its position.'; return; }
    if (watching) { if (me && leafletMap) leafletMap.panTo([me.lat, me.lng]); return; }
    watching = true;
    status.textContent = 'Finding where you are…';
    navigator.geolocation.watchPosition((pos) => {
      const first = !me;
      me = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      status.textContent = '';
      if (leafletMap && L) {
        if (!meDot) { meRing = L.circle([me.lat, me.lng], { radius: me.accuracy, weight: 0, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }).addTo(leafletMap); meDot = L.circleMarker([me.lat, me.lng], { radius: 8, weight: 3, color: '#ffffff', fillColor: '#1a73e8', fillOpacity: 1, interactive: false }).addTo(leafletMap); }
        else { meDot.setLatLng([me.lat, me.lng]); meRing.setLatLng([me.lat, me.lng]).setRadius(me.accuracy); }
        if (first) leafletMap.panTo([me.lat, me.lng]);
      }
      drawCard(); drawList();
    }, (error) => { watching = false; status.textContent = error.code === 1 ? 'Location is not allowed for this app (phone Settings > Privacy > Location).' : 'Your position could not be found yet.'; }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    // The arrow follows the way the phone points (iPhone: asks once).
    const listen = () => window.addEventListener('deviceorientation', (e) => { const value = e.webkitCompassHeading ?? (e.absolute && e.alpha !== null ? 360 - e.alpha : null); if (value !== null && value !== undefined) { heading = value; const a = card.querySelector('.xm-arrow'); if (a && selected && me) a.style.transform = `rotate(${(bearing(me, selected) - heading + 360) % 360}deg)`; } });
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted') listen(); }).catch(() => {});
    else listen();
  }

  async function mount() {
    try { L = await loadLeaflet(); } catch { mapBox.replaceChildren(h('p', { class: 'xm-nomap' }, 'The map could not open. The list of places below still works.')); return; }
    const center = map.dock ?? places[0];
    leafletMap = L.map(mapBox, { preferCanvas: true, zoomControl: false, attributionControl: true }).setView([center.lat, center.lng], 15);
    L.control.zoom({ position: 'topright' }).addTo(leafletMap);
    leafletMap.attributionControl.setPrefix(false);
    // The street plan drawn by the app (always underneath: it is what shows when there is no signal).
    const streets = await keepStreets(map.streets);
    if (streets) {
      const lines = (list) => list.map((flat) => { const pts = []; for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]); return pts; });
      const canvas = L.canvas({ padding: 0.5 });
      L.polygon(lines(streets.green), { renderer: canvas, stroke: false, fillColor: '#cfe6c4', fillOpacity: 1, interactive: false }).addTo(leafletMap);
      L.polygon(lines(streets.water), { renderer: canvas, stroke: false, fillColor: '#aad3df', fillOpacity: 1, interactive: false }).addTo(leafletMap);
      L.polyline(lines(streets.rivers), { renderer: canvas, color: '#aad3df', weight: 10, interactive: false }).addTo(leafletMap);
      L.polyline(lines(streets.paths), { renderer: canvas, color: '#ffffff', weight: 2, dashArray: '3 3', interactive: false }).addTo(leafletMap);
      L.polyline(lines(streets.minor), { renderer: canvas, color: '#ffffff', weight: 4, interactive: false }).addTo(leafletMap);
      L.polyline(lines(streets.major), { renderer: canvas, color: '#fcd68a', weight: 6, interactive: false }).addTo(leafletMap);
      mapBox.classList.add('has-plan');
      leafletMap.attributionControl.addAttribution('© OpenStreetMap contributors');
    }
    // With signal, the detailed map pictures on top. If they fail (no signal), they are taken away and the plan shows.
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
    let failures = 0;
    tiles.on('tileerror', () => { failures += 1; if (failures >= 3 && streets && leafletMap.hasLayer(tiles)) leafletMap.removeLayer(tiles); });
    if (navigator.onLine) tiles.addTo(leafletMap);
    window.addEventListener('online', () => { failures = 0; if (leafletMap && !leafletMap.hasLayer(tiles)) tiles.addTo(leafletMap); });
    window.addEventListener('offline', () => { if (leafletMap && streets && leafletMap.hasLayer(tiles)) leafletMap.removeLayer(tiles); });

    if (map.dock) {
      L.marker([map.dock.lat, map.dock.lng], { icon: L.divIcon({ className: 'xm-dock', html: map.dock.label === 'The hotel' ? '🏨' : map.dock.label === 'The bus' ? '🚌' : map.dock.label === 'Meeting point' ? '📍' : '🚢', iconSize: [34, 34] }), title: map.dock.label })
        .addTo(leafletMap).on('click', () => select({ id: 'dock', name: map.dock.label, lat: map.dock.lat, lng: map.dock.lng, dock: true }));
    }
    places.forEach((p, i) => {
      const marker = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'xm-pin', html: `<span>${i + 1}</span>`, iconSize: [30, 30] }), title: p.name, keyboard: true })
        .addTo(leafletMap).on('click', () => select(p));
      pins.set(p.id, marker);
    });
    const all = [map.dock, ...places].filter(Boolean);
    if (all.length > 1) leafletMap.fitBounds(all.map((p) => [p.lat, p.lng]), { padding: [36, 36], maxZoom: 16 });
    if (navigator.permissions?.query) navigator.permissions.query({ name: 'geolocation' }).then((r) => { if (r.state === 'granted') locate(); }).catch(() => {});
  }

  drawList();
  const nodes = [
    plainHead('Explore', d.name),
    h('div', { class: 'atl-body xm-body' },
      offlineBanner, back, h('div', { class: 'xm-wrap' }, mapBox, h('button', { class: 'xm-me', type: 'button', 'aria-label': 'Show where I am', onclick: locate }, '◎'), card), status,
      places.length ? h('div', { class: 'block-title' }, `The team's picks (${places.length})`) : null, list,
      h('p', { class: 'foot' }, 'Map data © OpenStreetMap contributors. Distances are walking estimates.')),
  ];
  return { nodes, mount };
}

// The card on Today while the guest is at a stop that has a map.
export function exploreTodayCard(sheet, go, now = new Date()) {
  const { h } = deps;
  const dayThere = (tz) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); } catch { return now.toISOString().slice(0, 10); } };
  const index = (sheet.destinations ?? []).findIndex((d) => d.map && d.firstDate && d.firstDate <= dayThere(d.tz) && dayThere(d.tz) <= d.lastDate);
  if (index < 0) return null;
  const d = sheet.destinations[index];
  const n = d.map.places?.length ?? 0;
  return h('button', { class: 'xm-today', type: 'button', onclick: () => go({ map: index }) },
    h('small', {}, 'Explore'), h('b', {}, `Map of ${d.name}`),
    h('span', {}, `${n ? `${n} place${n === 1 ? '' : 's'} picked by the team. ` : ''}${d.map.backBy ? `Back on board by ${d.map.backBy}. ` : ''}Works without signal.`));
}
