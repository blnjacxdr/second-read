// Finds the public names (programs, colleges, organizations, competitions,
// awards) that the optional cloud fact-check may send to Gemini. Nothing is
// sent from here: the student ticks which names go, and every name sent is
// logged first (privacy rule 2).
//
// Works from what every Common App PDF shares, not from our samples:
//   1. Code: activity headings ("Org, Position") and honor titles.
//   2. Gemini Nano (on this computer): names inside sentences, like
//      "Research Science Institute (RSI) at Stanford University".
//   3. Code again: a name is kept only if it appears in the application word
//      for word (so Nano can't invent one), people are never kept, and
//      repeats are merged.
import { normalizeForMatch } from './quotes.js';

/** Kinds of name the cloud may check. Anything else, people included, is never offered. */
export const PUBLIC_KINDS = ['program', 'college', 'organization', 'competition', 'award'];

// A name made only of these words names no one in particular ("Varsity Soccer",
// "Tutoring Club"), so there is nothing to fact-check.
const GENERIC = new Set(`a an and the of for in at on to with &
  club team society council committee association group league band orchestra choir chorus ensemble
  varsity jv junior senior freshman sophomore school high middle academy department class program project
  student students youth community volunteer volunteering service tutoring tutor research lab laboratory
  soccer football basketball baseball softball volleyball tennis golf swim swimming diving track cross country
  wrestling lacrosse hockey cheer dance theater theatre drama debate speech robotics coding math science
  art music newspaper yearbook journalism model un government leadership internship job work part time
  first place second third honor honors award awards prize scholar scholarship winner finalist semifinalist`.split(/\s+/));

// Names that may point to the student's own school. Offered, but unticked by
// default: a school name plus rare activities can identify a person.
const OWN_SCHOOL = /\b(high school|middle school|secondary school|hs|academy|prep|preparatory|day school|charter school)\b/i;

const words = (text) => text.toLowerCase().match(/[a-z0-9&]+/g) ?? [];

/** True if a name has at least one word that isn't generic, and at least one capital letter or digit. */
export function isSpecificName(name) {
  if (!/[A-Z0-9]/.test(name)) return false;
  return words(name).some((w) => !GENERIC.has(w) && !/^\d+$/.test(w));
}

/** Tidy a candidate: trim spaces and edge punctuation, drop a leading "the". */
export function cleanName(name) {
  const edges = (t) => t.replace(/^[\s"'“”‘’,;:.-]+|[\s"'“”‘’,;:.-]+$/g, '');
  let out = edges(edges(String(name ?? '').replace(/\s+/g, ' ')).replace(/^the\s+/i, ''));
  // Trim a bracket only when it has no partner: "(RSI)" stays, "FIRST)" loses its ")".
  const opens = (out.match(/\(/g) ?? []).length;
  const closes = (out.match(/\)/g) ?? []).length;
  if (closes > opens) out = out.replace(/\)+$/, '');
  if (opens > closes) out = out.replace(/^\(+/, '');
  return edges(out).trim();
}

/** Splits "Juniper Ridge Robotics (FIRST Robotics Competition)" into the two names it holds. */
function withParentheses(name) {
  const inside = [...name.matchAll(/\(([^)]{2,80})\)/g)].map((m) => m[1]);
  if (inside.length === 0) return [name];
  return [name.replace(/\s*\([^)]*\)\s*/g, ' ').trim(), ...inside];
}

/** True if `short` is an abbreviation written inside `long`, like "RSI" in "Research Science Institute (RSI)". */
function isAbbreviationOf(short, long) {
  return /^[A-Z0-9&]{2,8}$/.test(short) && long.length > short.length && new RegExp(`\\b${short.replace(/&/g, '\\&')}\\b`).test(long);
}

/**
 * 1. Names code can read from the PDF's structure.
 * @param {{ activities: Array<{id, heading}>, honors: Array<{id, title}> }} result  readCommonApp(rows)
 * @returns {Array<{ name: string, sectionId: string }>}
 */
