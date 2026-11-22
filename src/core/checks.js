// Code-only checks: no AI, so they run everywhere, including phones.
//
// Every flag is a "check this", not a verdict: a supplement may mention
// another college on purpose. Every flag quotes the exact text from each
// place it points at, and those quotes go through verifyQuote like AI flags.
//
// Flag shape:
//   { id, check: 'code', kind, title, detail, citations: [{ sectionId, quote }] }

import { COLLEGES, namesFor } from './colleges.js';
import { LIMITS, countWords } from './sections.js';

const YEAR = /\b(19[5-9]\d|20[0-4]\d)\b/g;
const START_WORDS = /\b(founded|co-founded|started|began|launched|created|established|joined)\b/i;
const MAX_QUOTE_WORDS = 30;
const MIN_REPEAT_WORDS = 12; // shorter shared phrases ("one of the most important things") are normal
const SHINGLE = 8;
const PERSONAL_ESSAY_WORD_LIMIT = 650;

// Words too common to link an essay sentence to an activity.
const STOPWORDS = new Set(('the and for with from that this into our your their about after before during ' +
  'school high club team program member members lead leader president founder co-founder captain volunteer ' +
  'student students officer coach assistant group community national state regional chapter ' +
  // Everyday words that appear in names ("FIRST Robotics") but link unrelated paragraphs.
  'first second third last next best year years time times every work days week weeks people things ' +
  'more most many much like just really great good world life home help part new old').split(' '));

// ---------- text helpers ----------

/** Words with their positions in the original text. */
export function wordsOf(text) {
  const words = [];
  for (const match of text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)) {
    words.push({ word: match[0].toLowerCase().replace(/’/g, "'"), start: match.index, end: match.index + match[0].length });
  }
  return words;
}

/** Sentences with their positions; a line break also ends a sentence (activity text is line by line). */
export function sentencesOf(text) {
  const sentences = [];
  const pattern = /[^.!?\n]+(?:[.!?]+["”’)]*|(?=\n)|$)/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) sentences.push({ text: trimmed, start: match.index + lead, end: match.index + lead + trimmed.length });
  }
  return sentences;
}

/** A quote of at most MAX_QUOTE_WORDS words from `text`, centered on [focusStart, focusEnd). */
export function quoteAround(text, sentence, focusStart, focusEnd) {
  const words = wordsOf(sentence.text).map((w) => ({ ...w, start: w.start + sentence.start, end: w.end + sentence.start }));
  if (words.length <= MAX_QUOTE_WORDS) return sentence.text;
  const focus = Math.max(0, words.findIndex((w) => w.end > focusStart));
  const from = Math.max(0, Math.min(focus - Math.floor(MAX_QUOTE_WORDS / 2), words.length - MAX_QUOTE_WORDS));
  const to = from + MAX_QUOTE_WORDS - 1;
  return text.slice(words[from].start, Math.max(words[to].end, Math.min(focusEnd, words.at(-1).end)));
}

// ---------- 1. another college's name in this college's essays ----------

/** Finds college names in text, longest names first, without overlaps. */
export function findCollegeMentions(text, colleges = COLLEGES) {
  const candidates = [];
  for (const college of colleges) {
    for (const name of namesFor(college)) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu');
      for (const match of text.matchAll(pattern)) {
        candidates.push({ college, name, start: match.index, end: match.index + name.length });
      }
    }
  }
  candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const accepted = [];
  for (const candidate of candidates) {
    if (!accepted.some((a) => candidate.start < a.end && a.start < candidate.end)) accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/** The list entry for the college this PDF is for, if it's in the list. */
function ownCollege(collegeName, colleges) {
  if (!collegeName) return null;
  return colleges.find((c) => c.name === collegeName) ??
    findCollegeMentions(collegeName, colleges).find((m) => m.start === 0 && m.end === collegeName.length)?.college ?? null;
}

export function checkOtherCollegeNames(app, colleges = COLLEGES) {
  const flags = [];
  const own = ownCollege(app.college, colleges);
  for (const sectionId of app.collegeEssayIds) {
    const text = app.sections[sectionId];
    const seen = new Set();
    for (const mention of findCollegeMentions(text, colleges)) {
      if (mention.college === own || seen.has(mention.college.name)) continue;
      seen.add(mention.college.name);
      const sentence = sentencesOf(text).find((s) => s.start <= mention.start && mention.end <= s.end);
      flags.push({
        id: `other-college:${sectionId}:${mention.college.name}`,
        check: 'code',
        kind: 'other-college-name',
        mentionName: mention.name, // the name as written, for the on-device question
        title: `Mentions ${mention.name} in your ${app.college ?? 'college'} essay`,
        detail: 'Make sure this is intended. A name left over from another college\'s essay is a common copy-paste slip.',
        citations: [{ sectionId, quote: quoteAround(text, sentence, mention.start, mention.end) }],
      });
    }
  }
  return flags;
}

// ---------- 2. start years that don't match ----------

/** Distinctive words from an activity's organization and role, used to find essay sentences about it. */
export function activityKeywords(activityText) {
  const [category, heading = ''] = activityText.split('\n');
  return new Set(wordsOf(heading).map((w) => w.word).filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w)));
}

