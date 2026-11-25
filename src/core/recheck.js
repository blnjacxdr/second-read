// Re-checking after fixes. When a student fixes things in Common App and checks the new PDF, compare the new
// flags with the last check in this tab: which ones are gone (fixed for real), which are still there, which are new.
// Nothing is stored beyond the tab. Pure functions.
//
// Matching, most certain first:
//   same kind of problem + the same quoted words   -> still there, unchanged
//   same kind of problem + the same places          -> still there, but the wording changed
//   anything else in the new check                  -> new
//   anything from the last check with no match      -> fixed

const words = (text) => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const exactKey = (card) => `${card.kind}|${card.quotes.map((q) => words(q.text)).sort().join('|')}`;
const placeKey = (card) => `${card.kind}|${card.quotes.map((q) => q.where).sort().join('|')}`;

/**
 * Is this PDF the same student as the last one? A counselor checks many different students in one tab, and comparing
 * student B with student A would call A's problems "fixed" and could carry an "It's fine" over to a different
 * student. Activity headings ("Organization, Position") barely change between one student's drafts and college PDFs,
 * and almost never match between two students. Falls back to the personal essay's opening when there are too few
 * activities to tell. When unsure, says no: a missed comparison costs nothing, a wrong one hides a problem.
 * @param {{ activities: Array<{ heading: string }>, personalEssay?: { text: string }|null }} a  readCommonApp output
 * @param {{ activities: Array<{ heading: string }>, personalEssay?: { text: string }|null }} b
 */
export function sameApplicant(a, b) {
  if (!a || !b) return false;
  const headings = (r) => new Set((r.activities ?? []).map((x) => words(x.heading ?? '')).filter(Boolean));
  const ha = headings(a);
  const hb = headings(b);
  if (ha.size >= 2 && hb.size >= 2) {
    const shared = [...ha].filter((h) => hb.has(h)).length;
    return shared / Math.min(ha.size, hb.size) >= 0.5;
  }
  const opening = (r) => words(r.personalEssay?.text ?? '').split(' ').slice(0, 25).join(' ');
  return opening(a).split(' ').length >= 10 && opening(a) === opening(b);
}

/**
 * @param {object[]} previous  cards from the last check (presentFlags output, sure and maybes)
 * @param {object[]} current   cards from this check
 * @returns {{ fixed: object[], still: Array<{ card: object, was: object, changed: boolean }>, fresh: object[] }}
 */
export function compareChecks(previous, current) {
  const unmatched = new Set(previous);
  const still = [];
  const fresh = [];
  const take = (keyOf, card) => {
    const was = [...unmatched].find((p) => keyOf(p) === keyOf(card));
    if (was) unmatched.delete(was);
    return was;
  };
  const pending = [];
  for (const card of current) {
    const was = take(exactKey, card);
    if (was) still.push({ card, was, changed: false }); else pending.push(card);
  }
  for (const card of pending) {
    const was = take(placeKey, card);
    if (was) still.push({ card, was, changed: true }); else fresh.push(card);
  }
  return { fixed: [...unmatched], still, fresh };
}

/** "On purpose" choices carry over to the same problem in the new check; "Fixed it" does not (the check decides). */
export function carriedDecisions(comparison, previousDecisions) {
  const carried = new Map();
  for (const { card, was } of comparison.still) {
    if (previousDecisions.get(was.id) === 'kept') carried.set(card.id, 'kept');
  }
  return carried;
}

/** The line at the top of a re-check. */
export function recheckSummary(comparison) {
  const { fixed, still, fresh } = comparison;
  const parts = [`${fixed.length} fixed`, `${still.length} still there`, `${fresh.length} new`];
  return {
    line: `Since the last check: ${parts.join(', ')}.`,
    allFixed: still.length === 0 && fresh.length === 0 && fixed.length > 0,
  };
}
