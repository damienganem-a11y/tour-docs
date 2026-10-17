// Light / dark look of the leader's app (owner's choice, 17 Oct 2026: "Soft night" mode). A choice of this phone only: 'auto' follows the
// phone's own setting, 'light' and 'dark' force one. The colours themselves live at the end of styles.css.

const KEY = 'td-theme';
export const THEMES = [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']];

export function getTheme() {
  try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'auto'; } catch { return 'auto'; }
}

// Puts the choice on the page: data-theme on the root element (none for 'auto'), and the browser bar colour to match.
export function applyTheme() {
  const theme = getTheme();
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.style.background = dark ? '#14201f' : '#f9efdc'; // index.html paints the page before the stylesheet arrives: keep it in step
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#14201f' : '#f9efdc');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme === 'auto' ? 'light dark' : theme);
}

export function setTheme(theme) {
  try { if (theme === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, theme); } catch { /* the choice just is not kept */ }
  applyTheme();
}

// Simple mode (owner's plan, 17 Oct 2026): hides the rarely used parts (Groups, Journal, Guest links, Preview) on THIS phone, for a colleague
// who is not at ease. Nothing is removed or turned off: the screens still open by their address, and the owner can switch it back any time.
const SIMPLE_KEY = 'td-simple';
export function isSimpleMode() {
  try { return localStorage.getItem(SIMPLE_KEY) === '1'; } catch { return false; }
}
export function setSimpleMode(on) {
  try { if (on) localStorage.setItem(SIMPLE_KEY, '1'); else localStorage.removeItem(SIMPLE_KEY); } catch { /* the choice just is not kept */ }
}
