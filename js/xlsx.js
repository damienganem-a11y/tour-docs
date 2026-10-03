// A small .xlsx (Excel) writer, built only for Tour Docs's own exports — the same content as the
// PDF (see pdf.js's `doc` shape), as a real, editable spreadsheet: one sheet per half-day, the
// tours of that half-day as ID/Name tables side by side (SPEC.md, "5. Export").
//
// Written by hand, with no outside library, the same as everything else in Tour Docs. A .xlsx file
// is a .zip file (itself a simple, well-known format: a copy of each file, then an index at the end)
// holding a handful of small XML files that describe the workbook. There is no page limit to fit
// inside here (Excel scrolls, and prints however the owner sets it up), so — unlike the PDF — a long
// list is just one tall column, not split into several.

// ---------- Writing a .zip file, by hand ----------
//
// Every entry is stored plain (no compression): simpler to write correctly, and these files are
// tiny text, so there is nothing to gain from compressing them.

class ByteWriter {
  constructor() { this.bytes = []; }
  get length() { return this.bytes.length; }
  u8(n) { this.bytes.push(n & 0xff); return this; }
  u16(n) { return this.u8(n).u8(n >> 8); }
  u32(n) { return this.u16(n).u16(n >> 16); }
  utf8(str) { this.raw([...new TextEncoder().encode(str)]); return this; }
  raw(byteArray) { for (const b of byteArray) this.bytes.push(b); return this; }
  toUint8Array() { return new Uint8Array(this.bytes); }
}

