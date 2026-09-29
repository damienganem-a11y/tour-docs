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
function wrappedRows(table, kind) {
  if (!table.wrap) return table.rows;
  const nameW = kind.tileWidth - kind.numColW - 8 - kind.idColW - 4;
  const breakLong = (line) => { // a single word wider than the column is split, never dropped
    const parts = [];
    let rest = line;
    while (textWidth(rest, FONT_REGULAR, CELL_SIZE) > nameW && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && textWidth(rest.slice(0, cut), FONT_REGULAR, CELL_SIZE) > nameW) cut--;
      parts.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    parts.push(rest);
    return parts;
  };
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

// ---------- Confirmation cards (Phase 3 exports, 30 Sep 2026) ----------
//
// One card per travel party per table, six to an A4 portrait page (2 across, 3 down), each ready to cut
// out and hand to the guests. Every card is the same fixed template; only what is written on it changes:
//   card  { eyebrow, names, restaurant, time, tablemates: [text, ...] }   (built by export.js)
//   brand { companyName, accent, cardNote, logo: { data, width, height } | null }   (Settings > Brand)
// Cards never carry dietary information (CLAUDE.md), and nothing here is specific to one company: the
// name, logo, colour and note all come from `brand`.

const CARD_PAGE = { width: 595, height: 842 };
const CARD_MARGIN = 28;
const CARD_COLS = 2;
const CARD_ROWS = 3;

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const paler = (rgb, amount) => rgb.map((v) => 1 - (1 - v) * amount); // amount 0.12 = a very light wash of the colour

function drawCard(items, card, brand, accent, logoImage, left, top, width, height) {
  const cx = left + width / 2;
  const inner = width - 40;
  let y = top - 24;
  const bottom = top - height + 14;

  // Centres up to maxLines of text, moving y down as it goes.
  function centered(str, size, { font = FONT_REGULAR, gray = 0, rgb, maxLines = 2, gap = 1.25 } = {}) {
    for (const line of wrapText(str, font, size, inner).slice(0, maxLines)) {
      items.push({ type: 'text', x: cx - textWidth(line, font, size) / 2, y, font, size, gray, rgb, text: line });
      y -= size * gap;
    }
  }

  // The four thin lines around the card: cutting guides.
  const guide = 0.85;
  items.push({ type: 'rect', x: left, y: top - height, w: width, h: 0.5, gray: guide });
  items.push({ type: 'rect', x: left, y: top - 0.5, w: width, h: 0.5, gray: guide });
  items.push({ type: 'rect', x: left, y: top - height, w: 0.5, h: height, gray: guide });
  items.push({ type: 'rect', x: left + width - 0.5, y: top - height, w: 0.5, h: height, gray: guide });

  if (logoImage) {
    const scale = Math.min(130 / logoImage.width, 34 / logoImage.height);
    const w = logoImage.width * scale, h = logoImage.height * scale;
    items.push({ type: 'image', name: logoImage.name, x: cx - w / 2, y: y - h, w, h });
    y -= h + 10;
  } else if (brand.companyName) {
    centered(brand.companyName, 11, { font: FONT_BOLD, rgb: accent, maxLines: 1, gap: 1.6 });
  }

  centered(card.eyebrow.toUpperCase(), 6.5, { gray: 0.45, maxLines: 1, gap: 2 });
  centered(card.names, 11, { font: FONT_BOLD });
  y -= 2;
  items.push({ type: 'rect', x: cx - 15, y, w: 30, h: 1.5, rgb: accent });
  y -= 30; // room for the big restaurant name's tall letters below the line
  centered(card.restaurant, 17, { font: FONT_BOLD, gap: 1.2 });
  y -= 2;
  centered(card.time, 12, { font: FONT_BOLD, maxLines: 1, gap: 1.6 });

  if (brand.cardNote) {
    y -= 4;
    const lines = wrapText(brand.cardNote, FONT_REGULAR, 7, inner - 16).slice(0, 3);
    const boxHeight = lines.length * 9 + 10;
    items.push({ type: 'rect', x: left + 20, y: y - boxHeight, w: inner, h: boxHeight, rgb: paler(accent, 0.12) });
    items.push({ type: 'rect', x: left + 20, y: y - 1.5, w: inner, h: 1.5, rgb: accent });
    let lineY = y - 12;
    for (const line of lines) {
      items.push({ type: 'text', x: cx - textWidth(line, FONT_REGULAR, 7) / 2, y: lineY, font: FONT_REGULAR, size: 7, gray: 0.15, text: line });
      lineY -= 9;
    }
    y -= boxHeight + 10;
  }

  if (card.tablemates.length > 0 && y - 20 > bottom) {
    centered('AT YOUR TABLE', 6, { gray: 0.5, maxLines: 1, gap: 1.8 });
    for (const mate of card.tablemates) {
      if (y < bottom) break; // never past the bottom edge of the card
      centered(mate, 8, { maxLines: 1, gap: 1.3 });
    }
  }
}

export function buildCardsPdf(cards, brand = {}) {
  const accent = hexToRgb(/^#[0-9a-f]{6}$/i.test(brand.accent ?? '') ? brand.accent : '#1d5c57');
  let logoImage = null;
  if (brand.logo) {
    const binary = atob(brand.logo.data.split(',')[1]);
    logoImage = { name: 'Im1', bytes: Uint8Array.from(binary, (c) => c.charCodeAt(0)), width: brand.logo.width, height: brand.logo.height };
  }

  const cardWidth = (CARD_PAGE.width - CARD_MARGIN * 2) / CARD_COLS;
  const cardHeight = (CARD_PAGE.height - CARD_MARGIN * 2) / CARD_ROWS;
  const perPage = CARD_COLS * CARD_ROWS;
  const pages = [];
  for (let start = 0; start < cards.length; start += perPage) {
    const items = [];
    cards.slice(start, start + perPage).forEach((card, i) => {
      const left = CARD_MARGIN + (i % CARD_COLS) * cardWidth;
      const top = CARD_PAGE.height - CARD_MARGIN - Math.floor(i / CARD_COLS) * cardHeight;
      drawCard(items, card, brand, accent, logoImage, left, top, cardWidth, cardHeight);
    });
    pages.push(items);
  }
  const bytes = serializePdf(pages, { width: CARD_PAGE.width, height: CARD_PAGE.height, images: logoImage ? [logoImage] : [] });
  return new Blob([bytes], { type: 'application/pdf' });
}
