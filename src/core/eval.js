// Scoring against a held-out answer key. Pure functions, used by the Node
// scorer (eval/score.mjs, code checks) and the browser eval page (dev/eval.html,
// code checks + Gemini Nano). They return numbers only, never application text,
// so whoever reads the scores never sees the held-out applications.
//
// A flag CATCHES a planted mistake when it points at the same sections and, in
// every one of them, its quote overlaps the mistake's quote. Every flag that
// catches nothing is a FALSE ALARM. Flags that land on a "tricky consistent"
// case (looks like a mistake but isn't) are counted separately.

import { locateQuote } from './quotes.js';

/** The answer key names the college's essay "supplement-main"; in a PDF it is the first college essay. */
export function toPdfSectionId(sectionId) {
  return sectionId === 'supplement-main' ? 'college-essay-1' : sectionId;
}

/** For an activity, the answer key may quote the hours line; our activity text uses the same "N hr/wk, M wk/yr". */
// Answer-key quotes may be short (a two-word title like "Vice President"): we wrote them, so the
// 3-word rule that protects students from vague AI quotes doesn't apply to them.
const KEY = { minWords: 1 };
function rangesFor(sections, sectionId, quote) {
  const found = locateQuote(sections, { sectionId, quote }, KEY);
  return found ? found.ranges : [];
}

function overlaps(a, b) {
  return a.some((x) => b.some((y) => x.start < y.end && y.start < x.end));
}

/**
 * True if the flag points at the same places as the planted case (same set of
 * sections) and overlaps its quote in every one of them. (Overlap in just one
 * place counted a flag about the right essay sentence but the wrong activity
 * line as a catch.)
 */
export function flagMatches(flag, places, sections) {
  const flagSections = new Set(flag.citations.map((c) => c.sectionId));
  const placeSections = new Set(places.map((p) => toPdfSectionId(p.sectionId)));
  if (flagSections.size !== placeSections.size || [...flagSections].some((s) => !placeSections.has(s))) return false;
  return places.every((place) => {
    const sectionId = toPdfSectionId(place.sectionId);
    const keyRanges = rangesFor(sections, sectionId, place.quote);
    const flagRanges = flag.citations.filter((c) => c.sectionId === sectionId).flatMap((c) => rangesFor(sections, sectionId, c.quote));
    return overlaps(keyRanges, flagRanges);
  });
}

/**
 * Scores one application's flags.
 * @returns {{ planted: number, caught: number, falseAlarms: number, trickyTriggered: number,
 *             byKind: Record<string, { planted: number, caught: number }>, keyQuotesMissing: number }}
 */
export function scoreApplication(flags, entry, sections) {
  const caughtIds = new Set();
  const usedFlags = new Set();
  const byKind = {};
  let keyQuotesMissing = 0;

  for (const mistake of entry.mistakes) {
    byKind[mistake.kind] ??= { planted: 0, caught: 0 };
    byKind[mistake.kind].planted += 1;
    for (const place of mistake.places) {
      if (!locateQuote(sections, { sectionId: toPdfSectionId(place.sectionId), quote: place.quote }, KEY)) keyQuotesMissing += 1;
    }
    const matching = flags.filter((f) => flagMatches(f, mistake.places, sections));
    if (matching.length > 0) {
      caughtIds.add(mistake.id);
      byKind[mistake.kind].caught += 1;
      for (const f of matching) usedFlags.add(f.id);
    }
  }

  let trickyTriggered = 0;
  const trickyFlags = new Set();
  for (const tricky of entry.trickyConsistent ?? []) {
    const matching = flags.filter((f) => flagMatches(f, tricky.places, sections));
    if (matching.length > 0) trickyTriggered += 1;
    for (const f of matching) trickyFlags.add(f.id);
  }

  // A flag on a tricky case is counted once, under trickyTriggered, not again as a false alarm.
  const falseAlarms = flags.filter((f) => !usedFlags.has(f.id) && !trickyFlags.has(f.id)).length;
  return {
    planted: entry.mistakes.length,
    caught: caughtIds.size,
    falseAlarms,
    trickyTriggered,
    trickyFlags: trickyFlags.size,
    byKind,
    keyQuotesMissing,
  };
}

/** Adds up per-application scores. */
export function totalScores(scores) {
  const total = { planted: 0, caught: 0, falseAlarms: 0, trickyTriggered: 0, keyQuotesMissing: 0, byKind: {} };
  for (const s of scores) {
    for (const key of ['planted', 'caught', 'falseAlarms', 'trickyTriggered', 'keyQuotesMissing']) total[key] += s[key];
    for (const [kind, k] of Object.entries(s.byKind)) {
      total.byKind[kind] ??= { planted: 0, caught: 0 };
      total.byKind[kind].planted += k.planted;
      total.byKind[kind].caught += k.caught;
    }
  }
  return total;
}
