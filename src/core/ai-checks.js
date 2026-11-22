// The on-device AI checks, as pure functions (no Firebase, no browser):
//   1. planComparisons: which activity or honor to compare with which essay paragraph.
//   2. aiFlagsFromAnswer: turns Gemini Nano's JSON into flags, dropping any whose
//      quotes don't verify or that fail the guard for their kind.
//   3. Other-college mentions: a yes/no question per sentence, used only to order
//      the code check's flags, never to hide one.
// src/ai.js sends the prompts; these decide what to send and what to keep.

import { activityKeywords, wordsOf } from './checks.js';
import { locateQuote } from './quotes.js';

/** At most this many comparisons per check, so a long application doesn't take minutes. */
export const MAX_COMPARISONS = 24;

// ---------- 1. what to compare ----------

/** Paragraphs of an essay with their text. */
function paragraphsOf(text) {
  return text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
}

/**
 * One shared common word ("science") linked a museum activity to an unrelated
 * paragraph in the first real run (Nov 21). A link needs two shared words, or
 * one that the paragraph writes as a name (capitalized mid-sentence).
 */
export function isStrongLink(shared, passage) {
  if (shared.length >= 2) return true;
  return shared.some((word) => new RegExp(`(?<![.!?]\\s)(?<!^)\\b${word[0].toUpperCase()}${word.slice(1)}\\b`).test(passage));
}

/** Distinctive words of an honor's title (its first line). */
function honorKeywords(honorText) {
  return activityKeywords(`honor\n${honorText.split('\n')[0]}`);
}

/**
 * Pairs each activity or honor with the essay paragraphs that share a
 * distinctive word with it (the organization, the sport, the award). Pairs
 * with the most shared words come first.
 *
 * @param {{ sections: Record<string,string>, activityIds: string[], honorIds?: string[], essayIds: string[] }} app
 * @returns {Array<{ itemId: string, essayId: string, itemText: string, passage: string, shared: string[] }>}
 */
export function planComparisons(app) {
  const items = [
    ...app.activityIds.map((id) => ({ id, keywords: activityKeywords(app.sections[id]) })),
    ...(app.honorIds ?? []).map((id) => ({ id, keywords: honorKeywords(app.sections[id]) })),
  ];
  const pairs = [];
  for (const item of items) {
    for (const essayId of app.essayIds) {
      for (const passage of paragraphsOf(app.sections[essayId])) {
        const words = new Set(wordsOf(passage).map((w) => w.word));
        const shared = [...item.keywords].filter((k) => words.has(k));
        if (isStrongLink(shared, passage)) pairs.push({ itemId: item.id, essayId, itemText: app.sections[item.id], passage, shared });
      }
    }
  }
  return pairs.sort((a, b) => b.shared.length - a.shared.length).slice(0, MAX_COMPARISONS);
}

// ---------- 2. from Gemini Nano's answer to flags ----------

// A flag of each kind must mention that kind of fact on BOTH sides. Real case
// (Nov 20): a "dates" flag paired "Grades: 10, 11, 12" with "That night I did
// what I always do." Both quotes were real, but only one had a date.
// Hours: a bare number is not enough on the essay side; a year ("in 2023")
// passed that way in the first real run. It must say how often or how long.
const HOURS_ESSAY = /\b(every|each|daily|weekly|nightly|weekends?|hours?|hrs?|days?|nights?|weeks?|months?|times|always|mornings?|afternoons?|evenings?|after school)\b/i;
const KIND_GUARDS = {
  hours: { item: /\d+ hr\/wk|\bhours?\b/i, essay: HOURS_ESSAY },
  role: /\b(co-?captain|captain|president|vice|founder|co-?founder|lead|leader|head|chair|editor|director|manager|officer|member|programmer|tutor|coach|treasurer|secretary|organizer|instructor|starter|volunteer)\b/i,
  dates: /\b(19|20)\d\d\b|'\d\d\b|\b(grade|freshman|sophomore|junior|senior|summer|spring|fall|winter|january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(9|10|11|12)(th)?\b/i,
  award: /\b(1st|2nd|3rd|\d+th|first|second|third|place|won|winner|finalist|semifinal\w*|champion\w*|award\w*|medal\w*|prize|honorable|ranked)\b/i,
};

const KIND_TITLES = {
  hours: 'Time commitment differs',
  role: 'Role or title differs',
  dates: 'Dates differ',
  award: 'Award or placing differs',
};

/** True if both quotes mention the kind of fact the flag is about. "other" never passes: too vague to trust. */
export function passesKindGuard(kind, itemQuote, essayQuote) {
  const guard = KIND_GUARDS[kind];
  if (!guard) return false;
  const itemGuard = guard.item ?? guard;
  const essayGuard = guard.essay ?? guard;
  return itemGuard.test(itemQuote) && essayGuard.test(essayQuote);
}

/**
 * @param {{ itemId: string, essayId: string }} comparison
 * @param {{ contradictions: Array<{ kind: string, activityQuote: string, essayQuote: string }> }} answer  Gemini Nano's JSON
 * @param {Record<string,string>} sections
 * @returns {{ kept: object[], dropped: Array<{ reason: string, contradiction: object }> }}
 */
