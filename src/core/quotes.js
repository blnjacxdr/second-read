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

function wordCount(text) {
  return text.split(' ').filter(Boolean).length;
}

/**
 * Returns true only if `citation.quote` appears word for word in the section
 * named by `citation.sectionId`.
 *
 * @param {Record<string, string>} sections  section id -> section text
 * @param {{ sectionId: string, quote: string }} citation
 * @returns {boolean}
 */
export function verifyQuote(sections, citation) {
  if (!citation || typeof citation.quote !== 'string') return false;
  const raw = sections[citation.sectionId];
  if (typeof raw !== 'string') return false;

  const source = normalizeForMatch(raw);
  const quote = normalizeForMatch(citation.quote);
  if (quote.length === 0) return false;

  const isWholeField = quote === source;
  if (!isWholeField && wordCount(quote.replaceAll('…', ' ')) < MIN_WORDS) return false;

  if (source.includes(quote)) return true;

  // Ellipsis form: every piece must appear, in order, without overlapping.
  // Spacing around the ellipsis is forgiven ("a … b", "a…b", "a ... b").
  // A leading or trailing ellipsis ("… the lab until 7") only marks a cut, so
  // it is ignored; an empty piece in the middle ("a … … b") is rejected.
  const pieces = quote.split('…').map((piece) => piece.trim());
  if (pieces.length < 2) return false;
  if (pieces[0] === '') pieces.shift();
  if (pieces.length > 0 && pieces[pieces.length - 1] === '') pieces.pop();
  if (pieces.length === 0) return false;
  let from = 0;
  for (const piece of pieces) {
    if (!piece) return false;
    const at = source.indexOf(piece, from);
    if (at === -1) return false;
    from = at + piece.length;
  }
  return true;
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