export function namesFromStructure(result) {
  const found = [];
  for (const a of result.activities ?? []) {
    const heading = a.heading ?? '';
    const comma = heading.lastIndexOf(', ');
    const org = comma > 0 ? heading.slice(0, comma) : heading; // "Org, Position": the position is never a name
    for (const n of withParentheses(org)) found.push({ name: n, sectionId: a.id });
  }
  for (const h of result.honors ?? []) {
    const title = (h.title ?? '').split(', ')[0]; // "State Science Fair, 2nd Place" -> the fair
    for (const n of withParentheses(title)) found.push({ name: n, sectionId: h.id });
  }
  return found;
}

/** Finds a name in the application, ignoring case and spacing. Returns the ids of the sections it is in. */
export function sectionsContaining(name, sections) {
  const needle = normalizeForMatch(name).toLowerCase();
  if (needle.length < 3) return [];
  return Object.entries(sections)
    .filter(([, text]) => typeof text === 'string' && normalizeForMatch(text).toLowerCase().includes(needle))
    .map(([id]) => id);
}

/**
 * 3. Merges code and Nano candidates into the list the student sees.
 * @param {Array<{ name, sectionId? }>} fromCode
 * @param {Array<{ name, kind }>} fromNano  Nano's answers, already flattened
 * @param {Record<string,string>} sections
 * @returns {{ names: Array<{ name, kind, source, sectionIds, defaultOn }>, dropped: Array<{ name, reason }> }}
 */
export function mergePublicNames(fromCode, fromNano, sections) {
  const dropped = [];
  const byKey = new Map();
  const add = (raw, kind, source) => {
    const name = cleanName(raw);
    if (!name) return;
    if (!PUBLIC_KINDS.includes(kind)) return dropped.push({ name, reason: kind === 'person' ? 'a person, never sent' : 'not a public name' });
    if (!isSpecificName(name)) return dropped.push({ name, reason: 'too generic to check' });
    const sectionIds = sectionsContaining(name, sections);
    if (sectionIds.length === 0) return dropped.push({ name, reason: 'not in the application word for word' });
    const key = normalizeForMatch(name).toLowerCase();
    const prev = byKey.get(key);
    if (prev) { if (source === 'nano' && prev.source === 'code') prev.kind = kind; return; }
    byKey.set(key, { name, kind, source, sectionIds, defaultOn: !OWN_SCHOOL.test(name) });
  };
  for (const c of fromCode) add(c.name, 'organization', 'code');
  for (const n of fromNano) add(n?.name, n?.kind, 'nano');

  // An abbreviation written inside a longer name ("RSI" in "Research Science Institute (RSI)") is the same thing.
  // Two different names that merely share words ("Lakeview Robotics", "FIRST Tech Challenge") both stay.
  const names = [...byKey.values()];
  const kept = names.filter((n) => !names.some((m) => m !== n && isAbbreviationOf(n.name, m.name)));
  for (const n of names) if (!kept.includes(n)) dropped.push({ name: n.name, reason: 'abbreviation of a longer name' });
  return { names: kept, dropped };
}

/**
 * The texts Nano reads, in a few calls rather than dozens: all activity and
 * honor lines together, then each essay on its own.
 * @returns {Array<{ id: string, text: string }>}
 */
export function nameSearchTexts(result) {
  const lines = [
    ...(result.activities ?? []).map((a) => `${a.heading}. ${a.description ?? ''}`),
    ...(result.honors ?? []).map((h) => h.title),
  ].filter(Boolean);
  const texts = [];
  if (lines.length) texts.push({ id: 'activities-and-honors', text: lines.join('\n') });
  if (result.personalEssay?.text) texts.push({ id: 'personal-essay', text: result.personalEssay.text });
  if (result.additionalInformation?.text) texts.push({ id: 'additional-information', text: result.additionalInformation.text });
  for (const e of result.collegeEssays ?? []) if (e.text) texts.push({ id: e.id, text: e.text });
  return texts;
}
