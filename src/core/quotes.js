// Quote verification. Adapted from Hashmark's verifyCitation().
//
// The one rule that matters most in Second Read: every flag shows two quotes,
// and each quote must appear word for word in the section it claims to come
// from. A flag whose quotes don't verify is dropped, never shown.
//
// Differences from Hashmark:
//   - Quotes point at a section of the user's application (sectionId), not at
//     a stored rule source. A quote that exists elsewhere in the document but
//     not in its claimed section fails.
//   - Text is normalized before matching, because PDF extraction and the
//     on-device model both change invisible details: line breaks and repeated
//     spaces, curly vs straight quotes, en/em dashes vs hyphens, and "..." vs "…".
//     Normalization never changes letters, digits or word order.
//   - Very short quotes are rejected (see MIN_WORDS), because a quote like "the"
//     would match almost anything and prove nothing.
//   - Non-letter, non-digit characters at the very start or end of a quote (or
//     of an ellipsis piece) are ignored: cutting a sentence changes its closing
//     mark, and small models add stray edge characters. Found in real
//     on-device runs: "until seven," came back "until seven.", and
//     "Hours per week: 6" came back "]Hours per week: 6".
//   - Matching ignores upper/lower case ("Every day" quoted as "every day").

/** A quote may skip words with " … " (space, ellipsis, space), as legal citations do. */
export const ELLIPSIS = ' … ';

/** A quote must have at least this many words, unless it is an entire short field. */
export const MIN_WORDS = 3;

/**
 * Makes text comparable without changing its words.
 * @param {string} text
 * @returns {string}
 */
export function normalizeForMatch(text) {
  return text
    .replace(/[‘’‚′]/g, "'") // curly single quotes, prime
    .replace(/[“”„″]/g, '"') // curly double quotes
    .replace(/[–—−]/g, '-') // en dash, em dash, minus
    .replace(/­/g, '') // soft hyphen (PDF line-break artifact)
    .replace(/\.\.\./g, '…') // three dots become one ellipsis character
    .replace(/\s+/g, ' ') // any run of whitespace becomes one space
    .trim();
}

/**
 * Removes anything that isn't a letter or digit from the very start and end
 * of a quote: punctuation, brackets, quote marks. When a quote cuts a
 * sentence, its closing mark is the quoter's choice, and small models add
 * stray edge characters. Everything from the first letter or digit to the
 * last must still match exactly, including punctuation inside.
 */
export function trimEdgePunctuation(text) {
  return text.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
}

function wordCount(text) {
  return text.split(' ').filter(Boolean).length;
}

/**
 * The same normalization as normalizeForMatch, lowercased, plus a map from
 * each character of the result back to the original text, so a match found in
 * normalized text can be shown exactly as the student wrote it.
 * @returns {{ norm: string, starts: number[], ends: number[] }}
 */
export function normalizeWithMap(text) {
  const SINGLE = { '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u2032': "'", '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u2033': '"', '\u2013': '-', '\u2014': '-', '\u2212': '-' };
  let norm = '';
  const starts = [];
  const ends = [];
  const emit = (str, start, end) => {
    for (const ch of str.toLowerCase()) {
      norm += ch;
      starts.push(start);
      ends.push(end);
    }
  };
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '\u00AD') { i += 1; continue; } // soft hyphen
    if (text.startsWith('...', i)) { emit('\u2026', i, i + 3); i += 3; continue; }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (norm.length > 0 && j < text.length) emit(' ', i, j); // trim: no leading or trailing space
      i = j;
      continue;
    }
    emit(SINGLE[ch] ?? ch, i, i + 1);
    i += 1;
  }
  return { norm, starts, ends };
}

/**
 * Finds `citation.quote` in the section it claims to come from, with the same
 * rules verifyQuote uses. Returns where it is in the original text, and that
 * original text (the student's own words, pieces joined with " … "), or null.
 *
 * @param {Record<string, string>} sections
 * @param {{ sectionId: string, quote: string }} citation
 * @returns {{ ranges: Array<{ start: number, end: number }>, text: string } | null}
 */
export function locateQuote(sections, citation) {
  if (!citation || typeof citation.quote !== 'string') return null;
  const raw = sections[citation.sectionId];
  if (typeof raw !== 'string') return null;

  // Lowercase both sides: quoting from mid-sentence often changes the first
  // letter's case ("Every day" quoted as "every day"), and case never changes
  // which words are matched.
  const { norm: source, starts, ends } = normalizeWithMap(raw);
  const quote = trimEdgePunctuation(normalizeForMatch(citation.quote)).toLowerCase();
  if (quote.length === 0) return null;

  const isWholeField = quote === source || quote === trimEdgePunctuation(source);
  if (!isWholeField && wordCount(quote.replaceAll('\u2026', ' ')) < MIN_WORDS) return null;

  const found = (ranges) => ({ ranges, text: ranges.map((r) => raw.slice(r.start, r.end)).join(ELLIPSIS) });
  const range = (at, length) => ({ start: starts[at], end: ends[at + length - 1] });

  const at = source.indexOf(quote);
  if (at !== -1) return found([range(at, quote.length)]);

  // Ellipsis form: every piece must appear, in order, without overlapping.
  // Spacing around the ellipsis is forgiven ("a … b", "a…b", "a ... b").
  // A leading or trailing ellipsis ("… the lab until 7") only marks a cut, so
  // it is ignored; an empty piece in the middle ("a … … b") is rejected.
  const pieces = quote.split('\u2026').map((piece) => trimEdgePunctuation(piece.trim()));
  if (pieces.length < 2) return null;
  if (pieces[0] === '') pieces.shift();
  if (pieces.length > 0 && pieces[pieces.length - 1] === '') pieces.pop();
  if (pieces.length === 0) return null;
  const ranges = [];
  let from = 0;
  for (const piece of pieces) {
    if (!piece) return null;
    const pieceAt = source.indexOf(piece, from);
    if (pieceAt === -1) return null;
    ranges.push(range(pieceAt, piece.length));
    from = pieceAt + piece.length;
  }
  return found(ranges);
}

/**
 * Returns true only if `citation.quote` appears word for word in the section
 * named by `citation.sectionId` (see locateQuote for the rules).
 *
 * @param {Record<string, string>} sections  section id -> section text
 * @param {{ sectionId: string, quote: string }} citation
 * @returns {boolean}
 */
export function verifyQuote(sections, citation) {
  return locateQuote(sections, citation) !== null;
}

/**
 * Keeps only flags whose every citation verifies. Returns both lists so the
 * caller can count (and test) what was dropped.
 *
 * @template {{ citations: Array<{ sectionId: string, quote: string }> }} F
 * @param {Record<string, string>} sections
 * @param {F[]} flags
 * @returns {{ kept: F[], dropped: F[] }}
 */
export function keepVerifiedFlags(sections, flags) {
  const kept = [];
  const dropped = [];
  for (const flag of flags) {
    const ok = flag.citations.length > 0 && flag.citations.every((c) => verifyQuote(sections, c));
    (ok ? kept : dropped).push(flag);
  }
  return { kept, dropped };
}