function startYears(sentence) {
  if (!START_WORDS.test(sentence.text)) return [];
  return [...sentence.text.matchAll(YEAR)].map((m) => m[0]);
}

export function checkStartYears(app) {
  const flags = [];
  for (const activityId of app.activityIds) {
    const activityText = app.sections[activityId];
    const activityStart = sentencesOf(activityText).map((s) => ({ s, years: startYears(s) })).find((x) => x.years.length);
    if (!activityStart) continue;
    const keywords = activityKeywords(activityText);
    for (const essayId of app.essayIds) {
      const essay = app.sections[essayId];
      for (const sentence of sentencesOf(essay)) {
        const years = startYears(sentence);
        if (years.length === 0 || years.some((y) => activityStart.years.includes(y))) continue;
        if (!wordsOf(sentence.text).some((w) => keywords.has(w.word))) continue;
        const year = years[0];
        const at = sentence.start + sentence.text.indexOf(year);
        flags.push({
          id: `start-year:${activityId}:${essayId}:${sentence.start}`,
          check: 'code',
          kind: 'dates',
          title: `Start year ${activityStart.years[0]} in an activity, ${year} in an essay`,
          detail: 'These seem to describe the same start. Check which year is right.',
          citations: [
            { sectionId: activityId, quote: activityStart.s.text },
            { sectionId: essayId, quote: quoteAround(essay, sentence, at, at + 4) },
          ],
        });
      }
    }
  }
  return flags;
}

// ---------- 2b. a qualified title written without its qualifier ----------

const QUALIFIED_TITLE = /\b(co-|co |vice-|vice |assistant |deputy )(captain|founder|president|chair|director|editor|lead|leader|manager|coach)\b/i;

/**
 * An activity says "Co-Captain" (or Vice President, Assistant Coach...) and an
 * essay sentence about the same activity uses the bare title ("captain").
 * Code, not AI: Gemini Nano missed this in the first real run (Nov 21).
 */
export function checkQualifiedTitles(app) {
  const flags = [];
  for (const activityId of app.activityIds) {
    const activityText = app.sections[activityId];
    const headingLine = activityText.split('\n')[1] ?? '';
    const qualified = headingLine.match(QUALIFIED_TITLE);
    if (!qualified) continue;
    const [fullTitle, , base] = qualified;
    const bare = new RegExp(`(?<!co-|co |vice-|vice |assistant |deputy )\\b${base}\\b`, 'i');
    const keywords = activityKeywords(activityText);
    for (const essayId of app.essayIds) {
      const essay = app.sections[essayId];
      for (const sentence of sentencesOf(essay)) {
        if (QUALIFIED_TITLE.test(sentence.text)) continue; // the sentence uses a qualified title itself
        const match = sentence.text.match(bare);
        if (!match || !wordsOf(sentence.text).some((w) => keywords.has(w.word))) continue;
        const at = sentence.start + match.index;
        flags.push({
          id: `title:${activityId}:${essayId}:${sentence.start}`,
          check: 'code',
          kind: 'role',
          title: `"${fullTitle}" in an activity, "${match[0]}" in an essay`,
          detail: 'These seem to describe the same role. Check which title is right.',
          citations: [
            { sectionId: activityId, quote: headingLine },
            { sectionId: essayId, quote: quoteAround(essay, sentence, at, at + match[0].length) },
          ],
        });
      }
    }
  }
  return flags;
}

// ---------- 3. the same passage in two places ----------

