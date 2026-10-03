// Reading a trip from an Excel file (.xlsx), so a real trip can be set up from the guest list and the programme the owner already has.
//
// Two parts:
//   readXlsx(bytes)            the file -> its sheets, as rows of plain values (an .xlsx is a .zip of small XML files)
//   tripRawFromWorkbook(...)   the sheets -> the same "raw trip" the .json files hold, which loader.js's buildTrip then checks and turns
//                              into a trip. So an Excel import and a .json import end in exactly the same place.
//
// The expected sheets are those of the sample trip's Excel file (Tour_Docs_sample_trip_ZX-01.xlsx):
//   Itinerary   Day, Date, Stop, Destination, Country, Time zone (Note is ignored)
//   Guests      Guest ID, First name, Last name, Party ID, Party type, Dietary / allergies, Notes (Joins at stop... are ignored)
//   Activities  Slot ID, Day, Date, Destination, Half-day, Activity, Start, Meeting point, Capacity, and optional Duration, Difficulty
//               (Easy / Moderate / Demanding), Difficulty details, Description, What to bring, Included
//   Sign-ups    Guest ID, Slot ID, Activity            (optional: who chose what; "At leisure" is a status)
// Column names are found by their heading, in any order and in any case. Every problem is reported in plain words.

// ---------- 1. The file: a .zip of XML parts ----------

const u16 = (view, at) => view.getUint16(at, true);
const u32 = (view, at) => view.getUint32(at, true);

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Every part of the zip, by name: { name -> bytes }.
async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = bytes.length - 22; // the "end of central directory" record sits at the very end (22 bytes, unless there is a comment)
  while (end >= 0 && u32(view, end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('This file is not an Excel (.xlsx) file.');
  const count = u16(view, end + 10);
  let at = u32(view, end + 16); // where the list of parts starts
  const parts = {};
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(view, at) !== 0x02014b50) throw new Error('This Excel file seems damaged.');
    const method = u16(view, at + 10);
    const compressedSize = u32(view, at + 20);
    const nameLength = u16(view, at + 28), extraLength = u16(view, at + 30), commentLength = u16(view, at + 32);
    const localAt = u32(view, at + 42);
    const name = decoder.decode(bytes.slice(at + 46, at + 46 + nameLength));
    const dataAt = localAt + 30 + u16(view, localAt + 26) + u16(view, localAt + 28);
    const raw = bytes.slice(dataAt, dataAt + compressedSize);
    parts[name] = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
    if (parts[name] === null) throw new Error('This Excel file uses a compression this app cannot read.');
    at += 46 + nameLength + extraLength + commentLength;
  }
  return parts;
}

// ---------- 2. The sheets ----------

const xml = (bytes) => new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
const textOf = (node) => [...node.getElementsByTagName('t')].map((t) => t.textContent).join('');
const columnNumber = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// The file -> { sheetName: [ [cell, cell, ...], ... ] } (a cell is text, a number, a true/false, or null when empty).
export async function readXlsx(buffer) {
  const parts = await unzip(buffer);
  const need = (name) => { if (!parts[name]) throw new Error('This Excel file seems incomplete.'); return parts[name]; };

  const shared = parts['xl/sharedStrings.xml'] ? [...xml(parts['xl/sharedStrings.xml']).getElementsByTagName('si')].map(textOf) : [];
  const rels = new Map([...xml(need('xl/_rels/workbook.xml.rels')).getElementsByTagName('Relationship')].map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const sheets = {};
  for (const sheet of xml(need('xl/workbook.xml')).getElementsByTagName('sheet')) {
    const target = rels.get(sheet.getAttribute('r:id'));
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const rows = [];
    for (const row of xml(need(path)).getElementsByTagName('row')) {
      const values = [];
      for (const cell of row.getElementsByTagName('c')) {
        const type = cell.getAttribute('t');
        const v = cell.getElementsByTagName('v')[0]?.textContent;
        let value = null;
        if (type === 's') value = shared[Number(v)] ?? null;
        else if (type === 'inlineStr') value = textOf(cell);
        else if (type === 'str' || type === 'e') value = v ?? null;
        else if (type === 'b') value = v === '1';
        else if (v !== undefined && v !== '') value = Number(v);
        values[columnNumber(cell.getAttribute('r').replace(/\d+/g, ''))] = value;
      }
      rows[Number(row.getAttribute('r')) - 1] = values;
    }
    sheets[sheet.getAttribute('name')] = Array.from(rows, (r) => r ?? []);
  }
  return sheets;
}

// ---------- 3. The sheets -> a raw trip ----------

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

// An Excel date (a day number, or text like 2027-01-12) -> "2027-01-12", or null.
export function toIsoDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const text = clean(v);
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return iso ? `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}` : null;
}

