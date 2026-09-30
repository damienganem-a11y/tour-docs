// A small PDF writer, built only for Tour Docs's own exports: pages of small ID/Name tables, laid
// out side by side like the paper lists the team already uses (SPEC.md, "5. Export"). No pictures,
// no custom font: it uses Helvetica, which is built into the PDF format itself, so nothing needs to
// be carried in the file (or in the app) to draw the letters.
//
// Written by hand, with no outside library, the same as everything else in Tour Docs. A PDF file is
// mostly plain text (a numbered list of "objects", plus an index at the end saying where each one
// starts); the real work here is laying the little tables out on the page, and writing that index
// correctly.

const PAGE_WIDTH = 842;  // A4, in points (1/72 inch), landscape — wide enough for tables side by side
const PAGE_HEIGHT = 595;
const MARGIN = 22;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const USABLE_HEIGHT = PAGE_HEIGHT - MARGIN * 2;

// ---------- Measuring text (so it is never drawn past the edge of its own column) ----------
//
// These are Helvetica's own published letter widths (1/1000 of the text size, the units PDF uses).
// Every reader already has this font built in, so this table is the only "font" data we carry.
// Accented letters (beyond the plain A-Z the table lists) are not measured exactly: they are given
// an average width instead, which only ever wraps a line a little earlier than strictly needed.
const REGULAR_WIDTHS = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191, 40: 333, 41: 333,
  42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556,
  52: 556, 53: 556, 54: 556, 55: 556, 56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584,
  62: 584, 63: 556, 64: 1015, 65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778,
  82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611, 91: 278,
  92: 278, 93: 278, 94: 469, 95: 556, 96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556,
  102: 278, 103: 556, 104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556,
  111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556, 118: 500, 119: 722,
  120: 500, 121: 500, 122: 500, 123: 334, 124: 260, 125: 334, 126: 584,
};
const BOLD_WIDTHS = {
  32: 278, 33: 333, 34: 474, 35: 556, 36: 556, 37: 889, 38: 722, 39: 238, 40: 333, 41: 333,
  42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556,
  52: 556, 53: 556, 54: 556, 55: 556, 56: 556, 57: 556, 58: 333, 59: 333, 60: 584, 61: 584,
  62: 584, 63: 611, 64: 975, 65: 722, 66: 722, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 556, 75: 722, 76: 611, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778,
  82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611, 91: 333,
  92: 278, 93: 333, 94: 584, 95: 556, 96: 333, 97: 556, 98: 611, 99: 556, 100: 611, 101: 556,
  102: 333, 103: 611, 104: 611, 105: 278, 106: 278, 107: 556, 108: 278, 109: 889, 110: 611,
  111: 611, 112: 611, 113: 611, 114: 389, 115: 556, 116: 333, 117: 611, 118: 556, 119: 778,
  120: 556, 121: 556, 122: 500, 123: 389, 124: 280, 125: 389, 126: 584,
};
const FONT_REGULAR = { resourceName: 'F1', baseFont: 'Helvetica', widths: REGULAR_WIDTHS, defaultWidth: 556 };
const FONT_BOLD = { resourceName: 'F2', baseFont: 'Helvetica-Bold', widths: BOLD_WIDTHS, defaultWidth: 611 };

// A few characters the app shows on screen have no byte in WinAnsiEncoding at all — not even in the
// special-punctuation table above — so they are swapped for a plain-ASCII equivalent before anything
// else touches the text (measuring its width, wrapping it, shortening it with "…"), so the fallback
// is baked into every measurement instead of only showing up as a "?" at the very end. Today this is
// just the infinity sign an uncapped activity's count uses ("6 / ∞"): rules.js's own wording, kept
// exactly as the app shows it everywhere else, just spelled out here since a PDF reader cannot draw it.
const PDF_TEXT_SWAPS = [[/∞/g, 'no limit']];
const sanitizePdfText = (text) => PDF_TEXT_SWAPS.reduce((t, [pattern, replacement]) => t.replace(pattern, replacement), text);

function textWidth(text, font, size) {
  let units = 0;
  for (const ch of sanitizePdfText(text)) units += font.widths[ch.codePointAt(0)] ?? font.defaultWidth;
  return (units / 1000) * size;
}

