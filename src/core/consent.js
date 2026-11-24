// The cloud fallback, asked for and agreed to (Nov 24).
//
// Second Read reads applications on the device with Gemini Nano. When Nano isn't on this laptop, the counselor is
// asked, in plain words, whether to read this PDF with Gemini in Google's cloud instead. Only after a yes does
// src/ai.js build its hybrid models (the prefer-on-device mode). Every prompt is recorded in the sent log
// before it is sent, and every quote the cloud returns still has to be in the application or the flag is dropped.
// Pure helpers live here so they can be tested.

export const CONSENT_COPY = {
  question: 'Gemini Nano isn\'t on this laptop. Read this application with Gemini in Google\'s cloud instead?',
  what: 'This sends the essays and activity list in this PDF to Google\'s Gemini API, for this visit only. Google doesn\'t use it to improve its products. Every word sent shows under "What was sent."',
  yes: 'Use the cloud for this visit',
  no: 'Code checks only',
};

/** Purpose line in the sent log for each cloud question. */
export const CLOUD_PURPOSE = 'Read with Gemini in Google\'s cloud (you said yes)';

/**
 * The prompt the cloud model gets: the same narrow question as on the device, plus the answer shape in words,
 * because the cloud model is asked for JSON rather than held to Chrome's response constraint.
 * @param {string} prompt
 * @param {object} schema  a JSON Schema (the same one the on-device model uses)
 */
export function withJsonShape(prompt, schema) {
  return `${prompt}\n\nReply with one JSON object only, no other text, matching this JSON Schema:\n${JSON.stringify(schema)}`;
}

/** Reads a model's JSON reply, forgiving a ```json fence or words around the object. Throws if there is none. */
export function parseModelJson(text) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('no JSON object in the reply');
    return JSON.parse(raw.slice(start, end + 1));
  }
}
