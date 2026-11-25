// The cloud fallback, asked for and agreed to (Nov 24).
//
// Second Read reads applications on the device with Gemini Nano. When Nano isn't on this laptop, the counselor is
// asked, in plain words, whether to read this PDF with Gemini in Google's cloud instead. Only after a yes does
// src/ai.js build its hybrid models (the prefer-on-device mode). Every prompt is recorded in the sent log
// before it is sent, and every quote the cloud returns still has to be in the application or the flag is dropped.
// Pure helpers live here so they can be tested.

export const CONSENT_COPY = {
  question: 'Gemini Nano isn\'t on this laptop. Read this application with Gemini in Google\'s cloud instead?',
  // Honest about retention (researched Nov 24): on the paid Gemini API, Google doesn't train on prompts, and keeps
  // them only for a limited time to check for abuse.
  what: 'This sends the essays, activities and honors in this PDF to Google\'s Gemini API. Google doesn\'t use them to improve its products and keeps them only briefly, to check for abuse. Every word sent shows under "What was sent."',
  yes: 'Use the cloud for this visit',
  no: 'Code checks only',
};

/** The closer read, offered after Gemini Nano has read (laptops that have Nano). The button is the yes. */
export const CLOSER_COPY = {
  label: 'optional, with your yes',
  title: 'Read it closer',
  intro: 'Gemini Nano reads in small pieces on this laptop. Gemini in Google\'s cloud can read the whole application at once and usually finds more. This sends the essays, activities and honors in this PDF to Google\'s Gemini API. Google doesn\'t use them to improve its products and keeps them only briefly, to check for abuse. Every word sent shows under "What was sent."',
  button: 'Send it to Gemini for a closer read',
  reading: 'Gemini is reading it all together, in Google\'s cloud…',
  found: (n) => (n === 1 ? 'Gemini found 1 more spot. It\'s added to the list as a maybe.' : `Gemini found ${n} more spots. They're added to the list as maybes.`),
  none: 'Gemini read it all together and found nothing new.',
  failed: 'Couldn\'t reach Gemini in the cloud just now. Nothing new was added; try again in a minute.',
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
