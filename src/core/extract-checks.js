// The "extraction" design for the AI check (Nov 22).
//
// Baseline on the held-out set: asking Gemini Nano the open question "find
// contradictions" added about 1.7 real catches and 6.3 false alarms per run.
// Here Nano gets narrow questions instead ("what hours per week does this
// paragraph state about <activity>? quote it"), and plain code decides whether
// that conflicts with the activity. Nano never sees the activity's own numbers
// or title, so it can't be nudged into inventing a conflict with them.
//
//   1. itemFacts:      the activity's or honor's own facts, read by code
//   2. factsPrompt:    (in prompts.js) the narrow question for Nano
//   3. flagsFromFacts: code compares, and every essay quote must pass locateQuote
import { locateQuote } from './quotes.js';

const HOURS_LINE = /^(\d+(?:\.\d+)?) hr\/wk, (\d+(?:\.\d+)?) wk\/yr$/m;

// How far apart two hours-per-week figures must be to flag. Nano estimates
// ("every day after school" ≈ 10), so small gaps are noise.
export const HOURS_RATIO = 3;

// A quote can only back an hours estimate if it talks about time: an amount or
// a frequency next to a unit of time. Nano sometimes quotes a sentence that
// only names the activity ("work at the bakery") and guesses the hours, which
// gave a flag whose essay side said nothing about time. That flag is dropped.
const TIME_UNIT = /\b(hours?|hrs?|days?|daily|weeks?|weekly|weekends?|nights?|nightly|mornings?|afternoons?|evenings?|shifts?|summers?|months?|[ap]\.?m\.?)\b|\d{1,2}:\d{2}/i;
const TIME_AMOUNT = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|a few|several|half|every|each|most|all|daily|weekly|nightly|twice|once)\b/i;
export function statesTime(quote) {
  return TIME_UNIT.test(quote) && TIME_AMOUNT.test(quote);
}

/**
 * The facts code can read straight from an activity or honor.
 * Activity text (sections.js): category, "Org, Position", description, grades, "N hr/wk, M wk/yr", plans.
 * Honor text: title, level, grades.
 */
export function itemFacts(itemId, itemText) {
  const lines = itemText.split('\n');
  if (itemId.startsWith('honor-')) {
    return { name: lines[0], titleLine: lines[0], place: placeOf(lines[0]) };
  }
  const headingLine = lines[1] ?? '';
  const comma = headingLine.lastIndexOf(', ');
  const hours = itemText.match(HOURS_LINE);
  return {
    name: comma > 0 ? headingLine.slice(0, comma) : headingLine, // the organization only, never the title
    headingLine,
    position: comma > 0 ? headingLine.slice(comma + 2) : '',
    hoursLine: hours ? hours[0] : null,
    hoursPerWeek: hours ? Number(hours[1]) : null,
  };
}

// ---------- placings ----------

const ORDINAL_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

/** "2nd Place", "second place", "won first" → 2 / 2 / 1; "winner"/"champion" → 1; otherwise null. */
export function placeOf(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  const digits = t.match(/\b(\d+)(st|nd|rd|th)\b/);
  if (digits) return Number(digits[1]);
  for (const [word, n] of Object.entries(ORDINAL_WORDS)) {
    if (new RegExp(`\\b${word}\\s+(place|prize|overall)\\b|\\b(won|took|earned|placed)\\s+${word}\\b`).test(t)) return n;
  }
  if (/\b(winner|champion|grand prize)\b/.test(t)) return 1;
  return null;
}

// ---------- titles ----------

// Titles code can compare. A title outside this list is never compared: too easy to misread.
const TITLES = ['co-captain', 'captain', 'co-president', 'vice president', 'president', 'treasurer', 'secretary',
  'founder', 'co-founder', 'editor-in-chief', 'editor', 'section leader', 'team lead', 'manager', 'member', 'volunteer', 'tutor'];

/** The first known title in a phrase, longest first ("vice president" before "president"), or null. */
export function titleOf(text) {
  if (!text) return null;
  const t = text.toLowerCase().replace(/\bvice-president\b/g, 'vice president');
  return [...TITLES].sort((a, b) => b.length - a.length).find((title) => new RegExp(`(^|[^\\w-])${title}($|[^\\w-])`).test(t)) ?? null;
}

// Words that say a title changed over time ("became captain junior year"). Both can be true, so no flag.
const CHANGE_OVER_TIME = /\b(became|become|elected|promoted|later|until|before|after|now|then|eventually|first year|junior year|senior year|sophomore year|freshman year|grade)\b/i;

// ---------- comparing ----------

/** The quote plus about 80 characters on each side, where words like "became" would be. */
function around(passage, quote) {
  const at = passage.indexOf(quote);
  if (at < 0) return passage;
  return passage.slice(Math.max(0, at - 80), at + quote.length + 80);
}

