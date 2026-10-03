// Small line icons (24 x 24, drawn with strokes in the current text colour). Fixed pictures made here, never from typed text, so they are safe
// to insert as they are. Used by the Settings home (four big tiles).

const PATHS = {
  // a compass: set up the trip
  setup: '<circle cx="12" cy="12" r="9"/><polygon points="15.5,8.5 13.5,13.5 8.5,15.5 10.5,10.5" fill="currentColor" stroke="none" opacity=".9"/>',
  // two people: who has access
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 13.6c2.6.1 4.5 1.8 4.5 4.4"/>',
  // a page with lines: documents and look
  documents: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 12h6M9.5 15.5h6M9.5 9h2"/>',
  // a shield with a tick: control
  control: '<path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] ?? ''}</svg>`;
  return span;
}
