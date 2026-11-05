// Reception list and lounge screen (v0.144.0): which days of a sheet (js/display.js) to show now. Tiny on purpose: the TV loads only this.

// Today and tomorrow for a page (or the next two days with tours, before the trip starts): [{ day, which: 'Today' | 'Tomorrow' | label }].
export function daysToShow(sheet, now = new Date()) {
  const localDate = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const days = sheet?.days ?? [];
  if (days.length === 0) return [];
  const today = localDate(days[0].timeZone);
  const index = days.findIndex((d) => d.date >= localDate(d.timeZone));
  if (index < 0) return [];
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return days.slice(index, index + 2).map((day) => ({ day, which: day.date === today ? 'Today' : day.date === tomorrow ? 'Tomorrow' : day.label }));
}
