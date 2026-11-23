// The cloud name check. Turns the public names the student ticked into numbered questions,
// writes the one prompt that leaves the laptop, and reads Gemini's answer back.
// Pure functions: no Firebase, no DOM. src/ai.js sends the prompt and records it in the sent log first.
//
// Two kinds of question:
//   lookup  "Look up: Research Science Institute (RSI)"  -> does it exist, official name, where it's held.
//   partOf  "Is Wolverine Robotics part of University of Michigan?" -> asked for names in that college's
//           own essays, to catch a program from another school slipped into the wrong supplement.
//
// After the answer comes back, placeConflicts compares it with the student's own text ON THE LAPTOP:
// if the activity says "RSI at Stanford" and Google says RSI is held at MIT, that's worth a look.
// Only a college written right after the name counts (about a line), not one mentioned elsewhere.
// That comparison sends nothing anywhere.

import { normalizeForMatch } from './quotes.js';
import { COLLEGES, namesFor } from './colleges.js';

export const MAX_NAME_WORDS = 12;
export const MAX_NAME_CHARS = 120;
export const MAX_QUESTIONS = 25;

const lower = (text) => normalizeForMatch(text).toLowerCase();
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (haystack, needle) => new RegExp(`(^|\\W)${escape(lower(needle))}(\\W|$)`).test(lower(haystack));

/** A last guard before anything is sent: a name is short, one line, and not a sentence of someone's writing. */
export function isSendableName(name) {
  if (typeof name !== 'string') return false;
  const clean = name.trim();
  if (!clean || /[\r\n]/.test(clean) || clean.length > MAX_NAME_CHARS) return false;
  return clean.split(/\s+/).length <= MAX_NAME_WORDS;
}

/**
 * Builds the questions the student can tick. Lookups follow each name's own default (people, essay-only
 * names and the student's own school start unticked). Part-of questions start ticked.
 * @param {Array<{name: string, kind: string, sectionIds: string[], defaultOn: boolean, why?: string}>} names
 * @param {{ college?: string|null }} options  the college this PDF is for
 */
export function cloudQuestions(names, { college = null } = {}) {
  const collegeAliases = college ? collegeNamesFor(college) : [];
  const questions = [];
  for (const n of names) {
    if (!isSendableName(n.name)) continue;
    questions.push({ kind: 'lookup', name: n.name, sectionIds: n.sectionIds, defaultOn: Boolean(n.defaultOn), why: n.why ?? null });
    const inOwnEssays = college && n.sectionIds.some((id) => id.startsWith('college-essay-'));
    const isACollege = n.kind === 'college' || collegeAliases.some((a) => lower(a) === lower(n.name));
    if (inOwnEssays && !isACollege) {
      questions.push({ kind: 'partOf', name: n.name, college, sectionIds: n.sectionIds, defaultOn: true, why: null });
    }
  }
  return questions.slice(0, MAX_QUESTIONS).map((q, i) => ({ id: i + 1, ...q }));
}

/** Every way the PDF's college might be written, from the college list, or just the name itself. */
function collegeNamesFor(college) {
  const known = COLLEGES.find((c) => namesFor(c).some((n) => lower(n) === lower(college)));
  return known ? namesFor(known) : [college];
}

/** The one prompt that goes to the cloud. Only fixed wording, the names and the college name. */
export function cloudNamesPrompt(questions, { withSearch = true } = {}) {
  if (!Array.isArray(questions) || questions.length === 0) throw new Error('cloudNamesPrompt: need at least one question');
  if (questions.length > MAX_QUESTIONS) throw new Error(`cloudNamesPrompt: at most ${MAX_QUESTIONS} questions`);
  for (const q of questions) {
    if (!isSendableName(q.name)) throw new Error('cloudNamesPrompt: a name is too long to be a name');
    if (q.kind === 'partOf' && !isSendableName(q.college)) throw new Error('cloudNamesPrompt: bad college name');
  }
  return [
    withSearch
      ? 'Use Google Search to answer each numbered question.'
      : 'Answer each numbered question from what you know. If you are not sure, answer UNSURE.',
    'Reply with one line per question, in this exact form and nothing else:',
    'number | answer | official name | where it is held or based | one short sentence of fact',
    'For "Look up" questions the answer is EXISTS, NOT FOUND or UNSURE.',
    'For "Part of" questions the answer is YES, NO or UNSURE.',
    'Write - for any part you do not know.',
    '',
    ...questions.map((q) => (q.kind === 'partOf' ? `${q.id}. Part of: is ${q.name} part of ${q.college}?` : `${q.id}. Look up: ${q.name}`)),
  ].join('\n');
}