// The standard CRC-32 table (one bit-reversed polynomial, the same one .zip, PNG and Ethernet use).
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A moment as the two 16-bit numbers a .zip file stores dates as (DOS's own date format, still what
// .zip uses today). Accurate to the minute; .zip only ever stores 2-second precision anyway.
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// Builds a .zip file (as bytes) from a list of { name, text } entries.
function buildZip(entries) {
  const { time, day } = dosDateTime(new Date());
  const out = new ByteWriter();
  const centralRecords = [];

  for (const { name, text } of entries) {
    const data = [...new TextEncoder().encode(text)];
    const crc = crc32(data);
    const offset = out.length;

    out.u32(0x04034b50).u16(20).u16(0).u16(0).u16(time).u16(day)
      .u32(crc).u32(data.length).u32(data.length).u16(new TextEncoder().encode(name).length).u16(0)
      .utf8(name).raw(data);

    centralRecords.push({ name, crc, size: data.length, offset });
  }

  const centralStart = out.length;
  for (const { name, crc, size, offset } of centralRecords) {
    out.u32(0x02014b50).u16(20).u16(20).u16(0).u16(0).u16(time).u16(day)
      .u32(crc).u32(size).u32(size).u16(new TextEncoder().encode(name).length).u16(0).u16(0).u16(0).u16(0).u32(0).u32(offset)
      .utf8(name);
  }
  const centralSize = out.length - centralStart;

  out.u32(0x06054b50).u16(0).u16(0).u16(centralRecords.length).u16(centralRecords.length)
    .u32(centralSize).u32(centralStart).u16(0);

  return out.toUint8Array();
}

// ---------- The XML parts of a workbook ----------

const xmlEscape = (text) => String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// A spreadsheet name for a half-day, kept short and free of the few characters Excel refuses in a
// sheet name (a tab still reads fine without them: "Day 1: Afternoon" -> "Day 1 Afternoon").
function sheetName(text, usedNames) {
  let base = text.replace(/[:\\/?*[\]]/g, '').trim().slice(0, 31) || 'Sheet';
  let name = base;
  for (let n = 2; usedNames.has(name); n++) name = `${base.slice(0, 28)} ${n}`; // the rare exact clash
  usedNames.add(name);
  return name;
}

// "A", "B", ... "Z", "AA", "AB", ... — the column letters a cell reference is built from.
function columnLetters(index) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// Cell styles (the numbers are positions in the styles part below): 0 plain, 1 bold, 2 column heading (white on the colour),
// 3 sheet title (big, in the colour), 4 light tint (every other row), 5 muted grey (the "Updated" line).
const STYLE = { BOLD: 1, HEADING: 2, TITLE: 3, TINT: 4, MUTED: 5 };

// One row of cells: values is an array of { col, text, bold?, style? }. A cell with nothing to show is left out, the same way a
// real spreadsheet leaves a cell empty, unless it carries a style (a tinted row keeps its tint across empty cells too).
function rowXml(rowNumber, values) {
  const cells = values.map((v) => {
    const style = v.style ?? (v.bold ? STYLE.BOLD : undefined);
    const attr = style ? ` s="${style}"` : '';
    const at = `${columnLetters(v.col)}${rowNumber}`;
    if (v.text === undefined || v.text === '') return style ? `<c r="${at}"${attr}/>` : '';
    return `<c r="${at}"${attr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v.text)}</t></is></c>`;
  }).join('');
  return `<row r="${rowNumber}">${cells}</row>`;
}

const TABLE_COLS = 3;  // #, ID, Name
const GAP_COLS = 1;    // one blank column between one table and the next

// The rows of one table (an activity, or At leisure/Needs a look), starting at `startCol`, as { row, values } pieces.
// Tables sit side by side, so several pieces share one row number: sheetXml merges them into ONE <row> each.
// (Excel refuses a sheet with the same row twice, or rows out of order.)
function tableRows(table, startCol, startRow) {
  const pieces = [];
  const heading = table.count ? `${table.heading}  (${table.count})` : table.heading;
  pieces.push({ row: startRow, values: [{ col: startCol, text: heading, style: STYLE.TITLE }] });
  if (table.detail) pieces.push({ row: startRow + 1, values: [{ col: startCol, text: table.detail }] });
  pieces.push({ row: startRow + 2, values: [
    { col: startCol, text: '#', style: STYLE.HEADING }, { col: startCol + 1, text: 'ID', style: STYLE.HEADING }, { col: startCol + 2, text: 'Name', style: STYLE.HEADING },
  ] });
  table.rows.forEach((row, i) => {
    pieces.push({ row: startRow + 3 + i, values: [
      { col: startCol, text: String(i + 1), style: i % 2 === 0 ? STYLE.TINT : undefined }, { col: startCol + 1, text: row.id, style: i % 2 === 0 ? STYLE.TINT : undefined }, { col: startCol + 2, text: row.name, style: i % 2 === 0 ? STYLE.TINT : undefined },
    ] });
  });
  return pieces;
}

// One sheet: the doc's title and "Updated ..." line, then every table of this half-day side by side.
function sheetXml(doc, group) {
  const headRow = 4; // title, updated line, a blank row, then the tables start
  const byRow = new Map([[1, [{ col: 0, text: doc.title, style: STYLE.TITLE }]], [2, [{ col: 0, text: doc.updatedLine, style: STYLE.MUTED }]]]);

  const tableCount = group.tables.length;
  const totalCols = Math.max(1, tableCount) * (TABLE_COLS + GAP_COLS);
  const cols = Array.from({ length: totalCols }, (_, i) => {
    const withinTable = i % (TABLE_COLS + GAP_COLS);
    const width = withinTable === 0 ? 4.5 : withinTable === 1 ? 10 : withinTable === 2 ? 24 : 2.5;
    return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
  }).join('');

  group.tables.forEach((table, i) => {
    const startCol = i * (TABLE_COLS + GAP_COLS);
    for (const piece of tableRows(table, startCol, headRow)) byRow.set(piece.row, [...(byRow.get(piece.row) ?? []), ...piece.values]);
  });
  const rows = [...byRow.keys()].sort((a, b) => a - b).map((rowNumber) => rowXml(rowNumber, [...byRow.get(rowNumber)].sort((a, b) => a.col - b.col)));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`
    + `<cols>${cols}</cols>`
    + `<sheetData>${rows.join('')}</sheetData>`
    + printSetup(tableCount > 2)
    + `</worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
  + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
  + `<Default Extension="xml" ContentType="application/xml"/>`
  + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
  + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
  + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`
  + `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`
  + '{{SHEET_OVERRIDES}}'
  + `</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
  + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
  + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`
  + `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>`
  + `</Relationships>`;

// Just enough metadata for Excel/Numbers/Google Sheets to treat the file as a normal, complete
// document (a real spreadsheet always has these two parts, even though nothing reads them here).
function coreXml() {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:creator>Tour Docs</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>`
    + `</cp:coreProperties>`;
}
const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
  + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Tour Docs</Application></Properties>`;

// The styles part follows the layout Excel itself writes (the two fixed first fills "none" and "gray125", a border made of its
// five sides, a named "Normal" cell style). Excel refuses (or offers to "repair") a file whose styles cut these corners, and
// the earlier, shorter version of this part was the likely reason a file would not open in Excel (1 Oct 2026).
// The colour (the company's accent) dresses the headings, the titles and a light tint on every other row.
const DEFAULT_ACCENT = '#1d5c57';
function mixWithWhite(hex, amount) { // amount 0.9 = 90% white
  const channel = (i) => Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * (1 - amount) + 255 * amount).toString(16).padStart(2, '0');
  return `${channel(0)}${channel(1)}${channel(2)}`.toUpperCase();
}
function stylesXml(accent) {
  const color = /^#[0-9a-f]{6}$/i.test(accent ?? '') ? accent : DEFAULT_ACCENT;
  const solid = color.slice(1).toUpperCase();
  const font = (extra, size, rgb) => `<font>${extra}<sz val="${size}"/>${rgb ? `<color rgb="FF${rgb}"/>` : ''}<name val="Calibri"/><family val="2"/></font>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<fonts count="5">${font('', 10)}${font('<b/>', 10)}${font('<b/>', 10, 'FFFFFF')}${font('<b/>', 14, solid)}${font('', 9, '7F7F7F')}</fonts>`
    + `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>`
    + `<fill><patternFill patternType="solid"><fgColor rgb="FF${solid}"/><bgColor indexed="64"/></patternFill></fill>`
    + `<fill><patternFill patternType="solid"><fgColor rgb="FF${mixWithWhite(color, 0.9)}"/><bgColor indexed="64"/></patternFill></fill></fills>`
    + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="6">`
    + `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
    + `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>`
    + `<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>`
    + `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>`
    + `<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>`
    + `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>`
    + `</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
    + `</styleSheet>`;
}

