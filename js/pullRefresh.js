// "Pull down to refresh", like a mail app: at the very top of a screen, drag down and let go, and the app
// checks the server for changes made on your other devices (owner's request, 1 Oct 2026).
// Only watches touches; it never blocks scrolling. Does nothing while a sheet is open or when the page is
// not scrolled to the very top, so it never fights with normal scrolling.

const TRIGGER = 70; // how far to pull (in pixels) before letting go counts

export function enablePullToRefresh(onRefresh) {
  const bar = document.createElement('div');
  bar.className = 'pull-indicator';
  bar.hidden = true;
  document.body.append(bar);

  let startY = null;
  let pulled = 0;

  const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0 && !document.body.classList.contains('sheet-open');
  const reset = () => { startY = null; pulled = 0; bar.hidden = true; };

  window.addEventListener('touchstart', (event) => {
    startY = event.touches.length === 1 && atTop() ? event.touches[0].clientY : null;
    pulled = 0;
  }, { passive: true });

  window.addEventListener('touchmove', (event) => {
    if (startY === null) return;
    pulled = event.touches[0].clientY - startY;
    if (pulled <= 10 || !atTop()) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.textContent = pulled >= TRIGGER ? 'Release to refresh' : 'Pull to refresh';
    bar.classList.toggle('pull-indicator--ready', pulled >= TRIGGER);
  }, { passive: true });

  window.addEventListener('touchend', () => {
    const go = startY !== null && pulled >= TRIGGER;
    reset();
    if (go) onRefresh();
  }, { passive: true });
  window.addEventListener('touchcancel', reset, { passive: true });
}
