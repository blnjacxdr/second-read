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
    'Each quote must be at least 3 words long. From the ACTIVITY, copy the whole line, including its label (for example "Hours per week: 6").',
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