// Printing: A4, all columns on the width of one page (as many pages tall as needed), landscape when the sheet is wide.
const printSetup = (landscape) => `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>`
  + `<pageSetup paperSize="9" orientation="${landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`;

// A flat, sortable table: a title, the "Updated" line, then a coloured heading row and the rows (every other one tinted). The
// heading row stays in view when scrolling, has filter buttons, and prints on A4. `rows` are arrays of text, one per column.
function flatSheetXml({ title, updatedLine, headers, widths, rows, landscape = false }) {
  const tint = (i) => (i % 2 === 0 ? STYLE.TINT : undefined);
  const sheetRows = [
    rowXml(1, [{ col: 0, text: title, style: STYLE.TITLE }]),
    rowXml(2, [{ col: 0, text: updatedLine, style: STYLE.MUTED }]),
    rowXml(4, headers.map((text, col) => ({ col, text, style: STYLE.HEADING }))),
    ...rows.map((values, i) => rowXml(5 + i, values.map((text, col) => ({ col, text, style: tint(i) })))),
  ];
  const cols = widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('');
  const lastColumn = columnLetters(headers.length - 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView></sheetViews>`
    + `<cols>${cols}</cols><sheetData>${sheetRows.join('')}</sheetData>`
    + `<autoFilter ref="A4:${lastColumn}${4 + rows.length}"/>`
    + printSetup(landscape)
    + `</worksheet>`;
}

// Assembles a whole workbook (all the fixed parts, plus one worksheet per given { name, xml }) into
// a ready-to-share .xlsx Blob. Shared by buildListsXlsx and buildFinalTripXlsx below, which differ
// only in which sheets they hand it.
function assembleWorkbook(sheets, accent) {
  const sheetOverrides = sheets.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<bookViews><workbookView activeTab="0"/></bookViews>`
    + `<sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
    + `</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `</Relationships>`;

  const entries = [
    { name: '[Content_Types].xml', text: CONTENT_TYPES.replace('{{SHEET_OVERRIDES}}', sheetOverrides) },
    { name: '_rels/.rels', text: ROOT_RELS },
    { name: 'docProps/core.xml', text: coreXml() },
    { name: 'docProps/app.xml', text: APP_XML },
    { name: 'xl/workbook.xml', text: workbook },
    { name: 'xl/_rels/workbook.xml.rels', text: workbookRels },
    { name: 'xl/styles.xml', text: stylesXml(accent) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: s.xml })),
  ];

  const bytes = buildZip(entries);
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// A flat, sortable table — one row per (guest, half-day) pair — rather than the small side-by-side
// tiles the PDF uses (which only exist to make things fit on a printed page; a spreadsheet has no
// such limit, and a flat table is the more useful shape to sort or filter in Excel itself).
function guestsFlatSheetXml(doc, guestRows) {
  return flatSheetXml({
    title: doc.title, updatedLine: doc.updatedLine, headers: ['ID', 'Name', 'When', 'Destination', 'Doing what'], widths: [10, 26, 18, 16, 36],
    rows: guestRows.map((r) => [r.id, r.name, r.when, r.destination, r.what]), landscape: true,
  });
}

