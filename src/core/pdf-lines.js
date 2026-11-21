// Turns the text pieces pdf.js finds on each page into rows of "cells".
// Pure functions: the browser (src/pdf.js) and the tests both use them.
//
// Common App preview PDFs mark their structure with formatting, not wording:
// headings are big bold text, labels are bold, answers are regular text in a
// second column. So we keep each piece's position, size and boldness.
// PDF positions are measured from the bottom-left corner: a bigger y is higher up.

/** Text smaller than this is page chrome (Common App's footer is 9 pt). */
const MIN_CONTENT_HEIGHT = 10;
/** Text at least this big is a heading; whatever font it uses is the bold font. */
const HEADING_HEIGHT = 16;

/**
 * Keeps only what we need from pdf.js text items.
 * @param {Array<{ str: string, transform: number[], width: number, height: number, fontName: string }>} items
 * @returns {Array<{ str: string, x: number, y: number, width: number, height: number, font: string }>}
 */
export function toPlainItems(items) {
  return items
    .filter((item) => typeof item.str === 'string' && item.str.trim().length > 0)
    .map((item) => ({
      str: item.str,
      x: round(item.transform[4]),
      y: round(item.transform[5]),
      width: round(item.width),
      height: round(item.height),
      font: item.fontName,
    }));
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Groups every page's items into rows of cells, top to bottom, in reading order.
 *
 * - Drops page chrome: tiny text (footers) and, on page 1, anything above the
 *   first heading (Common App's applicant header block).
 * - Marks text bold if it uses the same font as the headings.
 * - Splits each row into cells at big horizontal gaps (the label column and
 *   the answer column are separate cells).
 *
 * @param {ReturnType<typeof toPlainItems>[]} pages
 * @returns {Array<{ page: number, y: number, height: number, cells: Array<{ x: number, end: number, text: string, bold: boolean, height: number }> }>}
 */
export function buildRows(pages, { yTolerance = 2 } = {}) {
  const boldFonts = new Set(pages.flat().filter((it) => it.height >= HEADING_HEIGHT).map((it) => it.font));
  const rows = [];

  pages.forEach((items, pageIndex) => {
    let content = items.filter((it) => it.height >= MIN_CONTENT_HEIGHT);
    if (pageIndex === 0) {
      const firstHeading = content.find((it) => it.height >= HEADING_HEIGHT);
      if (firstHeading) content = content.filter((it) => it.y <= firstHeading.y + yTolerance);
    }

    const sorted = [...content].sort((a, b) => (Math.abs(a.y - b.y) <= yTolerance ? a.x - b.x : b.y - a.y));
    let row = null;
    for (const item of sorted) {
      if (!row || Math.abs(item.y - row.y) > yTolerance) {
        row = { page: pageIndex + 1, y: item.y, height: item.height, cells: [] };
        rows.push(row);
      }
      const bold = boldFonts.has(item.font);
      const last = row.cells.at(-1);
      const gap = last ? item.x - last.end : Infinity;
      if (last && gap < item.height * 1.5 && last.bold === bold) {
        // Same cell: pdf.js sometimes splits one run of text into pieces.
        const needsSpace = gap > item.height * 0.15 && !last.text.endsWith(' ') && !item.str.startsWith(' ');
        last.text += (needsSpace ? ' ' : '') + item.str;
        last.end = item.x + item.width;
      } else {
        row.cells.push({ x: item.x, end: item.x + item.width, text: item.str, bold, height: item.height });
      }
      row.height = Math.max(row.height, item.height);
    }
  });

  for (const row of rows) for (const cell of row.cells) cell.text = cell.text.replace(/\s+/g, ' ').trim();
  return rows;
}
