// A small PDF writer, built only for Tour Docs's own exports: plain pages with a title, a header
// line, and a list of activities and their guests. No pictures, no colours beyond grey text, and no
// custom font: it uses Helvetica, which is built into the PDF format itself, so nothing needs to be
// carried in the file (or in the app) to draw the letters.
//
// Written by hand, with no outside library, the same as everything else in Tour Docs. A PDF file is
// mostly plain text (a numbered list of "objects", plus an index at the end saying where each one
// starts); the only real work here is measuring text so it wraps at the right place, and writing
// that index correctly.

const PAGE_WIDTH = 595;  // A4, in points (1/72 inch) — a size every printer and phone understands
const PAGE_HEIGHT = 842;
const MARGIN = 48;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;

// ---------- Measuring text (so paragraphs wrap before they run off the page) ----------
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

function textWidth(text, font, size) {
  let units = 0;
  for (const ch of text) units += font.widths[ch.codePointAt(0)] ?? font.defaultWidth;
  return (units / 1000) * size;
}

// Splits text into lines that each fit maxWidth, breaking between words. A single word longer than
// a whole line is left on its own line rather than cut mid-word (a rare case, e.g. a very long name).
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

// ---------- Laying text out onto pages ----------
//
// A "doc" looks like:
//   { title, updatedLine, groups: [ { heading, sections: [ { heading, detail, count, names }, ... ] }, ... ] }
// `groups` are the half-days (only shown as their own heading when there is more than one), each with
// its activities as `sections` (an activity's name, its time/meeting point, its count, its guest names).
function layoutPages(doc) {
  const pages = [];
  let page = [];
  let y = PAGE_HEIGHT - MARGIN;

  function startPage() {
    if (page.length > 0) pages.push(page);
    page = [];
    y = PAGE_HEIGHT - MARGIN;
  }
  function ensureRoom(height) {
    if (y - height < MARGIN) startPage();
  }
  function write(text, { font = FONT_REGULAR, size = 10.5, gray = 0, gap } = {}) {
    const lineGap = gap ?? size * 1.3;
    ensureRoom(lineGap);
    page.push({ x: MARGIN, y, font, size, gray, text });
    y -= lineGap;
  }
  function paragraph(text, options) {
    for (const line of wrapText(text, options.font ?? FONT_REGULAR, options.size ?? 10.5, USABLE_WIDTH)) write(line, options);
  }

  write(doc.title, { font: FONT_BOLD, size: 17, gap: 24 });
  write(doc.updatedLine, { size: 10, gray: 0.4, gap: 26 });

  for (const group of doc.groups) {
    if (group.heading) {
      ensureRoom(30);
      write(group.heading, { font: FONT_BOLD, size: 13.5, gray: 0.2, gap: 20 });
    }
    for (const section of group.sections) {
      ensureRoom(34); // keep an activity's own heading with at least its first line
      const heading = section.count ? `${section.heading}  (${section.count})` : section.heading;
      write(heading, { font: FONT_BOLD, size: 12.5, gap: 16 });
      if (section.detail) write(section.detail, { size: 9.5, gray: 0.4, gap: 15 });
      if (section.names.length === 0) write('Nobody', { gray: 0.5, gap: 20 });
      else paragraph(section.names.join(', '), { size: 10.5, gap: 14 });
      y -= 10; // a little air before the next activity
    }
  }
  startPage(); // flush whatever is left onto the final page
  return pages;
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

// A PDF "literal string" is written between ( and ): its own parentheses and backslashes must be
// escaped. Every character is written as a single byte using WinAnsiEncoding, which is identical to
// plain Latin-1 for every accented letter Tour Docs is likely to use (Grünewald, Sørensen, ...).
// A character with no Latin-1 byte (an emoji, another script) is shown as "?" rather than break the file.
function winAnsiBytes(text) {
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const byte = code <= 0xff ? code : 0x3f;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c); // \( \) \\
    bytes.push(byte);
  }
  return bytes;
}

function buildContentStream(items) {
  const out = new ByteWriter();
  for (const item of items) {
    out.ascii(`${item.gray} g\n`);
    out.ascii('BT\n');
    out.ascii(`/${item.font.resourceName} ${item.size} Tf\n`);
    out.ascii(`1 0 0 1 ${item.x} ${item.y.toFixed(2)} Tm\n(`);
    out.raw(winAnsiBytes(item.text));
    out.ascii(') Tj\nET\n');
  }
  return out;
}

// Turns pages of text (from layoutPages) into the bytes of an actual .pdf file: a short list of
// numbered "objects" (the catalog, the page list, one page and one content stream per page, and the
// two fonts), followed by an index ("xref") telling a reader exactly where each object starts.
function serializePdf(pages) {
  const nPages = pages.length;
  const pagesObj = 2;
  const firstPageObj = 3;                     // page i -> firstPageObj + i*2, its content -> +1
  const fontRegularObj = firstPageObj + nPages * 2;
  const fontBoldObj = fontRegularObj + 1;
  const lastObj = fontBoldObj;

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

  pages.forEach((items, i) => {
    const pageObj = firstPageObj + i * 2;
    const contentObj = pageObj + 1;
    const content = buildContentStream(items);

    object(pageObj, () => out.ascii(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] `
      + `/Resources << /Font << /F1 ${fontRegularObj} 0 R /F2 ${fontBoldObj} 0 R >> >> /Contents ${contentObj} 0 R >>`
    ));
    object(contentObj, () => { out.ascii(`<< /Length ${content.length} >>\nstream\n`); out.append(content); out.ascii('\nendstream'); });
  });

  object(fontRegularObj, () => out.ascii(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_REGULAR.baseFont} /Encoding /WinAnsiEncoding >>`));
  object(fontBoldObj, () => out.ascii(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BOLD.baseFont} /Encoding /WinAnsiEncoding >>`));

  const xrefOffset = out.length;
  out.ascii(`xref\n0 ${lastObj + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= lastObj; n++) out.ascii(`${String(offsetOf[n]).padStart(10, '0')} 00000 n \n`);
  out.ascii(`trailer\n<< /Size ${lastObj + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return out.toUint8Array();
}

// The one thing the rest of the app calls: doc (see layoutPages above) -> a ready-to-share PDF Blob.
export function buildListsPdf(doc) {
  const bytes = serializePdf(layoutPages(doc));
  return new Blob([bytes], { type: 'application/pdf' });
}