// An Excel time (a fraction of a day, or text like 15:00) -> "15:00", or null when empty.
export function toClock(v) {
  if (typeof v === 'number' && v >= 0 && v < 1) { const minutes = Math.round(v * 1440); return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }
  const m = clean(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

// Finds a sheet whatever its capitals or spaces; reads its heading row; returns objects keyed by the wanted column names.
function table(sheets, wantedName, columns, { required = true } = {}) {
  const key = Object.keys(sheets).find((n) => n.trim().toLowerCase() === wantedName.toLowerCase());
  if (!key) { if (required) throw new Error(`The Excel file has no sheet called "${wantedName}".`); return null; }
  const rows = sheets[key];
  const head = (rows[0] ?? []).map((h) => clean(h).toLowerCase());
  const index = {};
  for (const [name, { heading, optional }] of Object.entries(columns)) {
    const at = head.findIndex((h) => h === heading.toLowerCase());
    if (at === -1 && !optional) throw new Error(`The sheet "${key}" needs a column called "${heading}".`);
    index[name] = at;
  }
  const out = [];
  rows.slice(1).forEach((row, i) => {
    const item = { row: i + 2 };
    for (const [name, at] of Object.entries(index)) item[name] = at === -1 ? null : (row[at] ?? null);
    if (Object.values(item).some((v, k) => k > 0 && clean(v) !== '')) out.push(item);
  });
  return { sheet: key, rows: out };
}

// Returns { raw, summary, warnings }. `raw` goes to loader.js's buildTrip. Throws a plain-language Error for what cannot be used.
export function tripRawFromWorkbook(sheets, { name, code = '' }) {
  const warnings = [];

  // Itinerary -> destinations (one per stop), and the trip's first day and length
  const itin = table(sheets, 'Itinerary', {
    day: { heading: 'Day' }, date: { heading: 'Date' }, stop: { heading: 'Stop' }, destination: { heading: 'Destination' },
    country: { heading: 'Country', optional: true }, zone: { heading: 'Time zone' },
  });
  const stops = new Map();
  let firstDate = null; let lastDay = 0;
  for (const r of itin.rows) {
    const day = Number(r.day); const date = toIsoDate(r.date);
    if (!Number.isInteger(day) || !date) throw new Error(`Itinerary, row ${r.row}: the Day must be a number and the Date a real date (like 2027-01-12).`);
    if (day === 1) firstDate = date;
    lastDay = Math.max(lastDay, day);
    const stopNumber = Number(r.stop);
    if (!Number.isInteger(stopNumber)) throw new Error(`Itinerary, row ${r.row}: the Stop must be a number (1, 2, 3...).`);
    const stop = stops.get(stopNumber) ?? { index: stopNumber, name: clean(r.destination), country: clean(r.country), timezone: clean(r.zone), first_day: day, last_day: day };
    stop.first_day = Math.min(stop.first_day, day); stop.last_day = Math.max(stop.last_day, day);
    stops.set(stopNumber, stop);
  }
  if (!firstDate) throw new Error('The Itinerary has no day 1: the trip needs a first day.');
  const destinations = [...stops.values()].sort((a, b) => a.index - b.index);

  // Activities -> half-days with their options
  const act = table(sheets, 'Activities', {
    slot: { heading: 'Slot ID' }, day: { heading: 'Day' }, date: { heading: 'Date' }, destination: { heading: 'Destination' },
    half: { heading: 'Half-day' }, activity: { heading: 'Activity' }, start: { heading: 'Start', optional: true },
    meeting: { heading: 'Meeting point', optional: true }, capacity: { heading: 'Capacity', optional: true },
    short: { heading: 'Short name', optional: true }, duration: { heading: 'Duration', optional: true }, difficulty: { heading: 'Difficulty', optional: true },
    difficultyNote: { heading: 'Difficulty details', optional: true }, description: { heading: 'Description', optional: true },
    bring: { heading: 'Good to know', optional: true }, accessibility: { heading: 'Accessibility', optional: true },
  });
  const destinationByName = new Map(destinations.map((d) => [d.name, d]));
  const slots = new Map();
  for (const r of act.rows) {
    const slotId = clean(r.slot);
    const date = toIsoDate(r.date);
    if (!slotId || !date) throw new Error(`Activities, row ${r.row}: every line needs a Slot ID and a real Date.`);
    const destination = destinationByName.get(clean(r.destination));
    if (!destination) throw new Error(`Activities, row ${r.row}: the destination "${clean(r.destination)}" is not in the Itinerary.`);
    const slot = slots.get(slotId) ?? { id: slotId, day: Number(r.day), date, dest: destination.name, country: destination.country, dest_index: destination.index, half: clean(r.half), options: [] };
    const name = clean(r.activity);
    if (!name) throw new Error(`Activities, row ${r.row}: the Activity has no name.`);
    const capacity = r.capacity === null || clean(r.capacity) === '' ? null : Number(r.capacity);
    if (capacity !== null && !Number.isFinite(capacity)) throw new Error(`Activities, row ${r.row}: the Capacity must be a number (or empty for no limit).`);
    const difficulty = clean(r.difficulty).toLowerCase();
    if (difficulty && !['easy', 'moderate', 'demanding'].includes(difficulty)) throw new Error(`Activities, row ${r.row}: the Difficulty must be Easy, Moderate or Demanding (or empty).`);
    slot.options.push({
      id: `${slotId}-${slot.options.length + 1}`, name, start: toClock(r.start) ?? '', meeting: clean(r.meeting), cap: capacity, short: clean(r.short),
      duration: clean(r.duration), difficulty, difficulty_note: clean(r.difficultyNote), description: clean(r.description), bring: clean(r.bring), accessibility: clean(r.accessibility),
    });
    slots.set(slotId, slot);
  }
  if (slots.size === 0) throw new Error('The sheet "Activities" has no activities.');

  // Guests
  const gst = table(sheets, 'Guests', {
    id: { heading: 'Guest ID' }, first: { heading: 'First name' }, last: { heading: 'Last name' },
    party: { heading: 'Party ID', optional: true }, ptype: { heading: 'Party type', optional: true },
    dietary: { heading: 'Dietary / allergies', optional: true }, notes: { heading: 'Notes', optional: true },
  });
  const guests = gst.rows.map((r) => ({
    id: clean(r.id), first: clean(r.first), last: clean(r.last), party: clean(r.party) || undefined, ptype: clean(r.ptype) || undefined,
    notes: clean(r.notes), dietary: clean(r.dietary),
  }));
  if (guests.length === 0) throw new Error('The sheet "Guests" has no guests.');

  // Sign-ups (optional)
  const signups = {};
  const su = table(sheets, 'Sign-ups', { guest: { heading: 'Guest ID' }, slot: { heading: 'Slot ID' }, activity: { heading: 'Activity' } }, { required: false });
  let unknownGuests = 0; let unknownSlots = 0; let notOnTrip = 0;
  if (su) {
    const guestIds = new Set(guests.map((g) => g.id));
    for (const r of su.rows) {
      const g = clean(r.guest); const s = clean(r.slot);
      if (!guestIds.has(g)) { unknownGuests++; continue; }
      if (!slots.has(s)) { unknownSlots++; continue; }
      let value = clean(r.activity);
      // "Not on trip" (a guest who joins later or leaves earlier) has no status of its own in the app yet: like in the sample .json, it is At leisure.
      if (value.toLowerCase() === 'not on trip') { value = 'At leisure'; notOnTrip++; }
      (signups[g] ??= {})[s] = value;
    }
  } else {
    warnings.push('There is no "Sign-ups" sheet: nobody has chosen anything yet (you can do it in the app).');
  }
  if (notOnTrip > 0) warnings.push(`${notOnTrip} sign-up(s) say "Not on trip" (guests who join later or leave earlier): they are shown as At leisure for now.`);
  if (unknownGuests > 0) warnings.push(`${unknownGuests} sign-up line(s) name a guest who is not in the Guests sheet: they were left out.`);
  if (unknownSlots > 0) warnings.push(`${unknownSlots} sign-up line(s) name a Slot ID that is not in the Activities sheet: they were left out.`);

  // Sign-ups naming an activity that is not offered in that half-day are kept as typed (the Warnings screen shows them): count them.
  let mismatched = 0;
  for (const [g, row] of Object.entries(signups)) {
    for (const [s, value] of Object.entries(row)) {
      const slot = slots.get(s);
      if (value && value.toLowerCase() !== 'at leisure' && !slot.options.some((o) => o.name === value)) mismatched++;
    }
  }
  if (mismatched > 0) warnings.push(`${mismatched} sign-up(s) name an activity that is not offered in that half-day (a typo?). They are kept as typed and listed in Warnings.`);

  const raw = {
    trip: { code, name, start: firstDate, days: lastDay },
    destinations,
    guests,
    slots: [...slots.values()],
    signups: Object.fromEntries(guests.map((g) => [g.id, signups[g.id] ?? {}])),
  };
  const summary = {
    destinations: destinations.length, days: lastDay, halfDays: slots.size,
    activities: [...slots.values()].reduce((n, s) => n + s.options.length, 0), guests: guests.length,
    signups: Object.values(signups).reduce((n, row) => n + Object.keys(row).length, 0),
  };
  return { raw, summary, warnings };
}
