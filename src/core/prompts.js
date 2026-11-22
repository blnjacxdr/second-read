// Prompt text and output schemas. Pure, so tests can check exactly what each
// prompt contains (and, for the cloud prompt, that it contains nothing private).
//
// Second Read never writes or rewrites application text. The on-device prompt
// asks only for categories and exact quotes; no free-text suggestions.

export const CONTRADICTION_KINDS = ['hours', 'role', 'dates', 'award', 'other'];

/** JSON Schema passed to Chrome's on-device model as a responseConstraint. */
export const CONTRADICTION_SCHEMA = {
  type: 'object',
  properties: {
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: CONTRADICTION_KINDS },
          activityQuote: { type: 'string' },
          essayQuote: { type: 'string' },
        },
        required: ['kind', 'activityQuote', 'essayQuote'],
      },
    },
  },
  required: ['contradictions'],
};

/**
 * Prompt for the on-device model: one activity entry vs one essay passage.
 * @param {string} activityText
 * @param {string} essayText
 */
export function contradictionPrompt(activityText, essayText) {
  return [
    'You compare two parts of the same college application and report factual contradictions between them.',
    'Only report a contradiction when both parts state facts that cannot both be true:',
    'hours or how often (hours), a role or title (role), a year, date or grade (dates), an award or placing (award).',
    'For each contradiction, copy one exact quote from the ACTIVITY and one exact quote from the ESSAY, character for character.',
    'Each quote must be at least 3 words long. From the ACTIVITY, copy one whole line (for example "6 hr/wk, 30 wk/yr").',
    'From the ESSAY, copy the whole phrase that states the conflicting fact, not just a number or one or two words.',
    'Do not rewrite, suggest or explain anything. If there is no contradiction, return an empty list.',
    '',
    'ACTIVITY:',
    activityText,
    '',
    'ESSAY:',
    essayText,
  ].join('\n');
}

/**
 * The extraction design (see extract-checks.js): Nano reports what ONE essay
 * paragraph says about ONE activity, with exact quotes. Empty string or 0 when
 * the paragraph doesn't say. Code does the comparing.
 */
export const FACTS_SCHEMA = {
  type: 'object',
  properties: {
    aboutThisActivity: { type: 'boolean' },
    hoursQuote: { type: 'string' },
    hoursPerWeek: { type: 'number' },
    roleQuote: { type: 'string' },
    role: { type: 'string' },
    placeQuote: { type: 'string' },
  },
  required: ['aboutThisActivity', 'hoursQuote', 'hoursPerWeek', 'roleQuote', 'role', 'placeQuote'],
};

// Worked examples (few-shot prompting). Made up for this prompt; never taken
// from the held-out test set, or that test would stop meaning anything.
// They cover: an estimate from "every morning", a paragraph about something
// else, a title and placing with no hours, and years/seasons that are not
// time per week.
const FACTS_EXAMPLES = [
  'EXAMPLES:',
  'ACTIVITY: Lakeview Swim Club',
  'PARAGRAPH: Every morning before school I swam for two hours at Lakeview, and on Saturdays I helped the younger kids with flip turns.',
  'ANSWER: {"aboutThisActivity": true, "hoursQuote": "Every morning before school I swam for two hours", "hoursPerWeek": 10, "roleQuote": "", "role": "", "placeQuote": ""}',
  '',
  'ACTIVITY: Westbrook Robotics',
  'PARAGRAPH: My grandmother taught me to plant tomatoes in rows of six, and I still count the rows when I visit her.',
  'ANSWER: {"aboutThisActivity": false, "hoursQuote": "", "hoursPerWeek": 0, "roleQuote": "", "role": "", "placeQuote": ""}',
  '',
  'ACTIVITY: Riverside Chess Club',
  'PARAGRAPH: As club president, I organized our first tournament, where our team took third place.',
  'ANSWER: {"aboutThisActivity": true, "hoursQuote": "", "hoursPerWeek": 0, "roleQuote": "As club president", "role": "president", "placeQuote": "our team took third place"}',
  '',
  'ACTIVITY: Harbor Youth Orchestra',
  'PARAGRAPH: I joined the Harbor Youth Orchestra in 2022 and played viola for three seasons.',
  'ANSWER: {"aboutThisActivity": true, "hoursQuote": "", "hoursPerWeek": 0, "roleQuote": "", "role": "", "placeQuote": ""}',
].join('\n');

/**
 * @param {string} itemName  the organization or the honor's title, never the student's listed hours or title
 * @param {string} passage   one essay paragraph
 */
export function factsPrompt(itemName, passage) {
  return [
    `Read this paragraph from a student's college essay. Answer only about this activity: ${itemName}`,
    'aboutThisActivity: true if the paragraph talks about this activity, otherwise false.',
    'hoursQuote: copy, character for character, the phrase (at least 3 words) that says how much time the student spends on it, for example "practiced three hours every night". Empty string if the paragraph does not say.',
    'hoursPerWeek: that time as hours per week, your best estimate. 0 if the paragraph does not say.',
    'roleQuote: copy the phrase (at least 3 words) that names the student\'s title or role in it, for example "as team captain". Empty string if none.',
    'role: just that title, for example "captain". Empty string if none.',
    'placeQuote: copy the phrase (at least 3 words) that states a placing or prize the student won, for example "we took second place". Empty string if none.',
    'Copy quotes only from the paragraph. Do not rewrite, suggest or explain anything.',
    '',
    FACTS_EXAMPLES,
    '',
    `Now the real one. ACTIVITY: ${itemName}`,
    'PARAGRAPH:',
    passage,
  ].join('\n');
}

/**
 * Prompt for the cloud model. It may contain only public names
 * (organizations, programs, colleges), never application text.
 * With search, the model is told to use Google Search; without it, the model
 * answers from its own knowledge and is told to say when it is unsure.
 * @param {string[]} publicNames
 * @param {{ withSearch?: boolean }} [options]
 */
export function publicNamesPrompt(publicNames, { withSearch = true } = {}) {
  if (!Array.isArray(publicNames) || publicNames.length === 0) throw new Error('publicNamesPrompt: need at least one name');
  const how = withSearch
    ? 'Use Google Search to check each name below. For each one, answer on one line:'
    : 'Check each name below from what you know. If you are not sure, say UNSURE. For each one, answer on one line:';
  return [
    how,
    'the name as given, then EXISTS or NOT FOUND, then the correct official name and where it is based if the given name or place is wrong.',
    '',
    ...publicNames.map((name) => `- ${name}`),
  ].join('\n');
}
