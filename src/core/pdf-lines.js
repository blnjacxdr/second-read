// Turns the text pieces pdf.js finds on each page into clean lines of text.
// Pure functions: the browser (src/pdf.js) and the tests both use them.
//
// pdf.js reports text as separate pieces, each with a position. PDF positions
// are measured from the bottom-left corner, so a bigger y is higher on the page.

/**
 * Keeps only what we need from pdf.js text items.
 * @param {Array<{ str: string, transform: number[], width: number, height: number }>} items
 * @returns {Array<{ str: string, x: number, y: number, width: number, height: number }>}
 */
export function toPlainItems(items) {
  return items
    .filter((item) => typeof item.str === 'string' && item.str.length > 0)
    .map((item) => ({
      str: item.str,
      x: round(item.transform[4]),
      y: round(item.transform[5]),
      width: round(item.width),
      height: round(item.height),
    }));
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Groups one page's items into lines, top to bottom, left to right.
 * Items whose y differs by at most `yTolerance` are on the same line. A space
 * is added between items when there's a visible gap and neither side has one.
 *
 * @param {Array<{ str: string, x: number, y: number, width: number, height: number }>} items
 * @returns {string[]}
 */
export function itemsToLines(items, { yTolerance = 2 } = {}) {
  const sorted = [...items].sort((a, b) => (Math.abs(a.y - b.y) <= yTolerance ? a.x - b.x : b.y - a.y));
  const lines = [];
  let current = null;
  for (const item of sorted) {
    if (!current || Math.abs(item.y - current.y) > yTolerance) {
      current = { y: item.y, text: item.str, end: item.x + item.width };
      lines.push(current);
      continue;
    }
    const gap = item.x - current.end;
    const needsSpace = gap > item.height * 0.15 && !current.text.endsWith(' ') && !item.str.startsWith(' ');
    current.text += (needsSpace ? ' ' : '') + item.str;
    current.end = item.x + item.width;
  }
  return lines.map((line) => line.text.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** A line's "shape" with numbers blanked, so "Page 2 of 5" and "Page 3 of 5" match. */
function lineShape(line) {
  return line.replace(/\d+/g, '#');
}

/**
 * Removes headers and footers: lines that sit in the top or bottom `edgeLines`
 * of most pages (at least `minShare` of them). Only page edges are checked, so
 * a repeated line inside the content, like "Activity 2", is never removed.
 *
 * @param {string[][]} pages  lines per page
 * @returns {string[][]}
 */
export function removeRepeatedLines(pages, { edgeLines = 2, minShare = 0.8 } = {}) {
  if (pages.length < 2) return pages.map((lines) => [...lines]);

  const edgeIndexes = (lines) => {
    const indexes = new Set();
    for (let i = 0; i < Math.min(edgeLines, lines.length); i++) {
      indexes.add(i);
      indexes.add(lines.length - 1 - i);
    }
    return indexes;
  };

  const pagesWithShape = new Map();
  pages.forEach((lines, pageNumber) => {
    for (const i of edgeIndexes(lines)) {
      const shape = lineShape(lines[i]);
      if (!pagesWithShape.has(shape)) pagesWithShape.set(shape, new Set());
      pagesWithShape.get(shape).add(pageNumber);
    }
  });

  const repeated = new Set(
    [...pagesWithShape].filter(([, pageSet]) => pageSet.size / pages.length >= minShare).map(([shape]) => shape),
  );

  return pages.map((lines) => {
    const edges = edgeIndexes(lines);
    return lines.filter((line, i) => !(edges.has(i) && repeated.has(lineShape(line))));
  });
}
