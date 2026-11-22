// The "claim" design for the AI check (Idea 1, Nov 22).
//
// Code turns the activity list into plain claims ("The student spends about 6
// hours per week on Lakeview Swim Club."). For each related essay paragraph,
// Gemini Nano answers a multiple-choice question per claim: agree, disagree or
// not stated, with the exact words that decide it. This is natural language
// inference, a classic task for small models: one claim, one paragraph, three
// choices. Code keeps a "disagree" only if the quote is really in the essay and
// mentions that kind of fact.
import { locateQuote } from './quotes.js';
import { passesKindGuard } from './ai-checks.js';
import { itemFacts, placeOf, titleOf } from './extract-checks.js';

const CHANGE_OVER_TIME = /\b(became|become|elected|promoted|later|until|before|after|now|then|eventually|junior year|senior year|sophomore year|freshman year|grade)\b/i;

/**
 * The claims code can make from one activity or honor. Each names the item line it comes from.
 * @returns {{ hours: string, role: string, place: string, lines: { hours?: string, role?: string, place?: string } }}
 */
export function claimsFor(itemId, itemText) {
  const facts = itemFacts(itemId, itemText);
  if (itemId.startsWith('honor-')) {
    return { hours: '', role: '', place: `The student received this honor: ${facts.titleLine}.`, lines: { place: facts.titleLine }, name: facts.name };
  }
  return {
    name: facts.name,
    hours: facts.hoursPerWeek ? `The student spends about ${facts.hoursPerWeek} hours per week on ${facts.name}.` : '',
    role: facts.position ? `The student's title in ${facts.name} is ${facts.position}.` : '',
    place: '',
    lines: { hours: facts.hoursLine ?? undefined, role: facts.headingLine },
  };
}

const TITLES = { hours: 'Time commitment differs', role: 'Role or title differs', place: 'Award or placing differs' };

function around(passage, quote) {
  const at = passage.indexOf(quote);
  return at < 0 ? passage : passage.slice(Math.max(0, at - 80), at + quote.length + 80);
}

/** Extra code checks per kind, on the student's own words, after the quote is found. */
function stillDisagrees(kind, claims, found, pair) {
  if (kind === 'hours') return passesKindGuard('hours', claims.lines.hours, found.text);
  if (kind === 'role') {
    const listed = titleOf(claims.lines.role.slice(claims.lines.role.lastIndexOf(', ') + 2));
    const said = titleOf(found.text);
    return Boolean(said) && said !== listed && !CHANGE_OVER_TIME.test(around(pair.passage, found.text));
  }
  const listed = placeOf(claims.lines.place);
  const said = placeOf(found.text);
  return Boolean(said) && (listed === null || said !== listed);
}

/**
 * @param {{ itemId, essayId, itemText, passage }} pair  from planComparisons
 * @param {object} answer  Gemini Nano's JSON for CLAIM_SCHEMA
 * @returns {{ kept: object[], dropped: Array<{ reason: string, contradiction: object }> }}
 */
export function flagsFromClaims(pair, answer, sections) {
  const kept = [];
  const dropped = [];
  const claims = claimsFor(pair.itemId, pair.itemText);
  for (const kind of ['hours', 'role', 'place']) {
    if (!claims[kind] || answer?.[`${kind}Verdict`] !== 'disagree') continue;
    const quote = answer[`${kind}Quote`];
    const found = locateQuote(sections, { sectionId: pair.essayId, quote });
    if (!found) { dropped.push({ reason: `${kind} quote not found in the application`, contradiction: answer }); continue; }
    if (!stillDisagrees(kind, claims, found, pair)) { dropped.push({ reason: `the quote doesn't state a different ${kind}`, contradiction: answer }); continue; }
    const itemFound = locateQuote(sections, { sectionId: pair.itemId, quote: claims.lines[kind] }, { minWords: 1 }); // code chose this line
    if (!itemFound) { dropped.push({ reason: 'item line not found', contradiction: answer }); continue; }
    kept.push({
      id: `ai:${kind}:${pair.itemId}:${pair.essayId}:${itemFound.ranges[0].start}:${found.ranges[0].start}`,
      check: 'on-device',
      kind: kind === 'place' ? 'award' : kind,
      title: TITLES[kind],
      detail: 'Gemini Nano, on this computer, read the essay as disagreeing with your activity list here. Check which is right.',
      citations: [
        { sectionId: pair.itemId, quote: itemFound.text },
        { sectionId: pair.essayId, quote: found.text },
      ],
    });
  }
  return { kept, dropped };
}