export function aiFlagsFromAnswer(comparison, answer, sections) {
  const kept = [];
  const dropped = [];
  for (const c of answer?.contradictions ?? []) {
    const itemFound = locateQuote(sections, { sectionId: comparison.itemId, quote: c.activityQuote });
    const essayFound = locateQuote(sections, { sectionId: comparison.essayId, quote: c.essayQuote });
    if (!itemFound || !essayFound) {
      dropped.push({ reason: 'quote not found in the application', contradiction: c });
    } else if (!passesKindGuard(c.kind, itemFound.text, essayFound.text)) {
      dropped.push({ reason: `quotes don't both mention ${c.kind === 'other' ? 'a specific fact' : c.kind}`, contradiction: c });
    } else {
      kept.push({
        id: `ai:${c.kind}:${comparison.itemId}:${comparison.essayId}:${itemFound.ranges[0].start}:${essayFound.ranges[0].start}`,
        check: 'on-device',
        kind: c.kind,
        title: KIND_TITLES[c.kind],
        detail: 'Gemini Nano, running on this computer, read these as saying different things. Check which is right.',
        // The student's own words, exactly as in the application, not the model's copy.
        citations: [
          { sectionId: comparison.itemId, quote: itemFound.text },
          { sectionId: comparison.essayId, quote: essayFound.text },
        ],
      });
    }
  }
  return { kept, dropped };
}

/** Removes repeats: the same two places flagged from more than one paragraph pairing. */
export function dedupeFlags(flags) {
  const seen = new Set();
  return flags.filter((f) => !seen.has(f.id) && seen.add(f.id));
}

// ---------- 2b. a second opinion on every AI flag ----------

/** JSON Schema for the second-opinion question. */
export const SECOND_OPINION_SCHEMA = {
  type: 'object',
  properties: { contradicts: { type: 'boolean' } },
  required: ['contradicts'],
};

const KIND_WORDS = { hours: 'how much time was spent', role: 'a role or title', dates: 'a date or year', award: 'an award or placing' };

/**
 * A narrower yes/no question about one flag: do these two statements really
 * contradict each other? Asking a model to judge one specific claim catches
 * many of its own false alarms (Nov 21: "40 hr/wk, 6 wk/yr" vs "every hour for
 * six weeks" was flagged, though both say six weeks).
 */
export function secondOpinionPrompt(flag) {
  const [item, essay] = flag.citations;
  return [
    'Two statements come from the same student\'s college application.',
    `Do they contradict each other about ${KIND_WORDS[flag.kind] ?? 'a fact'}, so that both cannot be true at the same time?`,
    'Answer contradicts: false if they agree, describe different things or different times, or one only adds detail.',
    '',
    `STATEMENT A: ${item.quote}`,
    `STATEMENT B: ${essay.quote}`,
  ].join('\n');
}

/**
 * Keeps AI flags the second opinion confirmed. A flag whose second opinion
 * failed (no answer) is kept: the student can judge it, and hiding a real
 * problem is worse than showing a doubtful one.
 * @param {object[]} flags
 * @param {Map<string, boolean>} verdicts  flag id -> contradicts
 */
export function applySecondOpinion(flags, verdicts) {
  const kept = flags.filter((f) => verdicts.get(f.id) !== false);
  return { kept, removed: flags.length - kept.length };
}

// ---------- 3. other-college mentions ----------

/** JSON Schema for the mention question. */
export const MENTION_SCHEMA = {
  type: 'object',
  properties: { aboutAttending: { type: 'boolean' } },
  required: ['aboutAttending'],
};

/** The question for one sentence: is the writer talking about going to that college themselves? */
export function mentionPrompt(collegeName, sentence) {
  return [
    `A student wrote this sentence in a college application essay. It mentions ${collegeName}.`,
    `Answer aboutAttending: true if the student is saying they want to attend, join, study at, or are applying to ${collegeName}.`,
    `Answer false if ${collegeName} is only mentioned as background (for example, where someone else studied, or a program they visited).`,
    '',
    'SENTENCE:',
    sentence,
  ].join('\n');
}

/**
 * Orders other-college flags using Gemini Nano's answers. Never removes one:
 * "about attending" goes first as a likely copy-paste slip; "background" goes
 * last and is marked so the page can group it. Flags without an answer stay as
 * they are.
 *
 * @param {object[]} flags  all flags
 * @param {Map<string, boolean>} answers  flag id -> aboutAttending
 */
export function orderWithMentionAnswers(flags, answers) {
  const marked = flags.map((flag) => {
    if (flag.kind !== 'other-college-name' || !answers.has(flag.id)) return flag;
    return answers.get(flag.id)
      ? { ...flag, mention: 'likely-slip', detail: 'This sentence sounds like you\'re applying there. It may be left over from another college\'s essay.' }
      : { ...flag, mention: 'background', detail: 'This reads as background, not about attending. Likely intended; worth a glance.' };
  });
  const rank = (f) => (f.mention === 'likely-slip' ? 0 : f.mention === 'background' ? 2 : 1);
  return marked.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map(({ f }) => f);
}
