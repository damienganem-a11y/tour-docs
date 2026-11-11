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
  root.style.background = dark ? '#0d1110' : '#f7f8f6'; // index.html paints the page before the stylesheet arrives: keep it in step
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d1110' : '#f7f8f6');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme === 'auto' ? 'light dark' : theme);
  applyTextSize(); // the size of the text is put on the page at the same moments as the look
  applyAccent();
}

export function setTheme(theme) {
  try { if (theme === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, theme); } catch { /* the choice just is not kept */ }
  applyTheme();
}


// ---------- Size of the text (v0.151.0, owner's request of 10 Nov 2026: colleagues who read better with larger letters) ----------
// A choice of this phone only. The whole app is enlarged together (letters, buttons, spacing), so nothing overlaps: see "data-text" in staff-galerie.css.
const TEXT_KEY = 'td-text';
export const TEXT_SIZES = [['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Very large']];

export function getTextSize() {
  try { const t = localStorage.getItem(TEXT_KEY); return t === 'large' || t === 'xlarge' ? t : 'normal'; } catch { return 'normal'; }
}

export function applyTextSize() {
  const size = getTextSize();
  if (size === 'normal') document.documentElement.removeAttribute('data-text'); else document.documentElement.setAttribute('data-text', size);
}

export function setTextSize(size) {
  try { if (size === 'normal') localStorage.removeItem(TEXT_KEY); else localStorage.setItem(TEXT_KEY, size); } catch { /* the choice just is not kept */ }
  applyTextSize();
}

// ---------- The accent colour (v0.153.0): the app's brass, or the colour of the trip's company (Settings > Company look) ----------
// A choice of this phone. Inside a trip the company colour then marks the small titles, the "now" line and what is new; buttons stay dark.
const ACCENT_KEY = 'td-accent';
export const ACCENTS = [['brass', 'Brass'], ['company', 'Company colour']];
export function getAccent() { try { return localStorage.getItem(ACCENT_KEY) === 'company' ? 'company' : 'brass'; } catch { return 'brass'; } }
export function applyAccent() {
  if (getAccent() === 'company') document.documentElement.setAttribute('data-accent', 'company'); else document.documentElement.removeAttribute('data-accent');
}
export function setAccent(accent) {
  try { if (accent === 'company') localStorage.setItem(ACCENT_KEY, 'company'); else localStorage.removeItem(ACCENT_KEY); } catch { /* not kept */ }
  applyAccent();
}