function verdictFor(word, kind) {
  const w = (word || '').toUpperCase();
  if (kind === 'partOf') return w.startsWith('YES') ? 'yes' : w.startsWith('NO') ? 'no' : 'unsure';
  return w.startsWith('EXIST') ? 'exists' : w.startsWith('NOT') ? 'not_found' : 'unsure';
}
const orNull = (text) => (text && text.trim() && text.trim() !== '-' ? text.trim() : null);

/**
 * Reads the answer lines back. Tolerates bold markers, bullets and "1." or "1)" numbering.
 * Lines it can't place go to leftover, so they can still be shown as plain text.
 */
export function parseCloudAnswer(text, questions) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answers = new Map();
  const leftover = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\*\*/g, '').replace(/^[\s>*-]+/, '').trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s*[.):]?\s*\|?\s*(.*)$/);
    const q = m && byId.get(Number(m[1]));
    if (!q || answers.has(q.id)) { leftover.push(raw.trim()); continue; }
    const parts = m[2].split('|').map((s) => s.trim());
    answers.set(q.id, {
      id: q.id,
      verdict: verdictFor(parts[0], q.kind),
      official: orNull(parts[1]),
      place: orNull(parts[2]),
      fact: orNull(parts.slice(3).join(' | ')),
    });
  }
  return {
    answers: questions.filter((q) => answers.has(q.id)).map((q) => answers.get(q.id)),
    missing: questions.filter((q) => !answers.has(q.id)).map((q) => q.id),
    leftover,
  };
}

/**
 * On the laptop, after the answer is back: colleges the student wrote in the same sections as a name,
 * that Google's answer doesn't mention. "RSI at Stanford" + "held at MIT" -> [{ written: 'Stanford University' }].
 * @param {{name: string, sectionIds: string[]}} question
 * @param {{official: string|null, place: string|null, fact: string|null}} answer
 * @param {Record<string, string>} sections  the application's text, by section id
 */
export function placeConflicts(question, answer, sections) {
  const said = [answer.official, answer.place, answer.fact].filter(Boolean).join(' ');
  if (!answer.place || !said) return [];
  const near = nearbyText(question, sections);
  const conflicts = [];
  for (const college of COLLEGES) {
    const names = namesFor(college);
    if (names.some((n) => mentions(question.name, n))) continue; // the college is part of the name itself
    if (!names.some((n) => mentions(near, n))) continue; // the student didn't put this college next to the name
    if (!names.some((n) => mentions(said, n))) conflicts.push({ written: college.name });
  }
  return conflicts;
}

// The text right after each place the name appears (about a line), where "at Stanford" or ", MIT" would be.
// Only this close window counts, so a college mentioned elsewhere in an essay doesn't trigger a conflict.
const NEAR_CHARS = 60;
function nearbyText(question, sections) {
  const needle = lower(question.name);
  const windows = [];
  for (const id of question.sectionIds) {
    const text = typeof sections[id] === 'string' ? lower(sections[id]) : '';
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
      windows.push(text.slice(at, at + needle.length + NEAR_CHARS));
    }
  }
  return windows.join(' \n ');
}

/** What the student sees for one answer: 'fine', 'look' (worth a look before submitting) or 'unsure'. */
export function answerStatus(question, answer, conflicts = []) {
  if (!answer || answer.verdict === 'unsure') return 'unsure';
  if (answer.verdict === 'not_found' || answer.verdict === 'no' || conflicts.length > 0) return 'look';
  return 'fine';
}
