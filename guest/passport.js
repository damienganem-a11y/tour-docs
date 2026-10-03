// The virtual passport (the guest app): one stamp per destination, given when the group's first day there begins IN THAT PLACE'S OWN TIME ZONE.
// Pure and small, so the leader's tests can check it: no page, no network.

// What day is it in a time zone, as "2027-08-29"? `now` is a Date (or, to pretend, a plain "YYYY-MM-DD" string that is simply returned).
export function dayIn(timeZone, now = new Date()) {
  if (typeof now === 'string') return now;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// For each destination of the sheet: is its stamp given yet? ("2027-08-29" strings compare in date order.) `now` as for dayIn.
// Returns [{ ...destination, given: boolean, today: "YYYY-MM-DD" }], in trip order.
export function passportState(destinations, now = new Date()) {
  return (destinations ?? []).map((d) => {
    const today = dayIn(d.tz || 'UTC', now);
    return { ...d, today, given: today >= d.firstDate };
  });
}

// A small stable number from a text, so each destination keeps its own tilt and colour from one visit to the next.
export function hashOf(text) {
  let n = 0;
  for (const ch of String(text)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n;
}
const INKS = ['#e4572e', '#23805f', '#2d6cdf', '#8a4fb0', '#1f8a8a', '#c0392b'];

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The stamp as an SVG picture: two rings, the destination's name curved along the top, the country along the bottom, the date in the middle.
// `dateText` is shown as given ("29 AUG 2027"). `id` keeps the curved paths of several stamps on one page apart.
export function stampSvg(destination, dateText, id) {
  const h = hashOf(destination.name);
  const ink = INKS[h % INKS.length];
  const tilt = (h % 17) - 8;
  const name = esc(destination.name.toUpperCase());
  const country = esc((destination.country || '').toUpperCase());
  return `<svg viewBox="0 0 200 200" width="100%" height="100%" role="img" aria-label="Stamp: ${esc(destination.name)}" style="transform: rotate(${tilt}deg)">
<defs><path id="top-${id}" d="M 36 100 A 64 64 0 0 1 164 100"/><path id="bot-${id}" d="M 28 100 A 72 72 0 0 0 172 100"/></defs>
<g fill="none" stroke="${ink}" stroke-width="5"><circle cx="100" cy="100" r="92"/><circle cx="100" cy="100" r="82" stroke-width="2" stroke-dasharray="3 5"/><circle cx="100" cy="100" r="50" stroke-width="2.5"/></g>
<g fill="${ink}" font-family="Outfit, Inter, sans-serif" font-weight="800" text-anchor="middle">
<text font-size="17" letter-spacing="2"><textPath href="#top-${id}" startOffset="50%">${name}</textPath></text>
<text font-size="13" letter-spacing="3"><textPath href="#bot-${id}" startOffset="50%" side="right">${country}</textPath></text>
<text x="100" y="96" font-size="15">${esc(dateText.split(' ').slice(0, 2).join(' '))}</text>
<text x="100" y="116" font-size="13" font-weight="700">${esc(dateText.split(' ').slice(2).join(' '))}</text>
</g></svg>`;
}
