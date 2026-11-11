// Small line icons (24 x 24, drawn with strokes in the current text colour). Fixed pictures made here, never from typed text, so they are safe
// to insert as they are. Used by the Settings home (four big tiles).

const PATHS = {
  // a compass: set up the trip
  setup: '<circle cx="12" cy="12" r="9.5"/><path d="M16 8l-2.2 5.8L8 16l2.2-5.8z" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="#fff" stroke="none"/>',
  // two people: who has access
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 13.6c2.6.1 4.5 1.8 4.5 4.4"/>',
  // a page with lines: documents and look
  documents: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 12h6M9.5 15.5h6M9.5 9h2"/>',
  // three sliders: Settings (top bar of a trip)
  share: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H16"/>',
  // an envelope: the guests' messages
  envelope: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6.5L20.5 7"/>',
  bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  cog: '<path d="M4 7h8M18 7h2M4 12h2M12 12h8M4 17h9M19 17h1"/><circle cx="15" cy="7" r="2.4"/><circle cx="9" cy="12" r="2.4"/><circle cx="16" cy="17" r="2.4"/>',
  // v0.151.0: the bottom tabs, the top bar, and the pictures that were emojis before (one family of fine line drawings)
  today: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none"/>',
  tours: '<path d="M6 21V4"/><path d="M6 5h11.5l-2.5 3.5 2.5 3.5H6"/>',
  guests: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-4 3.3-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',
  messages: '<path d="M4 5.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 3.5v-3.5H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.4a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.9"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  camera: '<path d="M4 8h3.2l1.6-2.5h6.4L16.8 8H20a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.6"/>',
  pin: '<path d="M12 21.5s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11z"/><circle cx="12" cy="10.5" r="2.3"/>',
  map: '<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  undo: '<path d="M8 5L3.5 9.5 8 14"/><path d="M3.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  // a shield with a tick: control
  control: '<path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision">${PATHS[name] ?? ''}</svg>`;
  return span;
}