function hoursFlag(pair, facts, answer, sections) {
  const essay = Number(answer.hoursPerWeek);
  if (!facts.hoursPerWeek || !(essay > 0) || !answer.hoursQuote) return { reason: 'no hours stated', quiet: true };
  const found = locateQuote(sections, { sectionId: pair.essayId, quote: answer.hoursQuote });
  if (!found) return { reason: 'hours quote not found in the application' };
  if (!statesTime(found.text)) return { reason: 'hours quote states no amount of time', quiet: true };
  const ratio = Math.max(essay, facts.hoursPerWeek) / Math.min(essay, facts.hoursPerWeek);
  if (ratio < HOURS_RATIO) return { reason: `hours close enough (${facts.hoursPerWeek} vs about ${essay})` };
  return {
    flag: {
      kind: 'hours', title: 'Time commitment differs', essay: found,
      itemQuote: facts.hoursLine,
      detail: `The activity says ${facts.hoursPerWeek} hours a week. Gemini Nano, on this computer, read the essay as about ${essay}. Check which is right.`,
    },
  };
}

function roleFlag(pair, facts, answer, sections) {
  const listed = titleOf(facts.position);
  const said = titleOf(answer.role) ?? titleOf(answer.roleQuote);
  if (!listed || !said || !answer.roleQuote) return { reason: 'no comparable title', quiet: true };
  if (listed === said || listed.includes(said) || said.includes(listed)) return { reason: 'same title', quiet: true };
  const found = locateQuote(sections, { sectionId: pair.essayId, quote: answer.roleQuote });
  if (!found) return { reason: 'role quote not found in the application' };
  if (titleOf(found.text) !== said) return { reason: 'the quote does not name that title' };
  if (CHANGE_OVER_TIME.test(around(pair.passage, found.text))) {
    return { reason: 'title may have changed over time' };
  }
  return {
    flag: {
      kind: 'role', title: 'Role or title differs', essay: found,
      itemQuote: facts.headingLine,
      detail: 'The activity lists one title and the essay names another. Check which is right.',
    },
  };
}

function awardFlag(pair, facts, answer, sections) {
  if (!facts.place || !answer.placeQuote) return { reason: 'no comparable placing', quiet: true };
  const found = locateQuote(sections, { sectionId: pair.essayId, quote: answer.placeQuote });
  if (!found) return { reason: 'placing quote not found in the application' };
  const said = placeOf(found.text); // read from the student's own words, not from Nano's summary
  if (!said) return { reason: 'the quote does not state a placing' };
  if (said === facts.place) return { reason: 'same placing', quiet: true };
  return {
    flag: {
      kind: 'award', title: 'Award or placing differs', essay: found,
      itemQuote: facts.titleLine,
      detail: 'The honor and the essay give different placings. Check which is right.',
    },
  };
}

/**
 * @param {{ itemId: string, essayId: string, itemText: string, passage: string }} pair  from planComparisons
 * @param {object} answer  Gemini Nano's JSON for FACTS_SCHEMA
 * @param {Record<string,string>} sections
 * @returns {{ kept: object[], dropped: Array<{ reason: string, contradiction: object }> }}  same shape as aiFlagsFromAnswer
 */
export function flagsFromFacts(pair, answer, sections) {
  const kept = [];
  const dropped = [];
  if (!answer || answer.aboutThisActivity === false) return { kept, dropped: [{ reason: 'paragraph is not about this item', contradiction: answer }] };
  const facts = itemFacts(pair.itemId, pair.itemText);
  const checks = pair.itemId.startsWith('honor-') ? [awardFlag] : [hoursFlag, roleFlag];
  for (const check of checks) {
    const out = check(pair, facts, answer, sections);
    if (!out.flag) { if (!out.quiet) dropped.push({ reason: out.reason, contradiction: answer }); continue; }
    const itemFound = locateQuote(sections, { sectionId: pair.itemId, quote: out.flag.itemQuote }, { minWords: 1 }); // code chose this line, not the AI
    if (!itemFound) { dropped.push({ reason: 'item line not found', contradiction: answer }); continue; }
    kept.push({
      id: `ai:${out.flag.kind}:${pair.itemId}:${pair.essayId}:${itemFound.ranges[0].start}:${out.flag.essay.ranges[0].start}`,
      check: 'on-device',
      kind: out.flag.kind,
      title: out.flag.title,
      detail: out.flag.detail,
      citations: [
        { sectionId: pair.itemId, quote: itemFound.text },
        { sectionId: pair.essayId, quote: out.flag.essay.text },
      ],
    });
  }
  return { kept, dropped };
}
