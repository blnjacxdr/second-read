// The cloud fallback, asked for and agreed to (Nov 24).
//
// Second Read reads applications on the device with Gemini Nano by default. Since Nov 25 the counselor picks how
// closely to read on the start page (readingChoices below). Only when they pick Gemini in Google's cloud does
// src/ai.js build a cloud model: the hybrid models (prefer-on-device) when this laptop has no Nano, or cloud-only
// models when it has Nano, so the cloud reading they picked can't quietly run on Nano instead. Every prompt is recorded in the sent log
// before it is sent, and every quote the cloud returns still has to be in the application or the flag is dropped.
// Pure helpers live here so they can be tested.

export const CONSENT_COPY = {
  // Calm but exact (the builder asked for softer wording, Nov 25). Retention researched Nov 24: on the paid Gemini API,
  // Google doesn't train on prompts and keeps them only for a limited time to check for abuse. Don't round this off
  // into "private" or "nothing is kept": both would be untrue.
  what: 'Gemini reads the essays, activities and honors on Google\'s servers, over an encrypted connection. Google doesn\'t train on them, and keeps them only briefly to check for abuse. Every word sent is listed under "What was sent."',
};

/**
 * The reading picker on the start page (Nov 25, the builder's decision): the counselor picks how closely to read BEFORE
 * dropping a PDF. Picking the cloud, with CONSENT_COPY.what shown right under the choices, is the yes. The private
 * choice starts picked: Gemini Nano when this laptop has it, otherwise code checks only. Nothing goes to the cloud
 * unless someone picks it on purpose.
 * @param {string} availability  from onDeviceAvailability(): 'available', 'downloadable', 'downloading' or 'unavailable'
 * @param {string|null} current  what the counselor picked earlier this visit, kept if it's still possible
 * @returns {{ picked: 'cloud'|'nano'|'code', nano: { enabled: boolean, why: string } }}
 */
export function readingChoices(availability, current = null) {
  const hasNano = availability === 'available';
  const why = hasNano ? '' : {
    downloadable: 'Download it first, on the yellow note.',
    downloading: 'Still downloading. Ready in a few minutes.',
  }[availability] ?? 'Not in this browser. It\'s in Chrome on some laptops.';
  const possible = ['cloud', 'code', ...(hasNano ? ['nano'] : [])];
  const picked = possible.includes(current) ? current : hasNano ? 'nano' : 'code';
  return { picked, nano: { enabled: hasNano, why } };
}

/** The closer read, offered after Gemini Nano has read (laptops that have Nano). The button is the yes. */
export const CLOSER_COPY = {
  label: 'optional, with your yes',
  title: 'Read it closer',
  intro: 'Gemini Nano reads in small pieces. Gemini in Google\'s cloud reads the whole application at once and usually finds more.',
  // After a code-checks-only reading: the counselor can step up from the results page instead of starting over.
  introCodeOnly: 'Code checks only compare what they have a rule for. Gemini also reads the essays for hours, titles and awards that don\'t match.',
  nanoButton: 'Read with Gemini Nano, on this laptop',
  nanoReading: (done, total) => `Gemini Nano is reading, on this laptop${total ? ` (${done} of ${total})` : ''}…`,
  nanoFound: (n) => (n === 0 ? 'Gemini Nano read it and found nothing new. You can still ask Gemini in the cloud for a closer read.'
    : `Gemini Nano found ${n === 1 ? '1 spot. It\'s' : `${n} spots. They're`} added to the list as ${n === 1 ? 'a maybe' : 'maybes'}.`),
  nanoFailed: 'Gemini Nano stopped before it finished. Nothing new was added.',
  // What goes, said right beside the button that sends it.
  fine: CONSENT_COPY.what,
  button: 'Send it to Gemini for a closer read',
  reading: 'Gemini is reading it all together, in Google\'s cloud…',
  found: (n) => `${n === 1 ? 'Gemini found 1 more spot. It\'s added to the list as a maybe.' : `Gemini found ${n} more spots. They're added to the list as maybes.`} Every word sent is under "What was sent" below.`,
  none: 'Gemini read it all together and found nothing new. Every word sent is under "What was sent" below.',
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