// The one thing most of the app calls: doc (see pdf.js's layoutPages for its shape) -> a
// ready-to-share .xlsx Blob.
export function buildListsXlsx(doc, brand = {}) {
  const usedNames = new Set();
  const sheets = doc.groups.map((group) => ({ name: sheetName(group.heading ?? doc.title, usedNames), xml: sheetXml(doc, group) }));
  return assembleWorkbook(sheets, brand.accent);
}

// The final export of the whole trip (SPEC.md, "5. Export"): every half-day's tours as their own
// sheet (toursDoc, the same shape buildListsXlsx takes — just spanning every destination), plus one
// more sheet with every guest's own day-by-day itinerary as a flat table.
export function buildFinalTripXlsx(toursDoc, guestRows, brand = {}) {
  const usedNames = new Set();
  const tourSheets = toursDoc.groups.map((group) => ({ name: sheetName(group.heading ?? toursDoc.title, usedNames), xml: sheetXml(toursDoc, group) }));
  const guestSheet = { name: sheetName('All guests', usedNames), xml: guestsFlatSheetXml(toursDoc, guestRows) };
  return assembleWorkbook([...tourSheets, guestSheet], brand.accent);
}

// The groups list (Settings > Groups): first one flat sheet with a Group column (one row per guest, so a
// person is changed by editing their Group cell, and the sheet sorts and filters), then one sheet per
// group with its own numbered list, like the other lists. `rows` are { group, id, name ("Last, First"), with }.
export function buildGroupsXlsx(doc, rows, brand = {}) {
  const usedNames = new Set();
  const flatXml = flatSheetXml({
    title: doc.title, updatedLine: doc.updatedLine, headers: ['Group', 'ID', 'Name', 'Travelling with'], widths: [18, 9, 28, 40],
    rows: rows.map((r) => [r.group, r.id, r.name, r.with]),
  });
  const sheets = [{ name: sheetName('All guests', usedNames), xml: flatXml }];
  for (const group of doc.groups) sheets.push({ name: sheetName(group.heading, usedNames), xml: sheetXml(doc, group) });
  return assembleWorkbook(sheets, brand.accent);
}

// The evening sheet (every restaurant of one evening) as one flat table: Restaurant, Time, ID, Name, Status, and (only when
// the owner ticked "Include dietary needs") a Dietary needs column. One row per guest, so it sorts and filters in Excel.
export function buildEveningXlsx(doc, brand = {}) {
  const withNeeds = doc.blocks.some((b) => b.needs?.length > 0);
  const rows = [];
  for (const block of doc.blocks) {
    block.tables.forEach((table) => table.rows.forEach((r) => {
      const need = block.needs?.find((n) => n.id === r.id)?.text ?? '';
      rows.push([block.restaurant, block.seating, String(block.count), r.id, r.name, table.special ? 'Special request' : 'Confirmed', ...(withNeeds ? [need] : [])]);
    }));
  }
  const xml = flatSheetXml({
    title: doc.title, updatedLine: doc.updatedLine,
    headers: ['Restaurant', 'Time', 'People at table', 'ID', 'Name', 'Status', ...(withNeeds ? ['Dietary needs'] : [])],
    widths: [26, 9, 16, 10, 28, 16, ...(withNeeds ? [44] : [])], rows, landscape: withNeeds,
  });
  return assembleWorkbook([{ name: sheetName('Evening', new Set()), xml }], brand.accent);
}

