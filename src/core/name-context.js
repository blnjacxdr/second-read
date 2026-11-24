// After Google answers the name check, Gemini Nano reads each name in the student's own sentence, on this laptop,
// and says whether a detail there disagrees with what Google found ("RSI at Stanford" when Google says MIT).
// The student's sentence never leaves the laptop: Google's answer comes in, the comparison happens here.
// Like every AI flag, the words Nano points at must really be in the application (locateQuote), or it's dropped.

import { sentencesOf } from './checks.js';
import { locateQuote, normalizeForMatch } from './quotes.js';

export const CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    agrees: { type: 'string', enum: ['yes', 'no', 'unclear'] },
    quote: { type: 'string' },
  },
  required: ['agrees', 'quote'],
};

const MAX_SENTENCES = 2;
const MAX_SENTENCE_CHARS = 400;

/** The ways a name can be written: "Research Science Institute (RSI)" -> itself, "Research Science Institute", "RSI". */
export function nameForms(name) {
  const forms = [name, name.replace(/\s*\([^)]*\)\s*/g, ' ').trim(), ...[...name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim())];
  return [...new Set(forms.filter((f) => f.length >= 2))];
}

/** Up to two sentences from the student's application that use the name, with where they came from. */
export function contextSentences(question, sections) {
  const forms = nameForms(question.name).map((f) => normalizeForMatch(f));
  const out = [];
  for (const sectionId of question.sectionIds ?? []) {
    for (const s of sentencesOf(String(sections[sectionId] ?? ''))) {
      if (s.text.length > MAX_SENTENCE_CHARS) continue;
      const norm = normalizeForMatch(s.text);
      const form = forms.find((f) => norm.includes(f));
      // A line that is little more than the name (an activity's "Org, Position" heading) says nothing to compare.
      if (form && norm.replace(form, ' ').split(/\s+/).filter((w) => /\w{2,}/.test(w)).length >= 4) out.push({ sectionId, text: s.text });
      if (out.length >= MAX_SENTENCES) return out;
    }
  }
  return out;
}

/** What Google said, as one plain line for the prompt. Null when Google said nothing useful. */
export function googleSays(answer) {
  if (!answer || !['exists', 'yes', 'school', 'state', 'national', 'international'].includes(answer.verdict)) return null;
  const parts = [answer.official, answer.place && `Held or based in: ${answer.place}`, answer.fact].filter(Boolean);
  return parts.length ? parts.join('. ') : null;
}

export function contextPrompt(name, google, sentence) {
  return [
    'A student wrote the sentence below in a college application.',
    `Google Search says this about ${name}: ${google}`,
    'Does any detail in the student\'s sentence disagree with what Google says? For example a different city, college or host,',
    'a different kind of program, a different organizer, or a different age group.',
    'Answer agrees "no" only if a specific detail disagrees, and copy the student\'s exact words for that detail into quote (a few words).',
    'Answer "yes" if nothing disagrees, or "unclear" if the sentence does not say enough. When the answer is not "no", quote is "".',
    '',
    'SENTENCE:',
    sentence,
  ].join('\n');
}

/**
 * Turns Nano's answer into a finding, or null. The quote must be in the sentence and in the application, and must
 * be more than the name itself (quoting the name is not a disagreement).
 */
export function contextFinding(answer, sentence, sections, name) {
  if (!answer || answer.agrees !== 'no') return null;
  const quote = String(answer.quote ?? '').trim().replace(/^["“']|["”']$/g, '');
  if (quote.length < 3 || !normalizeForMatch(sentence.text).includes(normalizeForMatch(quote))) return null;
  if (nameForms(name).some((f) => normalizeForMatch(f) === normalizeForMatch(quote))) return null;
  // Short quotes ("at Stanford") are under locateQuote's word minimum, so the whole sentence is located instead,
  // with the quote as the part to point at. Either way both are checked against the application.
  const found = locateQuote(sections, { sectionId: sentence.sectionId, quote }) ?? locateQuote(sections, { sectionId: sentence.sectionId, quote: sentence.text });
  return found ? { sectionId: sentence.sectionId, sentence: found.text, quote } : null;
}