// Cuts text short with "…" so it always fits maxWidth on one line: a table cell never wraps (that
// would break the row heights every column is lined up on), it just shortens if it has to.
function fitOneLine(text, font, size, maxWidth) {
  if (textWidth(text, font, size) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`, font, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

// Splits text into lines that each fit maxWidth, breaking between words. A single word longer than
// a whole line is left on its own line rather than cut mid-word (a rare case, e.g. a long tour name).
function wrapText(text, font, size, maxWidth) {
  const words = text.split(' ').filter((w) => w !== '');
  if (words.length === 0) return [''];
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && textWidth(candidate, font, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  return lines;
}

// ---------- The shape of one small ID/Name table ----------
//
// Tables are laid out on a grid of same-sized "tiles", side by side and then down the page, so
// several tours line up neatly next to each other, the same way the team's own paper lists do —
// small and tight, so a whole half-day (several tours) fits on the one page it belongs to (see
// "one page per half-day" below). A table with more rows than fit in one tile simply continues in
// the next tile (its numbering carries on, e.g. 41, 42, 43...), rather than
// becoming one very tall column; in practice a tile is tall enough that this rarely happens.

const TILE_GAP = 8;
const ROW_H = 9;
const TITLE_SIZE = 8;
const DETAIL_SIZE = 6;
const HEAD_SIZE = 6.5;
const CELL_SIZE = 7;
// Fixed so every tile is exactly the same height, whether or not it actually has a title to show
// (a continuing tile leaves this space blank): title (up to 2 lines) + detail line + column headings.
const TITLE_BLOCK_H = TITLE_SIZE * 1.2 * 2 + DETAIL_SIZE * 1.3 + 4;
const COLHEAD_H = HEAD_SIZE * 1.3 + 3;
const TILE_HEADER_H = TITLE_BLOCK_H + COLHEAD_H;

// A tile's own width, its two label columns' widths and headings, and how many rows fit before it
// spills into a further tile — bundled up as one "kind", since a tour's guest list and a guest's own
// day-by-day itinerary are both drawn as the same #/2-column tile shape, just sized differently.
// ACTIVITY_TILE is the default (the shape every export used before the final trip export existed).
const ACTIVITY_TILE = { tileWidth: 124, numColW: 12, idColW: 26, rowsPerTile: 40, labels: ['#', 'ID', 'Name'] };
const GUEST_TILE = { tileWidth: 230, numColW: 14, idColW: 78, rowsPerTile: 30, labels: ['#', 'When', 'Doing what, where'] };

const tileHeight = (kind) => TILE_HEADER_H + kind.rowsPerTile * ROW_H + 4;

// Splits one table's rows into same-sized chunks of kind.rowsPerTile, each becoming one tile. Only
// the first chunk carries the table's own title and detail line; later chunks just carry the column
// headings and keep counting from where the last one left off.
function tilesFor(table, kind) {
  const allRows = wrappedRows(table, kind);
  const tiles = [];
  for (let start = 0; start < allRows.length || start === 0; start += kind.rowsPerTile) {
    tiles.push({
      heading: start === 0 ? table.heading : null,
      detail: start === 0 ? table.detail : null,
      count: start === 0 ? table.count : null,
      firstNumber: allRows.slice(0, start).filter((r) => !r.cont).length + 1, // continuation lines are not numbered
      rows: allRows.slice(start, start + kind.rowsPerTile),
    });
    if (allRows.length === 0) break; // an empty table still gets its one (empty) tile
  }
  return tiles;
}

// A table marked `wrap: true` never cuts a row's text short with "…": what does not fit on one line
// continues on further, unnumbered lines (`cont: true`). Used for dietary needs, where a cut-off word
// ("Shellfis…") would be a safety problem, not just untidy. Every other table keeps one line per row.
// A single word wider than the column is split into pieces that fit, never dropped or cut with "…".
function breakToWidth(line, font, size, width) {
  const parts = [];
  let rest = line;
  while (textWidth(rest, font, size) > width && rest.length > 1) {
    let cut = rest.length - 1;
    while (cut > 1 && textWidth(rest.slice(0, cut), font, size) > width) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  parts.push(rest);
  return parts;
}

function wrappedRows(table, kind) {
  if (!table.wrap) return table.rows;
  const nameW = kind.tileWidth - kind.numColW - 8 - kind.idColW - 4;
  const breakLong = (line) => breakToWidth(line, FONT_REGULAR, CELL_SIZE, nameW);
  return table.rows.flatMap((row) => {
    const lines = wrapText(row.name, FONT_REGULAR, CELL_SIZE, nameW).flatMap(breakLong);
    return lines.map((line, i) => (i === 0 ? { ...row, name: line } : { id: '', name: line, cont: true }));
  });
}

// ---------- Laying tiles out onto pages ----------
//
// A "doc" looks like:
//   { title, updatedLine, groups: [ { heading, tables: [ { heading, detail, count, rows }, ... ] }, ... ] }
// `groups` are the half-days (only shown as their own heading when there is more than one); `rows`
// are { id, name } pairs, already in the order they should be printed. `kind` (see ACTIVITY_TILE /
// GUEST_TILE above) says how wide a tile is and what its two columns are called; every table in one
// call is drawn at that one size, since a doc is always either all tours or all guest itineraries,
// never a mix of both (see xlsx.js and buildFinalTripPdf below for how the two parts of the final
// trip export are combined).
function layoutPages(doc, kind = ACTIVITY_TILE) {
  const pages = [];
  let page = [];
  let y = PAGE_HEIGHT - MARGIN; // where the next thing (a text line, or a fresh row of tiles) starts

  function startPage() {
    if (page.length > 0) pages.push(page);
    page = [];
    y = PAGE_HEIGHT - MARGIN;
  }
  // Reserves `height` below the current y, moving to a fresh page first if it would run off the
  // bottom — but never on an empty page (that would loop forever if one row is taller than a page).
  function ensureRoom(height) {
    if (page.length > 0 && y - height < MARGIN) startPage();
  }
  function text(str, px, py, { font = FONT_REGULAR, size = CELL_SIZE, gray = 0, align = 'left', maxWidth } = {}) {
    const shown = maxWidth ? fitOneLine(str, font, size, maxWidth) : str;
    const drawX = align === 'right' ? px - textWidth(shown, font, size) : px;
    page.push({ type: 'text', x: drawX, y: py, font, size, gray, text: shown });
  }
  function rule(rx, ry, w, gray = 0.75) {
    page.push({ type: 'rect', x: rx, y: ry, w, h: 0.75, gray });
  }

  // The doc's own title and "Updated ..." line, at the top of every half-day's own page (small, so
  // it does not eat into the room the tables need).
  function writeDocHead() {
    const titleLines = wrapText(doc.title, FONT_BOLD, 12, USABLE_WIDTH);
    for (const line of titleLines) { text(line, MARGIN, y, { font: FONT_BOLD, size: 12 }); y -= 14; }
    text(doc.updatedLine, MARGIN, y, { size: 7.5, gray: 0.4 });
    y -= 14;
  }
  writeDocHead();

  // Places tiles left to right, wrapping to further rows (and pages) as needed, then leaves y just
  // below the row(s) it used.
  const perRow = Math.max(1, Math.floor((USABLE_WIDTH + TILE_GAP) / (kind.tileWidth + TILE_GAP)));
  const rowHeight = tileHeight(kind);
  function placeTileRow(tiles) {
    for (let i = 0; i < tiles.length; i += perRow) {
      ensureRoom(rowHeight);
      tiles.slice(i, i + perRow).forEach((tile, col) => drawTile(tile, MARGIN + col * (kind.tileWidth + TILE_GAP), y, { text, rule }, kind));
      y -= rowHeight + 6;
    }
  }

  // Every half-day is meant to be read (and printed) as its own single page, so — other than the
  // very first — each one starts a fresh page rather than flowing into whatever room the previous
  // half-day happened to leave at the bottom of its own.
  doc.groups.forEach((group, i) => {
    if (i > 0) { startPage(); writeDocHead(); }
    if (group.heading) {
      ensureRoom(16);
      text(group.heading, MARGIN, y, { font: FONT_BOLD, size: 10, gray: 0.15 });
      y -= 16;
    }
    // All of this half-day's tables are packed into the same flowing grid: a short table (say, "Day
    // at leisure") sits right next to the next one instead of wasting the rest of its own row, and
    // only a table with more guests than fit in one tile spills into more tiles of its own, still
    // read left to right in order (as SPEC.md's "one list per activity" — just several per row).
    placeTileRow(group.tables.flatMap((table) => tilesFor(table, kind)));
  });
  startPage(); // flush whatever is left onto the final page
  return pages;
}

// Draws one tile (a table, or one chunk of a long one) with its top-left corner at (left, top), at
// the size and with the column headings `kind` says (see ACTIVITY_TILE / GUEST_TILE above). The
// title block and the column-heading block each always take up their own full, fixed height
// (TITLE_BLOCK_H, COLHEAD_H — see the constants above) whether or not there is actually a title to
// show, so every tile in a row is exactly the same height and the rows of every tile line up.
function drawTile(tile, left, top, { text, rule }, kind) {
  const { tileWidth, numColW, idColW, labels } = kind;
  if (tile.heading) {
    const heading = tile.count ? `${tile.heading}  (${tile.count})` : tile.heading;
    const lines = wrapText(heading, FONT_BOLD, TITLE_SIZE, tileWidth).slice(0, 2);
    lines.forEach((line, i) => text(line, left, top - TITLE_SIZE * 1.2 * (i + 1), { font: FONT_BOLD, size: TITLE_SIZE }));
    if (tile.detail) text(tile.detail, left, top - TITLE_SIZE * 1.2 * 2 - DETAIL_SIZE, { size: DETAIL_SIZE, gray: 0.45, maxWidth: tileWidth });
  }
  const headY = top - TITLE_BLOCK_H; // baseline of the column headings
  text(labels[0], left + numColW, headY, { font: FONT_BOLD, size: HEAD_SIZE, gray: 0.4, align: 'right' });
  text(labels[1], left + numColW + 8, headY, { font: FONT_BOLD, size: HEAD_SIZE, gray: 0.4 });
  text(labels[2], left + numColW + 8 + idColW, headY, { font: FONT_BOLD, size: HEAD_SIZE, gray: 0.4 });
  rule(left, headY - 3, tileWidth);

  const firstRowY = top - TILE_HEADER_H - ROW_H;
  const nameX = left + numColW + 8 + idColW;
  const nameW = tileWidth - numColW - 8 - idColW - 4;
  let number = tile.firstNumber;
  tile.rows.forEach((row, i) => {
    const rowY = firstRowY - i * ROW_H;
    if (!row.cont) text(String(number++), left + numColW, rowY, { size: CELL_SIZE, align: 'right' });
    text(row.id || '', left + numColW + 8, rowY, { size: CELL_SIZE, maxWidth: idColW });
    text(row.name, nameX, rowY, { size: CELL_SIZE, maxWidth: nameW });
  });
}

// ---------- Writing the bytes of the PDF file itself ----------

class ByteWriter {
  constructor() { this.bytes = []; }
  get length() { return this.bytes.length; }
  ascii(str) { for (let i = 0; i < str.length; i++) this.bytes.push(str.charCodeAt(i)); return this; }
  raw(byteArray) { for (const b of byteArray) this.bytes.push(b); return this; }
  append(other) { return this.raw(other.bytes); }
  toUint8Array() { return new Uint8Array(this.bytes); }
}

// WinAnsiEncoding matches plain Latin-1 for every accented letter (Grünewald, Sørensen, ...), but a
// handful of ordinary punctuation marks sit at a different byte than their Unicode codepoint — the
// app's own title text uses an em dash ("—"), and a long name is shortened with "…": without this
// table they would silently turn into "?" instead of the punctuation actually asked for.
const WINANSI_EXTRA = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

// A PDF "literal string" is written between ( and ): its own parentheses and backslashes must be
// escaped. Every character is written as a single byte using WinAnsiEncoding.
// A character with no WinAnsi byte (an emoji, another script) is shown as "?" rather than break the file.
function winAnsiBytes(text) {
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const byte = WINANSI_EXTRA[code] ?? (code <= 0xff ? code : 0x3f);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c); // \( \) \\
    bytes.push(byte);
  }
  return bytes;
}

function buildContentStream(items) {
  const out = new ByteWriter();
  // An item is grey (`gray`, 0 to 1, what every list export uses) or coloured (`rgb`, three numbers 0 to 1,
  // used by the confirmation cards' accent colour).
  const fill = (item) => (item.rgb ? `${item.rgb.map((v) => v.toFixed(3)).join(' ')} rg\n` : `${item.gray} g\n`);
  for (const item of items) {
    if (item.type === 'image') {
      out.ascii(`q\n${item.w.toFixed(2)} 0 0 ${item.h.toFixed(2)} ${item.x.toFixed(2)} ${item.y.toFixed(2)} cm\n/${item.name} Do\nQ\n`);
      continue;
    }
    if (item.type === 'rect') {
      out.ascii(`${fill(item)}${item.x.toFixed(2)} ${item.y.toFixed(2)} ${item.w.toFixed(2)} ${item.h.toFixed(2)} re\nf\n`);
      continue;
    }
    out.ascii(fill(item));
    out.ascii('BT\n');
    out.ascii(`/${item.font.resourceName} ${item.size} Tf\n`);
    out.ascii(`1 0 0 1 ${item.x.toFixed(2)} ${item.y.toFixed(2)} Tm\n(`);
    out.raw(winAnsiBytes(sanitizePdfText(item.text)));
    out.ascii(') Tj\nET\n');
  }
  return out;
}

// Turns pages of drawing instructions (from layoutPages) into the bytes of an actual .pdf file: a
// short list of numbered "objects" (the catalog, the page list, one page and one content stream per
// page, and the two fonts), followed by an index ("xref") telling a reader exactly where each starts.
// options.width/height: the page size (A4 landscape for the lists, A4 portrait for the cards).
// options.images: JPEG pictures to embed, each { name: 'Im1', bytes, width, height }, drawn by name.
function serializePdf(pages, { width = PAGE_WIDTH, height = PAGE_HEIGHT, images = [] } = {}) {
  const nPages = pages.length;
  const pagesObj = 2;
  const firstPageObj = 3;                     // page i -> firstPageObj + i*2, its content -> +1
  const fontRegularObj = firstPageObj + nPages * 2;
  const fontBoldObj = fontRegularObj + 1;
  const firstImageObj = fontBoldObj + 1;
  const lastObj = fontBoldObj + images.length;

  const out = new ByteWriter();
  const offsetOf = new Array(lastObj + 1);

  function object(num, writeBody) {
    offsetOf[num] = out.length;
    out.ascii(`${num} 0 obj\n`);
    writeBody();
    out.ascii('\nendobj\n');
  }

  out.ascii('%PDF-1.4\n');

  object(1, () => out.ascii(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`));

  const kids = pages.map((_, i) => `${firstPageObj + i * 2} 0 R`).join(' ');
  object(pagesObj, () => out.ascii(`<< /Type /Pages /Kids [${kids}] /Count ${nPages} >>`));

  const imageResources = images.length > 0
    ? ` /XObject << ${images.map((img, i) => `/${img.name} ${firstImageObj + i} 0 R`).join(' ')} >>` : '';

  pages.forEach((items, i) => {
    const pageObj = firstPageObj + i * 2;
    const contentObj = pageObj + 1;
    const content = buildContentStream(items);

    object(pageObj, () => out.ascii(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${width} ${height}] `
      + `/Resources << /Font << /F1 ${fontRegularObj} 0 R /F2 ${fontBoldObj} 0 R >>${imageResources} >> /Contents ${contentObj} 0 R >>`
    ));
    object(contentObj, () => { out.ascii(`<< /Length ${content.length} >>\nstream\n`); out.append(content); out.ascii('\nendstream'); });
  });

  object(fontRegularObj, () => out.ascii(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_REGULAR.baseFont} /Encoding /WinAnsiEncoding >>`));
  object(fontBoldObj, () => out.ascii(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BOLD.baseFont} /Encoding /WinAnsiEncoding >>`));

  // A JPEG is embedded as it is (the PDF format reads JPEG natively: "DCTDecode"), so no picture code is needed.
  images.forEach((img, i) => object(firstImageObj + i, () => {
    out.ascii(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
    out.raw(img.bytes);
    out.ascii('\nendstream');
  }));

  const xrefOffset = out.length;
  out.ascii(`xref\n0 ${lastObj + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= lastObj; n++) out.ascii(`${String(offsetOf[n]).padStart(10, '0')} 00000 n \n`);
  out.ascii(`trailer\n<< /Size ${lastObj + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return out.toUint8Array();
}

// The one thing most of the app calls: doc (see layoutPages above) -> a ready-to-share PDF Blob.
export function buildListsPdf(doc) {
  const bytes = serializePdf(layoutPages(doc));
  return new Blob([bytes], { type: 'application/pdf' });
}

// The final export of the whole trip (SPEC.md, "5. Export"): every tour's guest list (toursDoc, the
// same shape as buildListsPdf's doc, just spanning every destination), followed by every guest's own
// day-by-day itinerary (guestsDoc: one table per guest, drawn at GUEST_TILE's wider size). Both parts
// land in the one file, tours first — the tour pages already know to start a fresh page per half-day;
// the guest pages just flow on continuously, since there is no single "half-day" they belong to.
export function buildFinalTripPdf(toursDoc, guestsDoc) {
  const pages = [...layoutPages(toursDoc, ACTIVITY_TILE), ...layoutPages(guestsDoc, GUEST_TILE)];
  return new Blob([serializePdf(pages)], { type: 'application/pdf' });
}

// ---------- The evening sheet: every restaurant of one evening, compact ----------
//
// The list the owner sends to the local team for a whole evening (SPEC.md, Phase 3 exports). Restaurants are never
// exported one by one. Layout rules (owner, 1 Oct 2026):
//   - Each restaurant has its own COLUMN, its name written once at the top; below it, its tables one under the other, each
//     with its own grey band ("18:45 · 3 people") and its guests' ID and name. No "ID / Name" headings.
//   - A table is never cut: if it does not fit at the bottom of the column, the whole table goes to the next column (or
//     page), under the restaurant's name again with "(cont.)". Only a table taller than a whole column is split.
//   - Landscape or portrait is chosen for whichever needs fewer pages (landscape when equal).
// The doc looks like:
//   { title, updatedLine, blocks: [ { restaurant, seating, count,
//       tables: [ { special: true|false, rows: [ { id, name } ] } ],
//       needs: [ { id, name, text } ] } ] }        one block per table; needs only exist when the owner ticked "Include dietary needs"
// Everything is drawn at a scale (evK): 1 is the compact size; when there is little to show, the sheet is scaled up so the
// writing is as big as the page allows (owner, 1 Oct 2026: "optimise the size so it is as readable as possible on A4").
let evK = 1;
const EVENING_GAP = 12;
const EV = {
  get rowH() { return 10.5 * evK; }, get size() { return 8 * evK; }, get headSize() { return 9.5 * evK; },
  get nameSize() { return 11 * evK; }, get idW() { return 30 * evK; }, get small() { return 7 * evK; },
};
const EVENING_LAYOUTS = [
  { width: 842, height: 595, cols: 5 }, // A4 landscape
  { width: 595, height: 842, cols: 4 }, // A4 portrait
];

// Draws pieces into their own little coordinate system (x from 0, y from 0 downwards, so y is negative) and reports the
// height used, so a piece can be measured first and only then placed in a column. Placing = moving every item by the same offset.
function evening_piece(colW, draw) {
  const items = [];
  const text = (str, x, y, { font = FONT_REGULAR, size = EV.size, gray = 0 } = {}) => items.push({ type: 'text', x, y, font, size, gray, text: str });
  const rect = (x, y, w, h, gray) => items.push({ type: 'rect', x, y, w, h, gray });
  const height = draw({ text, rect, colW });
  return { items, height };
}

let evBroken = 0; // how many times a single word had to be split across lines (a scaled-up layout must not add any)
const eveningLines = (str, size, width, font = FONT_REGULAR) => wrapText(str, font, size, width).flatMap((l) => {
  const parts = breakToWidth(l, font, size, width);
  if (parts.length > 1) evBroken += 1;
  return parts;
});

// The restaurant's name, once, at the top of its column (with "(cont.)" where a column carries on from the one before).
function eveningNameBox(name, cont, colW) {
  return evening_piece(colW, ({ text, rect }) => {
    const lines = eveningLines(`${name}${cont ? ' (cont.)' : ''}`, EV.nameSize, colW, FONT_BOLD);
    let y = 0;
    for (const line of lines) { y -= EV.nameSize + 2 * evK; text(line, 0, y, { font: FONT_BOLD, size: EV.nameSize }); }
    y -= 4 * evK;
    rect(0, y, colW, 1.2, 0.25);
    return -y + 6 * evK;
  });
}

// One table: grey band with the time and its own number of people, then the guests. `rows` may be part of a long table.
function eveningTableBox(block, rows, { first, last }, colW) {
  return evening_piece(colW, ({ text, rect }) => {
    const table = block.tables[0];
    const bandH = EV.headSize + 8 * evK;
    rect(0, -bandH, colW, bandH, 0.9);
    const label = `${block.seating}  ·  ${block.count} ${block.count === 1 ? 'person' : 'people'}${first ? '' : ' (cont.)'}`;
    text(label, 3, -EV.headSize - 3 * evK, { font: FONT_BOLD, size: EV.headSize });
    let y = -bandH - 1;
    if (table.special && first) { y -= EV.rowH; text('Special request', 3, y, { font: FONT_BOLD, size: EV.small, gray: 0.35 }); }
    const nameW = colW - EV.idW - 2;
    for (const row of rows) {
      eveningLines(row.name, EV.size, nameW).forEach((line, i) => {
        y -= EV.rowH;
        if (i === 0) text(row.id || '', 3, y);
        text(line, 3 + EV.idW, y);
      });
    }
    if (last && block.needs?.length > 0) {
      y -= 4 * evK;
      y -= EV.rowH; text('* Dietary needs', 3, y, { font: FONT_BOLD, size: EV.small, gray: 0.35 });
      for (const need of block.needs) {
        for (const line of eveningLines(`${need.id} ${need.name}: ${need.text}`, EV.small, colW - 3)) { y -= 9 * evK; text(line, 3, y, { size: EV.small }); }
      }
    }
    return -y + 10 * evK; // a little air before the next table
  });
}

// Lays the whole doc out for one page shape. Returns the pages and how many tables had to be carried over to another column.
function layoutEvening(doc, { width, height, cols }) {
  evBroken = 0;
  const colW = (width - MARGIN * 2 - EVENING_GAP * (cols - 1)) / cols;
  const bottom = MARGIN;
  const pages = [];
  let page = [];
  let col = 0;
  let y = 0;
  let top = 0;
  let carried = 0;

  const startPage = () => {
    if (page.length > 0) pages.push(page);
    page = [];
    y = height - MARGIN;
    for (const line of wrapText(doc.title, FONT_BOLD, 12, width - MARGIN * 2)) { page.push({ type: 'text', x: MARGIN, y: y - 10, font: FONT_BOLD, size: 12, gray: 0, text: line }); y -= 14; }
    page.push({ type: 'text', x: MARGIN, y: y - 8, font: FONT_REGULAR, size: 7.5, gray: 0.4, text: doc.updatedLine });
    y -= 20;
    top = y;
    col = 0;
  };
  const nextColumn = () => { col += 1; if (col >= cols) startPage(); else y = top; };
  const place = (box) => {
    const dx = MARGIN + col * (colW + EVENING_GAP);
    for (const item of box.items) page.push({ ...item, x: item.x + dx, y: item.y + y });
    y -= box.height;
  };

  startPage();
  // One group per restaurant, in the order the doc gives them (the blocks of one restaurant follow each other).
  const restaurants = [];
  for (const block of doc.blocks) {
    if (restaurants.at(-1)?.name !== block.restaurant) restaurants.push({ name: block.restaurant, blocks: [] });
    restaurants.at(-1).blocks.push(block);
  }
  restaurants.forEach((restaurant, index) => {
    if (index > 0) nextColumn(); // every restaurant starts its own column
    place(eveningNameBox(restaurant.name, false, colW));
    for (const block of restaurant.blocks) {
      let boxes = [eveningTableBox(block, block.tables[0].rows, { first: true, last: true }, colW)];
      const room = () => y - bottom;
      const columnRoom = top - bottom - eveningNameBox(restaurant.name, true, colW).height; // what a fresh column offers a table
      if (boxes[0].height > columnRoom) {
        // Taller than a whole column (very rare): the only case where a table is split, into pieces that each fit a column.
        const capacity = columnRoom - EV.headSize * 2 - 30 * evK;
        const chunks = [];
        let chunk = [];
        let used = 0;
        for (const row of block.tables[0].rows) {
          const h = eveningLines(row.name, EV.size, colW - EV.idW - 2).length * EV.rowH;
          if (used + h > capacity && chunk.length > 0) { chunks.push(chunk); chunk = []; used = 0; }
          chunk.push(row); used += h;
        }
        chunks.push(chunk);
        boxes = chunks.map((rows, i) => eveningTableBox(block, rows, { first: i === 0, last: i === chunks.length - 1 }, colW));
      }
      boxes.forEach((box) => {
        if (box.height > room()) {
          nextColumn();
          place(eveningNameBox(restaurant.name, true, colW));
          carried += 1;
        }
        place(box);
      });
    }
  });
  if (page.length > 0) pages.push(page);
  return { pages, carried, broken: evBroken };
}

// Picks the layout: landscape or portrait, whichever needs fewer pages (then fewer tables carried over; landscape when equal), and
// then the biggest scale at which it still needs no more pages (and carries no more tables) than the compact size does.
export function buildEveningPdf(doc) {
  const tries = [];
  for (const shape of EVENING_LAYOUTS) {
    evK = 1;
    const base = layoutEvening(doc, shape);
    let best = { shape, k: 1, ...base };
    for (let k = 2.4; k > 1.05; k -= 0.1) {
      evK = k;
      const scaled = layoutEvening(doc, shape);
      if (scaled.pages.length <= base.pages.length && scaled.carried <= base.carried && scaled.broken <= base.broken) { best = { shape, k, ...scaled }; break; }
    }
    tries.push(best);
  }
  evK = 1;
  tries.sort((a, b) => a.pages.length - b.pages.length || a.carried - b.carried || b.k - a.k); // stable: landscape first when all equal
  const best = tries[0];
  return new Blob([serializePdf(best.pages, { width: best.shape.width, height: best.shape.height })], { type: 'application/pdf' });
}

// ---------- Confirmation cards (Phase 3 exports, 30 Sep 2026) ----------
//
// One card per travel party per table, six to an A4 portrait page (2 across, 3 down), each ready to cut
// out and hand to the guests. Every card is the same fixed template; only what is written on it changes:
//   card  { eyebrow, names, title, subtitle, mates: [text, ...], matesLabel }   (built by export.js)
//         title is the big line (a restaurant, or a group name); subtitle the line under it (a seating time,
//         or a group's details); titleSize (optional) makes the title bigger; mates the small list at the bottom, headed by matesLabel (may be empty)
//   brand { companyName, accent, cardNote, logo: { data, width, height } | null }   (Settings > Brand)
// Cards never carry dietary information (CLAUDE.md), and nothing here is specific to one company: the
// name, logo, colour and note all come from `brand`.

const CARD_PAGE = { width: 595, height: 842 };
const CARD_MARGIN = 28;
const CARD_COLS = 2;
const CARD_ROWS = 3;

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const paler = (rgb, amount) => rgb.map((v) => 1 - (1 - v) * amount); // amount 0.12 = a very light wash of the colour

// Lays one card out at `scale` (1 = the first, small version; the cards are then made as big as fit).
// With `items` null nothing is drawn: it only measures. Returns how tall the content is.
function layoutCard(items, card, brand, accent, logoImage, left, top, width, height, scale) {
  const s = scale;
  const cx = left + width / 2;
  const inner = width - 32;
  let y = top;
  const put = (item) => { if (items) items.push(item); };

  // Centres up to maxLines of text, moving y down as it goes.
  function centered(str, size, { font = FONT_REGULAR, gray = 0, rgb, maxLines = 2, gap = 1.25 } = {}) {
    for (const line of wrapText(str, font, size, inner).slice(0, maxLines)) {
      y -= size * 0.8; // down to the baseline of this line
      put({ type: 'text', x: cx - textWidth(line, font, size) / 2, y, font, size, gray, rgb, text: line });
      y -= size * (gap - 0.8);
    }
  }

  if (logoImage) {
    const fit = Math.min((150 * s) / logoImage.width, (44 * s) / logoImage.height);
    const w = logoImage.width * fit, h = logoImage.height * fit;
    put({ type: 'image', name: logoImage.name, x: cx - w / 2, y: y - h, w, h });
    y -= h + 10 * s;
  } else if (brand.companyName) {
    centered(brand.companyName, 12 * s, { font: FONT_BOLD, rgb: accent, maxLines: 1, gap: 1.5 });
    y -= 4 * s;
  }

  centered(card.eyebrow.toUpperCase(), 7 * s, { gray: 0.45, maxLines: 1, gap: 1.6 });
  y -= 2 * s;
  centered(card.names, 13 * s, { font: FONT_BOLD });
  y -= 8 * s;
  put({ type: 'rect', x: cx - 18 * s, y, w: 36 * s, h: 2, rgb: accent });
  y -= 14 * s;
  centered(card.title, (card.titleSize ?? 20) * s, { font: FONT_BOLD, gap: 1.15 });
  y -= 4 * s;
  if (card.subtitle) centered(card.subtitle, 14 * s, { font: FONT_BOLD, maxLines: 2, gap: 1.3 });

  if (brand.cardNote) {
    y -= 8 * s;
    const size = 8.5 * s;
    const lines = wrapText(brand.cardNote, FONT_REGULAR, size, inner - 16).slice(0, 4);
    const boxHeight = lines.length * size * 1.25 + 14 * s;
    put({ type: 'rect', x: left + 16, y: y - boxHeight, w: inner, h: boxHeight, rgb: paler(accent, 0.12) });
    put({ type: 'rect', x: left + 16, y: y - 2, w: inner, h: 2, rgb: accent });
    let lineY = y - 8 * s - size * 0.8;
    for (const line of lines) {
      put({ type: 'text', x: cx - textWidth(line, FONT_REGULAR, size) / 2, y: lineY, font: FONT_REGULAR, size, gray: 0.15, text: line });
      lineY -= size * 1.25;
    }
    y -= boxHeight;
  }

  if (card.mates.length > 0) {
    y -= 12 * s;
    centered(card.matesLabel.toUpperCase(), 7 * s, { gray: 0.5, maxLines: 1, gap: 1.6 });
    for (const mate of card.mates) centered(mate, 10.5 * s, { maxLines: 1, gap: 1.3 });
  }
  return top - y;
}

// The biggest size (1.0 to 2.0 times the small version) at which this card's content still fits.
function biggestScaleFor(card, brand, accent, logoImage, width, height) {
  for (let s = 2.0; s > 0.8; s -= 0.05) {
    if (layoutCard(null, card, brand, accent, logoImage, 0, 0, width, height, s) <= height - 24) return s;
  }
  return 0.8;
}

// The accent colour as three 0-1 numbers, and the logo (if any) ready to embed, from a trip's branding.
const accentOf = (brand) => hexToRgb(/^#[0-9a-f]{6}$/i.test(brand.accent ?? '') ? brand.accent : '#1d5c57');
function logoImageOf(brand) {
  if (!brand.logo) return null;
  const binary = atob(brand.logo.data.split(',')[1]);
  return { name: 'Im1', bytes: Uint8Array.from(binary, (c) => c.charCodeAt(0)), width: brand.logo.width, height: brand.logo.height };
}

export function buildCardsPdf(cards, brand = {}) {
  const accent = accentOf(brand);
  const logoImage = logoImageOf(brand);

  const cardWidth = (CARD_PAGE.width - CARD_MARGIN * 2) / CARD_COLS;
  const cardHeight = (CARD_PAGE.height - CARD_MARGIN * 2) / CARD_ROWS;
  const perPage = CARD_COLS * CARD_ROWS;
  // ONE size for every card, so the page looks even: the biggest at which the fullest card still fits.
  // Each card is then centred top to bottom in its own frame, so no card is left with a blank half.
  const scale = cards.length === 0 ? 1 : Math.min(...cards.map((c) => biggestScaleFor(c, brand, accent, logoImage, cardWidth, cardHeight)));
  const pages = [];
  for (let start = 0; start < cards.length; start += perPage) {
    const items = [];
    cards.slice(start, start + perPage).forEach((card, i) => {
      const left = CARD_MARGIN + (i % CARD_COLS) * cardWidth;
      const top = CARD_PAGE.height - CARD_MARGIN - Math.floor(i / CARD_COLS) * cardHeight;
      // The four thin lines around the card: cutting guides.
      const guide = 0.85;
      items.push({ type: 'rect', x: left, y: top - cardHeight, w: cardWidth, h: 0.5, gray: guide });
      items.push({ type: 'rect', x: left, y: top - 0.5, w: cardWidth, h: 0.5, gray: guide });
      items.push({ type: 'rect', x: left, y: top - cardHeight, w: 0.5, h: cardHeight, gray: guide });
      items.push({ type: 'rect', x: left + cardWidth - 0.5, y: top - cardHeight, w: 0.5, h: cardHeight, gray: guide });
      const used = layoutCard(null, card, brand, accent, logoImage, left, top, cardWidth, cardHeight, scale);
      layoutCard(items, card, brand, accent, logoImage, left, top - Math.max(0, (cardHeight - used) / 2), cardWidth, cardHeight, scale);
    });
    pages.push(items);
  }
  const bytes = serializePdf(pages, { width: CARD_PAGE.width, height: CARD_PAGE.height, images: logoImage ? [logoImage] : [] });
  return new Blob([bytes], { type: 'application/pdf' });
}

// ---------- Printable group lists (Settings > Groups) ----------
//
// One group per A4 portrait page, ready to print and hand to whoever runs that bus or boat: the company's
// logo and the split's name across the top, the group's name big, then a clean numbered table with an empty
// tick box on each line. A group with more names than fit continues on the next page under the same
// heading. Anyone not placed in a group yet gets a final page of their own, so nobody silently drops out.
//   data  { title, details, updatedLine, groups: [{ name, countText, rows: [{id, name}] }], unplaced: [{id, name}] }
//   brand { companyName, accent, logo }   (Settings > Brand)
// Never carries dietary information (CLAUDE.md).

// ---------- Groups: the checklist per group, and the one-page overview (owner, 1 Oct 2026) ----------
//
// Two PDFs for a split (a bus split, a boat, a guided tour...), both dressed in the company's look (logo, colour):
//   - the checklists: one A4 page per group, a bold colour band with the group's name, then the guests with a box to tick.
//     The rows are made as tall as the page allows (a small group gets big, easy lines); a long group continues on more pages.
//   - the overview: ALL groups side by side as columns on ONE page (A4 portrait, or landscape when there are many groups),
//     with the writing as big as fits. Only when even that cannot fit does it carry on onto a second page.
// data = { title, details, updatedLine, groups: [ { name, countText, rows: [ { id, name, note? } ] } ], unplaced: [ rows ] }

const WHITE = [1, 1, 1];
const putIn = (items) => (str, x, y, { font = FONT_REGULAR, size = 10, gray = 0, rgb, align = 'left', maxWidth } = {}) => {
  const shown = maxWidth ? fitOneLine(str, font, size, maxWidth) : str;
  const width = textWidth(shown, font, size);
  items.push({ type: 'text', x: align === 'right' ? x - width : align === 'center' ? x - width / 2 : x, y, font, size, gray, rgb, text: shown });
};
const boxIn = (items) => (x, y, size, gray = 0.45) => { // an empty square to tick, drawn as four thin lines
  const t = 0.9;
  items.push({ type: 'rect', x, y, w: size, h: t, gray }, { type: 'rect', x, y: y + size - t, w: size, h: t, gray });
  items.push({ type: 'rect', x, y, w: t, h: size, gray }, { type: 'rect', x: x + size - t, y, w: t, h: size, gray });
};
// The biggest font size (from `from` down to `to`) at which `str` still fits `width`.
const fitSize = (str, font, from, to, width) => { let size = from; while (size > to && textWidth(str, font, size) > width) size -= 0.5; return size; };

// The logo (or, without one, the company's name) in the top right corner of a coloured band of height bandH at the page top.
function bandBadge(items, put, brand, logoImage, pageW, pageTop, bandH, margin) {
  const w = 128, h = 58;
  const x = pageW - margin - w, y = pageTop - bandH + (bandH - h) / 2;
  if (logoImage) {
    items.push({ type: 'rect', x, y, w, h, rgb: WHITE });
    const k = Math.min((w - 16) / logoImage.width, (h - 14) / logoImage.height);
    items.push({ type: 'image', name: logoImage.name, x: x + (w - logoImage.width * k) / 2, y: y + (h - logoImage.height * k) / 2, w: logoImage.width * k, h: logoImage.height * k });
  } else if (brand.companyName) {
    put(brand.companyName, pageW - margin, y + h / 2 - 4, { font: FONT_BOLD, size: fitSize(brand.companyName, FONT_BOLD, 16, 8, w + 20), rgb: WHITE, align: 'right', maxWidth: w + 20 });
  }
}

const CHECK_W = 595, CHECK_H = 842, CHECK_MARGIN = 36, CHECK_BAND = 128, CHECK_MIN_ROW = 28, CHECK_MAX_ROW = 58;
const CHECK_TABLE_TOP = CHECK_H - CHECK_BAND - 44;           // where the rows start
const CHECK_TABLE_ROOM = CHECK_TABLE_TOP - 64;               // room for rows above the footer
const CHECK_ROWS_PER_COLUMN = Math.floor(CHECK_TABLE_ROOM / CHECK_MIN_ROW);
const CHECK_GAP = 24; // between two columns of names

function drawChecklistPage(plan, number, total, data, brand, accent, logoImage) {
  const items = [];
  const put = putIn(items), box = boxIn(items);
  const left = CHECK_MARGIN, right = CHECK_W - CHECK_MARGIN;
  const bandTop = CHECK_H;

  // The colour band: the split's name small, the group's name huge, its count and the details underneath.
  items.push({ type: 'rect', x: 0, y: bandTop - CHECK_BAND, w: CHECK_W, h: CHECK_BAND, rgb: accent });
  items.push({ type: 'rect', x: 0, y: bandTop - CHECK_BAND - 3, w: CHECK_W, h: 3, rgb: paler(accent, 0.55) });
  const nameRoom = right - left - 150;
  const title = plan.section.heading + (plan.continued ? ' (continued)' : '');
  put(data.title.toUpperCase(), left, bandTop - 34, { font: FONT_BOLD, size: 10, rgb: paler(accent, 0.3), maxWidth: nameRoom });
  put(title, left, bandTop - 80, { font: FONT_BOLD, size: fitSize(title, FONT_BOLD, 40, 18, nameRoom), rgb: WHITE, maxWidth: nameRoom });
  const sub = [plan.section.countText, data.details].filter(Boolean).join('   ·   ');
  put(sub, left, bandTop - 106, { size: 11, rgb: paler(accent, 0.2), maxWidth: nameRoom });
  bandBadge(items, put, brand, logoImage, CHECK_W, bandTop, CHECK_BAND, CHECK_MARGIN);

  // The rows fill the page as one, two or three columns (filled top to bottom, then the next column), as tall as the page allows.
  const { cols, rowH } = plan;
  const colW = (right - left - CHECK_GAP * (cols - 1)) / cols;
  const perColumn = Math.ceil(plan.rows.length / cols);
  const boxSize = Math.min(24, rowH * 0.5);
  const idW = 40, numW = 24;
  const guestRoom = colW - numW - idW - boxSize - 20;
  const longest = plan.rows.reduce((w, r) => Math.max(w, textWidth(r.name, FONT_BOLD, 10)), 1);
  const nameSize = Math.min(20, rowH * 0.46, Math.max(8, (guestRoom / longest) * 10)); // as big as the tallest row and the longest name allow
  const noteSize = Math.min(9, nameSize * 0.6);
  plan.rows.forEach((row, i) => {
    const c = Math.floor(i / perColumn), r = i % perColumn;
    const x = left + c * (colW + CHECK_GAP);
    const rowTop = CHECK_TABLE_TOP - r * rowH;
    if (r % 2 === 0) items.push({ type: 'rect', x, y: rowTop - rowH, w: colW, h: rowH, rgb: paler(accent, 0.08) });
    const mid = rowTop - rowH / 2;
    put(String(plan.first + i + 1), x + numW - 4, mid - nameSize * 0.3, { size: nameSize * 0.7, gray: 0.5, align: 'right' });
    if (row.note) {
      put(row.name, x + numW + 2, mid + 1, { font: FONT_BOLD, size: nameSize, maxWidth: guestRoom });
      put(row.note, x + numW + 2, mid - noteSize - 1, { size: noteSize, gray: 0.5, maxWidth: guestRoom });
    } else {
      put(row.name, x + numW + 2, mid - nameSize * 0.35, { font: FONT_BOLD, size: nameSize, maxWidth: guestRoom });
    }
    put(row.id ?? '', x + colW - boxSize - 12, mid - nameSize * 0.3, { size: nameSize * 0.7, gray: 0.5, align: 'right', maxWidth: idW });
    box(x + colW - boxSize - 5, mid - boxSize / 2, boxSize, 0.35);
  });
  if (plan.rows.length === 0 && plan.section.empty) put(plan.section.empty, left + 12, CHECK_TABLE_TOP - 30, { gray: 0.45, size: 12 });

  // The footer: a colour rule, when it was made, and the page number.
  items.push({ type: 'rect', x: left, y: 48, w: right - left, h: 1.5, rgb: accent });
  put(brand.companyName ? `${brand.companyName}  ·  ${data.updatedLine}` : data.updatedLine, left, 32, { size: 7.5, gray: 0.45, maxWidth: 420 });
  put(`Page ${number} of ${total}`, right, 32, { size: 7.5, gray: 0.45, align: 'right' });
  return items;
}

export function buildGroupsPdf(data, brand = {}) {
  const accent = accentOf(brand);
  const logoImage = logoImageOf(brand);
  const sections = data.groups.map((g) => ({ heading: g.name, countText: g.countText, rows: g.rows, empty: 'Nobody in this group yet.' }));
  if (data.unplaced.length > 0) {
    sections.push({ heading: 'Not in a group yet', countText: `${data.unplaced.length} ${data.unplaced.length === 1 ? 'guest' : 'guests'}`, rows: data.unplaced, empty: '' });
  }
  const plans = [];
  for (const section of sections) {
    // The fewest columns (1 to 3) that hold the whole group on ONE page; a group too long even for three columns runs over more pages.
    // (Over 10 guests is already two columns: names, ID and box stay close together, and the writing can be bigger.)
    const cols = [1, 2, 3].find((c) => section.rows.length <= (c === 1 ? 10 : c * CHECK_ROWS_PER_COLUMN)) ?? 3;
    const perPage = cols * CHECK_ROWS_PER_COLUMN;
    const pageCount = Math.max(1, Math.ceil(section.rows.length / perPage));
    for (let i = 0; i < pageCount; i++) {
      const rows = section.rows.slice(i * perPage, (i + 1) * perPage);
      // Rows as tall as the page allows (big and easy to read), whatever the number of guests.
      const rowH = pageCount === 1 ? Math.min(CHECK_MAX_ROW, Math.max(CHECK_MIN_ROW, CHECK_TABLE_ROOM / Math.max(Math.ceil(rows.length / cols), 1))) : CHECK_MIN_ROW;
      plans.push({ section, rows, rowH, cols, first: i * perPage, continued: i > 0 });
    }
  }
  const pages = plans.map((plan, i) => drawChecklistPage(plan, i + 1, plans.length, data, brand, accent, logoImage));
  const bytes = serializePdf(pages, { width: CHECK_W, height: CHECK_H, images: logoImage ? [logoImage] : [] });
  return new Blob([bytes], { type: 'application/pdf' });
}

// ----- The overview: every group a column, all on one page -----

const OVERVIEW_SHAPES = [{ width: 595, height: 842 }, { width: 842, height: 595 }]; // portrait first: a tie goes to portrait
const OVERVIEW_MARGIN = 30, OVERVIEW_GAP = 10, OVERVIEW_BAND = 78, OVERVIEW_HEAD = 34;

// How the columns would look at one font size on one page shape: how many pages it takes, and whether every name fits its column.
function overviewFit(columns, shape, size) {
  const colW = (shape.width - OVERVIEW_MARGIN * 2 - OVERVIEW_GAP * (columns.length - 1)) / columns.length;
  const numW = size * 1.9, idW = size * 2.6;
  const nameW = colW - numW - idW - 8;
  const longest = Math.max(0, ...columns.flatMap((c) => c.rows.map((r) => textWidth(r.name, FONT_BOLD, size))));
  const namesFit = longest <= nameW;
  const rowH = size * 1.75;
  const room = shape.height - OVERVIEW_MARGIN - OVERVIEW_BAND - OVERVIEW_HEAD - 40;
  const perPage = Math.max(1, Math.floor(room / rowH));
  const most = Math.max(1, ...columns.map((c) => c.rows.length));
  // On one page, spare height goes into taller rows (airier, easier to read) rather than being left empty.
  const tallRowH = perPage >= most ? Math.min(size * 2.7, room / most) : rowH;
  return { colW, numW, idW, rowH: Math.max(rowH, tallRowH), perPage, pages: Math.ceil(most / perPage), size, shape, namesFit };
}

function drawOverviewPage(fit, pageIndex, columns, data, brand, accent, logoImage) {
  const items = [];
  const put = putIn(items);
  const { shape, colW, numW, idW, rowH, perPage, size } = fit;
  const W = shape.width, H = shape.height;

  // The colour band across the top: the split's name and details, the logo on the right.
  items.push({ type: 'rect', x: 0, y: H - OVERVIEW_BAND, w: W, h: OVERVIEW_BAND, rgb: accent });
  const roomForTitle = W - OVERVIEW_MARGIN * 2 - 150;
  put(data.title, OVERVIEW_MARGIN, H - 40, { font: FONT_BOLD, size: fitSize(data.title, FONT_BOLD, 26, 14, roomForTitle), rgb: WHITE, maxWidth: roomForTitle });
  if (data.details) put(data.details, OVERVIEW_MARGIN, H - 60, { size: 11, rgb: paler(accent, 0.2), maxWidth: roomForTitle });
  bandBadge(items, put, brand, logoImage, W, H, OVERVIEW_BAND, OVERVIEW_MARGIN);

  const top = H - OVERVIEW_BAND - 14;
  columns.forEach((col, c) => {
    const x = OVERVIEW_MARGIN + c * (colW + OVERVIEW_GAP);
    const colAccent = col.unplaced ? [0.45, 0.45, 0.45] : accent;
    // the column's head: the group's name and count on its colour
    items.push({ type: 'rect', x, y: top - OVERVIEW_HEAD, w: colW, h: OVERVIEW_HEAD, rgb: colAccent });
    put(col.name, x + 8, top - 15, { font: FONT_BOLD, size: fitSize(col.name, FONT_BOLD, 13, 8, colW - 16), rgb: WHITE, maxWidth: colW - 16 });
    put(col.countText, x + 8, top - 28, { size: 8, rgb: paler(colAccent, 0.25), maxWidth: colW - 16 });
    const slice = col.rows.slice(pageIndex * perPage, (pageIndex + 1) * perPage);
    slice.forEach((row, i) => {
      const rowTop = top - OVERVIEW_HEAD - i * rowH;
      if (i % 2 === 0) items.push({ type: 'rect', x, y: rowTop - rowH, w: colW, h: rowH, rgb: paler(colAccent, 0.09) });
      const base = rowTop - rowH / 2 - size * 0.34;
      put(String(pageIndex * perPage + i + 1), x + numW - 2, base, { size: size * 0.75, gray: 0.5, align: 'right' });
      put(row.name, x + numW + 4, base, { font: FONT_BOLD, size, maxWidth: colW - numW - idW - 8 });
      put(row.id ?? '', x + colW - 4, base, { size: size * 0.75, gray: 0.5, align: 'right', maxWidth: idW });
    });
    // a thin colour rule under the last row of the column
    items.push({ type: 'rect', x, y: top - OVERVIEW_HEAD - Math.max(slice.length, 1) * rowH - 1, w: colW, h: 1.2, rgb: colAccent });
  });

  items.push({ type: 'rect', x: OVERVIEW_MARGIN, y: 34, w: W - OVERVIEW_MARGIN * 2, h: 1, rgb: accent });
  put(brand.companyName ? `${brand.companyName}  ·  ${data.updatedLine}` : data.updatedLine, OVERVIEW_MARGIN, 22, { size: 7.5, gray: 0.45, maxWidth: W - OVERVIEW_MARGIN * 2 - 80 });
  if (fit.pages > 1) put(`Page ${pageIndex + 1} of ${fit.pages}`, W - OVERVIEW_MARGIN, 22, { size: 7.5, gray: 0.45, align: 'right' });
  return items;
}

export function buildGroupsOverviewPdf(data, brand = {}) {
  const accent = accentOf(brand);
  const logoImage = logoImageOf(brand);
  const columns = data.groups.map((g) => ({ name: g.name, countText: g.countText, rows: g.rows }));
  if (data.unplaced.length > 0) columns.push({ name: 'Not in a group', countText: `${data.unplaced.length} ${data.unplaced.length === 1 ? 'guest' : 'guests'}`, rows: data.unplaced, unplaced: true });
  // Try both page shapes and every size from big to small: fewest pages first, then the biggest writing.
  let best = null;
  for (const shape of OVERVIEW_SHAPES) {
    for (let size = 16; size >= 6; size -= 0.5) {
      const fit = overviewFit(columns, shape, size);
      if (!fit.namesFit) continue;
      if (!best || fit.pages < best.pages || (fit.pages === best.pages && fit.size > best.size)) best = fit;
      break; // sizes only get smaller from here
    }
  }
  best ??= overviewFit(columns, OVERVIEW_SHAPES[1], 6); // very many groups: smallest writing, a long name is cut short with "..."
  const pages = Array.from({ length: best.pages }, (_, i) => drawOverviewPage(best, i, columns, data, brand, accent, logoImage));
  return new Blob([serializePdf(pages, { width: best.shape.width, height: best.shape.height, images: logoImage ? [logoImage] : [] })], { type: 'application/pdf' });
}