// The blank trip file to fill in (Trips > "Excel template"): the sheets that xlsxImport.js reads, headings in the first row, and a few
// invented example lines to replace. Same column names as the sample trip's Excel file.
export function buildTemplateXlsx() {
  const plain = (headers, widths, rows) => {
    const body = [
      rowXml(1, headers.map((text, col) => ({ col, text, style: STYLE.HEADING }))),
      ...rows.map((values, i) => rowXml(2 + i, values.map((text, col) => ({ col, text: text === null ? '' : String(text), style: i % 2 === 0 ? STYLE.TINT : undefined })))),
    ];
    const cols = widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
      + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`
      + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>`
      + `<cols>${cols}</cols><sheetData>${body.join('')}</sheetData>${printSetup(true)}</worksheet>`;
  };
  const readMe = [
    ['Tour Docs trip template'],
    ['Fill in the sheets Itinerary, Guests and Activities (Sign-ups is optional), then in Tour Docs: Trips > Import a trip from Excel.'],
    [''],
    ['Itinerary: one line per day. Stop = the number of the destination (1, 2, 3...); lines of the same stop share a Destination, Country and Time zone (like Europe/Lisbon).'],
    ['Guests: one line per guest. Guests with the same Party ID travel together (leave it empty for a guest travelling alone). Dietary / allergies stays private to the app.'],
    ['Activities: one line per activity offered in a half-day. Slot ID names the half-day (S01, S02...) and is the same on every line of that half-day. Half-day is Morning, Afternoon, Evening or Full day (a Full day replaces the Morning and the Afternoon of that day). Capacity empty = no limit.'],
    ['Sign-ups (optional): what each guest chose, one line per guest and half-day. Activity is the exact name from the Activities sheet, or "At leisure".'],
    ['The example lines are invented: replace or delete them. Dates look like 2027-01-12 and times like 15:00.'],
    ['On the Activities sheet, the last columns (Short name, Duration, Difficulty, Difficulty details, Description, What to bring, Included) are optional and are what guests read about each tour. Difficulty is Easy, Moderate or Demanding.'],
  ];
  const sheets = [
    { name: 'Read me', xml: plain(['How to fill this in'], [140], readMe.map((r) => [r[0]])) },
    { name: 'Itinerary', xml: plain(['Day', 'Date', 'Stop', 'Destination', 'Country', 'Time zone', 'Note'], [6, 12, 6, 18, 16, 20, 30], [
      [1, '2027-01-12', 1, 'Lisbon', 'Portugal', 'Europe/Lisbon', 'Arrival'], [2, '2027-01-13', 1, 'Lisbon', 'Portugal', 'Europe/Lisbon', ''], [3, '2027-01-14', 2, 'Marrakech', 'Morocco', 'Africa/Casablanca', ''],
    ]) },
    { name: 'Guests', xml: plain(['Guest ID', 'First name', 'Last name', 'Party ID', 'Party type', 'Dietary / allergies', 'Notes'], [10, 16, 16, 10, 12, 30, 30], [
      ['G001', 'Ada', 'Example', 'P01', 'Couple', '', ''], ['G002', 'Ben', 'Example', 'P01', 'Couple', 'Peanut allergy', ''], ['G003', 'Cleo', 'Sample', '', 'Solo', '', 'Window seat'],
    ]) },
    { name: 'Activities', xml: plain(['Slot ID', 'Day', 'Date', 'Destination', 'Half-day', 'Activity', 'Start', 'Meeting point', 'Capacity', 'Short name', 'Duration', 'Difficulty', 'Difficulty details', 'Description', 'Good to know', 'Accessibility'], [9, 6, 12, 18, 11, 34, 8, 22, 10, 14, 16, 12, 34, 40, 34, 34], [
      ['S01', 1, '2027-01-12', 'Lisbon', 'Afternoon', 'Alfama walking tour', '15:00', 'Hotel lobby', 20, 'Alfama', 'About 2.5 hours', 'Moderate', '2.5 km on steep, cobbled streets with many steps.', 'A guided walk through the old quarter, with a stop for a coffee.', 'Comfortable shoes with grip', 'Steep, cobbled streets with many steps: speak to your guide if you have limited mobility.'], ['S01', 1, '2027-01-12', 'Lisbon', 'Afternoon', 'Tram 28 and viewpoints', '15:30', 'Hotel entrance', 16, 'Tram 28', '', '', '', '', '', ''],
      ['S02', 2, '2027-01-13', 'Lisbon', 'Morning', 'Sintra palaces', '08:30', 'Hotel lobby', 50, 'Sintra', '', '', '', '', '', ''],
    ]) },
    { name: 'Sign-ups', xml: plain(['Guest ID', 'Slot ID', 'Activity'], [10, 9, 34], [['G001', 'S01', 'Alfama walking tour'], ['G002', 'S01', 'Alfama walking tour'], ['G003', 'S01', 'At leisure']]) },
  ];
  return assembleWorkbook(sheets, undefined);
}
