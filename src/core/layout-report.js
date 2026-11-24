// A privacy-safe summary of a PDF's layout, for debugging a PDF the reader
// can't read (Nov 22: a "final app" PDF gave 0 sections). It shows
// sizes, counts and positions, and heading text ONLY when the heading is a
// standard Common App label. Everything else is shown as its length, so a
// student can paste the report without sharing any of their writing.
import { MIN_CONTENT_HEIGHT, HEADING_HEIGHT } from './pdf-lines.js';

const KNOWN_LABELS = new Set([
  'profile', 'personal information', 'address', 'contact details', 'demographics', 'language', 'geography and nationality',
  'family', 'household', 'parent 1', 'parent 2', 'sibling', 'siblings', 'education', 'current or most recent school',
  'other secondary schools', 'colleges & universities', 'grades', 'courses & grades', 'current or most recent year courses',
  'honors', 'community-based organizations', 'future plans', 'testing', 'activities', 'activities and experiences',
  'writing', 'personal essay', 'additional information', 'disciplinary history', 'questions', 'academics', 'general',
  'recommenders', 'application', 'affirmations', 'signature', 'writing supplement', 'responsibilities and circumstances',
  'common app', 'common application', 'first-year application', 'member questions', 'college questions',
]);

/** A heading's text if it's a standard label, "<something> questions" if it's a college section, else its length only. */
export function safeLabel(text) {
  const t = text.trim();
  if (KNOWN_LABELS.has(t.toLowerCase())) return t;
  if (/ questions$/i.test(t)) return '[a college name] questions';
  return `[other text, ${t.length} characters]`;
}

const bucket = (n) => Math.round(n * 2) / 2;

/**
 * @param {Array<Array<{ str, x, y, width, height, font }>>} pages  toPlainItems for each page
 */
export function layoutReport(pages) {
  const items = pages.flat().filter((it) => it.str.trim());
  const heights = new Map();
  for (const it of items) heights.set(bucket(it.height), (heights.get(bucket(it.height)) ?? 0) + it.str.length);
  const sizes = [...heights.entries()].sort((a, b) => b[0] - a[0]).map(([h, chars]) => `${h} pt: ${chars} characters`);

  const fontsBySize = new Map();
  for (const it of items) {
    const key = it.font;
    const e = fontsBySize.get(key) ?? { maxHeight: 0, chars: 0 };
    e.maxHeight = Math.max(e.maxHeight, it.height); e.chars += it.str.length;
    fontsBySize.set(key, e);
  }
  const fonts = [...fontsBySize.values()].sort((a, b) => b.chars - a.chars)
    .map((f, i) => `font ${i + 1}: biggest ${bucket(f.maxHeight)} pt, ${f.chars} characters`);

  const xs = new Map();
  for (const it of items) { const x = Math.round(it.x / 10) * 10; xs.set(x, (xs.get(x) ?? 0) + 1); }
  const columns = [...xs.entries()].filter(([, n]) => n >= 15).sort((a, b) => a[0] - b[0]).map(([x, n]) => `x≈${x}: ${n}`);

  // The biggest text on each page, as safe labels, so we can see what the headings are called.
  const headings = [];
  const largest = Math.max(...items.map((it) => it.height));
  for (const [p, page] of pages.entries()) {
    for (const it of page) {
      if (it.str.trim() && it.height >= Math.min(HEADING_HEIGHT, largest * 0.7)) headings.push(`p${p + 1} ${bucket(it.height)} pt: ${safeLabel(it.str)}`);
    }
  }

  return {
    pages: pages.length,
    characters: items.reduce((n, it) => n + it.str.length, 0),
    droppedAsTooSmall: items.filter((it) => it.height < MIN_CONTENT_HEIGHT).reduce((n, it) => n + it.str.length, 0),
    hasHeadingSizedText: items.some((it) => it.height >= HEADING_HEIGHT),
    readerExpects: `headings ≥ ${HEADING_HEIGHT} pt, content ≥ ${MIN_CONTENT_HEIGHT} pt`,
    sizes, fonts, columns, headings: headings.slice(0, 60),
  };
}

/**
 * True when a PDF has pages but no readable text: every page is a picture of
 * text (made by "Microsoft Print to PDF", a scan, or a phone photo). Found on a
 * real application, Nov 22. The reader can't help; the student needs Common
 * App's own PDF, so the app says exactly that instead of "0 activities".
 */
export function isImageOnlyPdf(pages) {
  return pages.length > 0 && pages.every((page) => page.every((it) => !it.str.trim()));
}

/** What to tell the student, in plain words. */
export const IMAGE_ONLY_MESSAGE = 'This PDF is a picture of the application, so there is no text to read. '
  + 'It usually happens when a PDF is printed again ("Microsoft Print to PDF"), scanned, or photographed. '
  + 'In Common App, open Print preview for this college and download that PDF instead.';
