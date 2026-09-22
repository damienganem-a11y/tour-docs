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
      .u32(crc).u32(data.length).u32(data.length).u16(name.length).u16(0)
      .utf8(name).raw(data);

    centralRecords.push({ name, crc, size: data.length, offset });
  }

  const centralStart = out.length;
  for (const { name, crc, size, offset } of centralRecords) {
    out.u32(0x02014b50).u16(20).u16(20).u16(0).u16(0).u16(time).u16(day)
      .u32(crc).u32(size).u32(size).u16(name.length).u16(0).u16(0).u16(0).u16(0).u32(0).u32(offset)
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

// One row of cells: values is an array of { col, text, bold }. Skips columns with nothing to show,
// the same way a real spreadsheet leaves a cell empty rather than writing a blank string into it.
function rowXml(rowNumber, values) {
  const cells = values
    .filter((v) => v.text !== undefined && v.text !== '')
    .map((v) => `<c r="${columnLetters(v.col)}${rowNumber}"${v.bold ? ' s="1"' : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v.text)}</t></is></c>`)
    .join('');
  return `<row r="${rowNumber}">${cells}</row>`;
}

const TABLE_COLS = 3;  // #, ID, Name
const GAP_COLS = 1;    // one blank column between one table and the next

// The rows of one table (an activity, or At leisure/Needs a look), starting at `startCol`.
function tableRows(table, startCol, startRow) {
  const rows = [];
  const heading = table.count ? `${table.heading}  (${table.count})` : table.heading;
  rows.push(rowXml(startRow, [{ col: startCol, text: heading, bold: true }]));
  if (table.detail) rows.push(rowXml(startRow + 1, [{ col: startCol, text: table.detail }]));
  rows.push(rowXml(startRow + 2, [
    { col: startCol, text: '#', bold: true }, { col: startCol + 1, text: 'ID', bold: true }, { col: startCol + 2, text: 'Name', bold: true },
  ]));
  table.rows.forEach((row, i) => {
    rows.push(rowXml(startRow + 3 + i, [
      { col: startCol, text: String(i + 1) }, { col: startCol + 1, text: row.id }, { col: startCol + 2, text: row.name },
    ]));
  });
  return rows;
}

// One sheet: the doc's title and "Updated ..." line, then every table of this half-day side by side.
function sheetXml(doc, group) {
  const headRow = 4; // title, updated line, a blank row, then the tables start
  const rows = [
    rowXml(1, [{ col: 0, text: doc.title, bold: true }]),
    rowXml(2, [{ col: 0, text: doc.updatedLine }]),
  ];

  const tableCount = group.tables.length;
  const totalCols = tableCount * (TABLE_COLS + GAP_COLS);
  const cols = Array.from({ length: totalCols }, (_, i) => {
    const withinTable = i % (TABLE_COLS + GAP_COLS);
    const width = withinTable === 0 ? 4.5 : withinTable === 1 ? 10 : withinTable === 2 ? 24 : 2.5;
    return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
  }).join('');

  group.tables.forEach((table, i) => {
    const startCol = i * (TABLE_COLS + GAP_COLS);
    rows.push(...tableRows(table, startCol, headRow));
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<cols>${cols}</cols>`
    + `<sheetData>${rows.join('')}</sheetData>`
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

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
  + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + `<fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts>`
  + `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>`
  + `<borders count="1"><border/></borders>`
  + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0"/></cellStyleXfs>`
  + `<cellXfs count="2"><xf numFmtId="0" fontId="0" xfId="0"/><xf numFmtId="0" fontId="1" xfId="0" applyFont="1"/></cellXfs>`
  + `</styleSheet>`;

// The one thing the rest of the app calls: doc (see pdf.js's layoutPages for its shape) -> a
// ready-to-share .xlsx Blob.
export function buildListsXlsx(doc) {
  const usedNames = new Set();
  const names = doc.groups.map((g) => sheetName(g.heading ?? doc.title, usedNames));

  const sheetOverrides = names.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
    + `</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `</Relationships>`;

  const entries = [
    { name: '[Content_Types].xml', text: CONTENT_TYPES.replace('{{SHEET_OVERRIDES}}', sheetOverrides) },
    { name: '_rels/.rels', text: ROOT_RELS },
    { name: 'docProps/core.xml', text: coreXml() },
    { name: 'docProps/app.xml', text: APP_XML },
    { name: 'xl/workbook.xml', text: workbook },
    { name: 'xl/_rels/workbook.xml.rels', text: workbookRels },
    { name: 'xl/styles.xml', text: STYLES },
    ...doc.groups.map((group, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(doc, group) })),
  ];

  const bytes = buildZip(entries);
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
