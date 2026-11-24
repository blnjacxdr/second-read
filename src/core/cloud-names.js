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
 * names and the student's own school start unticked), plus:
 *   - known colleges get no lookup: we know they exist, and the code check already handles other colleges' names;
 *   - clubs named after the student's own school ("Lakeside Robotics" beside "Lakeside High School") start unticked,
 *     because Google rarely knows a school club and "not found" would only worry the student;
 *   - an abbreviation is sent the way the application spells it out ("Research Science Institute (RSI)", not "RSI"),
 *     so Google knows which RSI.
 * Part-of questions are asked only for names that appear in this college's essays and nowhere else: a program in
 * the activity list is something the student did, not something they claim the college has.
 * @param {Array<{name: string, kind: string, sectionIds: string[], defaultOn: boolean, why?: string}>} names
 * @param {{ college?: string|null, sections?: Record<string, string> }} options
 */
export function cloudQuestions(names, { college = null, sections = {} } = {}) {
  const collegeAliases = college ? collegeNamesFor(college) : [];
  const schoolPrefixes = ownSchoolPrefixes(names);
  const questions = [];
  for (const n of names) {
    const sendAs = expandAbbreviation(n.name, n.sectionIds, sections);
    if (!isSendableName(sendAs)) continue;
    const isACollege = n.kind === 'college' || isKnownCollege(n.name) || collegeAliases.some((a) => lower(a) === lower(n.name));
    if (isACollege) continue;
    const schoolClub = n.defaultOn && schoolPrefixes.some((p) => lower(n.name).startsWith(`${p} `));
    questions.push({
      kind: 'lookup', name: sendAs, sectionIds: n.sectionIds,
      defaultOn: Boolean(n.defaultOn) && !schoolClub,
      why: schoolClub ? 'sounds like a club at your school' : n.why ?? null,
    });
    const onlyInTheseEssays = n.sectionIds.length > 0 && n.sectionIds.every((id) => id.startsWith('college-essay-'));
    if (college && onlyInTheseEssays) {
      questions.push({ kind: 'partOf', name: sendAs, college, sectionIds: n.sectionIds, defaultOn: true, why: null });
    }
  }
  return questions.slice(0, MAX_QUESTIONS).map((q, i) => ({ id: i + 1, ...q }));
}

const isKnownCollege = (name) => COLLEGES.some((c) => namesFor(c).some((n) => lower(n) === lower(name)));

// "Maple Grove High School Chess Team" -> "maple grove": the words before the school-type words.
const SCHOOL_WORDS = /\s+(high school|middle school|secondary school|hs|day school|charter school|academy|prep)\b.*$/i;
function ownSchoolPrefixes(names) {
  return names
    .filter((n) => SCHOOL_WORDS.test(n.name))
    .map((n) => lower(n.name.replace(SCHOOL_WORDS, '')))
    .filter((p) => p.split(' ').length >= 1 && p.length >= 4);
}

/** "RSI" -> "Research Science Institute (RSI)" when the application writes it that way; otherwise the name as is.
 *  Looks one line at a time (a field label on the line above is not part of the name) and drops a leading
 *  word like "At" or "Joined" that only starts the sentence. */
export function expandAbbreviation(name, sectionIds, sections) {
  if (!/^[A-Z][A-Z0-9&]{1,7}$/.test(name)) return name;
  const pattern = new RegExp(`((?:[A-Z][\\w&'’.-]*\\s+(?:(?:of|for|and|the|in|on|at|&)\\s+)*){1,8})\\(${escape(name)}\\)`);
  for (const id of sectionIds) {
    const text = typeof sections[id] === 'string' ? sections[id] : '';
    for (const line of text.split(/\r?\n/)) {
      const m = normalizeForMatch(line).match(pattern);
      if (!m) continue;
      const words = m[1].trim().split(' ');
      while (words.length > 1 && LEADING_WORDS.has(words[0].toLowerCase())) words.shift();
      return `${words.join(' ')} (${name})`;
    }
  }
  return name;
}
const LEADING_WORDS = new Set(['at', 'in', 'on', 'for', 'the', 'my', 'our', 'this', 'during', 'attended', 'joined', 'through', 'with']);

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
      ? 'Search Google for every numbered question below before you answer. Do not answer any of them from memory; each answer must come from a search.'
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
// "Not found" is not a problem by itself: Google rarely knows a local club or a small business.
// Worth a look means Google contradicts the application: "not part of this college", or held somewhere else.
export function answerStatus(question, answer, conflicts = []) {
  if (!answer || answer.verdict === 'unsure' || answer.verdict === 'not_found') return 'unsure';
  if (answer.verdict === 'no' || conflicts.length > 0) return 'look';
  return 'fine';
}