/** Runs of at least MIN_REPEAT_WORDS identical words shared by two texts. */
export function sharedPassages(textA, textB, minWords = MIN_REPEAT_WORDS) {
  const a = wordsOf(textA);
  const b = wordsOf(textB);
  const key = (words, i) => words.slice(i, i + SHINGLE).map((w) => w.word).join(' ');
  const index = new Map();
  for (let j = 0; j + SHINGLE <= b.length; j++) {
    const k = key(b, j);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(j);
  }
  const runs = [];
  for (let i = 0; i + SHINGLE <= a.length;) {
    let best = null;
    for (const j of index.get(key(a, i)) ?? []) {
      let length = SHINGLE;
      while (i + length < a.length && j + length < b.length && a[i + length].word === b[j + length].word) length++;
      if (!best || length > best.length) best = { i, j, length };
    }
    if (best && best.length >= minWords) {
      runs.push({
        words: best.length,
        quoteA: textA.slice(a[best.i].start, a[best.i + best.length - 1].end),
        quoteB: textB.slice(b[best.j].start, b[best.j + best.length - 1].end),
      });
      i += best.length;
    } else {
      i += 1;
    }
  }
  return runs;
}

export function checkRepeatedPassages(app) {
  const flags = [];
  const ids = app.essayIds;
  for (let x = 0; x < ids.length; x++) {
    for (let y = x + 1; y < ids.length; y++) {
      for (const run of sharedPassages(app.sections[ids[x]], app.sections[ids[y]])) {
        flags.push({
          id: `repeat:${ids[x]}:${ids[y]}:${flags.length}`,
          check: 'code',
          kind: 'repeated-passage',
          title: `The same ${run.words} words appear in two essays`,
          detail: 'Reusing a passage can be fine, but readers notice. Make sure it\'s intended.',
          citations: [{ sectionId: ids[x], quote: run.quoteA }, { sectionId: ids[y], quote: run.quoteB }],
        });
      }
    }
  }
  return flags;
}

// ---------- 4. limits ----------

/** Common App blocks over-limit text in the form, so this matters for drafts pasted in before entering them. */
export function checkActivityDescriptionDraft(sectionId, description) {
  if (description.length <= LIMITS.activityDescription) return [];
  return [{
    id: `limit:${sectionId}`,
    check: 'code',
    kind: 'character-limit',
    title: `Description is ${description.length} characters; the limit is ${LIMITS.activityDescription}`,
    detail: `Common App won't accept more than ${LIMITS.activityDescription} characters here.`,
    citations: [{ sectionId, quote: description }],
  }];
}

export function checkLimits(app) {
  const flags = [];
  const essay = app.sections['personal-essay'];
  if (essay && countWords(essay) > PERSONAL_ESSAY_WORD_LIMIT) {
    flags.push({
      id: 'limit:personal-essay',
      check: 'code',
      kind: 'word-limit',
      title: `Personal essay is ${countWords(essay)} words; the limit is ${PERSONAL_ESSAY_WORD_LIMIT}`,
      detail: 'Common App won\'t accept a longer personal essay.',
      citations: [{ sectionId: 'personal-essay', quote: essay.split(/\s+/).slice(0, 12).join(' ') }],
    });
  }
  for (const activity of app.activities ?? []) {
    flags.push(...checkActivityDescriptionDraft(activity.id, activity.description));
  }
  return flags;
}

// ---------- all together ----------

/**
 * @param {{ college: string|null, sections: Record<string,string>, activityIds: string[],
 *           essayIds: string[], collegeEssayIds: string[], activities?: Array<{ id: string, description: string }> }} app
 */
export function runCodeChecks(app) {
  return [
    ...checkOtherCollegeNames(app),
    ...checkStartYears(app),
    ...checkQualifiedTitles(app),
    ...checkRepeatedPassages(app),
    ...checkLimits(app),
  ];
}

/** Check input from a PDF read by readCommonApp. */
export function checkInputFromPdf(result) {
  const collegeEssayIds = result.collegeEssays.map((e) => e.id);
  const essayIds = [
    ...(result.personalEssay ? ['personal-essay'] : []),
    ...(result.additionalInformation ? ['additional-information'] : []),
    ...collegeEssayIds,
  ];
  return {
    college: result.college,
    sections: result.sections,
    activityIds: result.activities.map((a) => a.id),
    honorIds: result.honors.map((h) => h.id),
    essayIds,
    collegeEssayIds,
    // No activity limits for PDFs: Common App's form already enforces them, so an over-limit
    // description in a PDF can only mean a reading bug (as on Nov 21, when the sport printed
    // before athletics descriptions was counted). Tests assert parsed descriptions fit instead.
    // Limits stay on for pasted drafts (checkActivityDescriptionDraft).
    activities: [],
  };
}
