// The whole-application read (Nov 25). Only in the cloud, only after the user's yes (src/core/consent.js).
//
// Gemini Nano is too small to read a whole application at once, so on the device Loomis asks narrow questions
// and code compares the answers. A cloud model can read everything together, so after a yes it is also asked to list
// every pair of places that state the same fact differently. Like every AI flag, both quotes must be in the
// application word for word (locateQuote), in two different sections, or the conflict is dropped.

import { locateQuote } from './quotes.js';

export const MAX_CONFLICTS = 12;
const KINDS = ['hours', 'role', 'award', 'dates', 'grades', 'number', 'place', 'organization', 'college', 'other'];

export const WHOLE_READ_SCHEMA = {
  type: 'object',
  properties: {
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KINDS },
          title: { type: 'string' },
          sectionA: { type: 'string' },
          quoteA: { type: 'string' },
          sectionB: { type: 'string' },
          quoteB: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['kind', 'title', 'sectionA', 'quoteA', 'sectionB', 'quoteB', 'why'],
      },
    },
  },
  required: ['conflicts'],
};

/** A flag's places as one line: [section] "quote" vs [section] "quote". */
const describe = (flag) => flag.citations.map((c) => `[${c.sectionId}] "${c.quote}"`).join(' vs ');
const sectionIds = (app) => [...app.activityIds, ...(app.honorIds ?? []), ...app.essayIds].filter((id) => app.sections[id]);
const applicationText = (app) => sectionIds(app).map((id) => `[${id}]\n${app.sections[id]}\n`);

const WHAT_COUNTS = [
  'Find every place where two DIFFERENT sections state the same fact differently: hours or weeks, a role or title,',
  'an award or placing, an award\'s level, a year or grade, a count or amount, a place, an organization name, plans to',
  'continue, or the name of the college.',
  'Do not report: things that can both be true (a role that changed over time, a club that grew, two different events,',
  'a summary next to a detail), differences in wording or tone, opinions, or anything only one section mentions.',
];
const HOW_TO_ANSWER = [
  `List each one you find, at most ${MAX_CONFLICTS}, most important first. Most applications have none or a few, and an`,
  'empty list is a fine answer. For each, copy the exact words from each section into quoteA and quoteB (3 to 25 words,',
  'copied character for character), name the sections by their ids, give a short title (under 8 words) and say in one',
  'sentence why they disagree.',
];

/**
 * The whole-application question.
 * layout 'data-first' puts the application before the instructions, as Google advises for long inputs to Gemini 3;
 * 'instructions-first' is the Nov 24 original, kept so the test page can compare the two.
 * alreadyFound (a second look) lists conflicts found before, so the model looks for different ones.
 */
// Which college this PDF is for, so a college essay that names another college as the student's choice stands out.
// (Nov 24: without it, the read missed "the kind of community I'd find at Smith" in a Barnard essay.) This is the
// one disagreement that can sit inside a single section, so it is reported with sectionA and sectionB the same.
const collegeLine = (app) => (app.college ? [
  `This application is for ${app.college}. If a college essay names a DIFFERENT college as the place the student wants`,
  'to attend or study (a name left over from another college\'s essay), report it with kind "college", sectionA and',
  'sectionB both that essay\'s id, and quoteA and quoteB both the sentence that names the other college. Naming another',
  'college for a real reason (a nearby school, a past program) is not a disagreement.',
] : []);

export function wholeReadPrompt(app, { layout = 'data-first', alreadyFound = [] } = {}) {
  const found = alreadyFound.length === 0 ? [] : [
    '',
    'These were already found. Do not list them again; look for any OTHER disagreements:',
    ...alreadyFound.map((f) => `- ${describe(f)}`),
  ];
  if (layout === 'instructions-first') {
    return [
      'Below is one student\'s college application, split into labeled sections.',
      ...WHAT_COUNTS, ...collegeLine(app), ...HOW_TO_ANSWER, ...found, '',
      ...applicationText(app),
    ].join('\n');
  }
  return [
    '<application>',
    ...applicationText(app),
    '</application>',
    '',
    'Above is one student\'s college application, split into sections labeled with ids in brackets.',
    ...WHAT_COUNTS, ...collegeLine(app), ...HOW_TO_ANSWER, ...found,
  ].join('\n');
}

// ---------- the check step ----------
//
// Research on finding inconsistencies (VERISPEC, 2026) found that making a model argue each candidate before
// reporting it cut false alarms sharply. So after the read, one more question: for each flag, can both statements
// be true? Only "conflict" verdicts are kept (or "unsure" too, in the lenient setting).

export const VERDICTS = ['conflict', 'consistent', 'unsure'];
export const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, verdict: { type: 'string', enum: VERDICTS }, reason: { type: 'string' } },
        required: ['n', 'verdict', 'reason'],
      },
    },
  },
  required: ['verdicts'],
};

export function verifyPrompt(app, flags) {
  return [
    '<application>',
    ...applicationText(app),
    '</application>',
    '',
    'Above is one student\'s college application. Someone listed the possible disagreements below. Check each one',
    'against the whole application.',
    '',
    ...flags.map((f, i) => `${i + 1}. ${describe(f)} (${f.title})`),
    '',
    'For each number, give a verdict:',
    '- "conflict": the two statements cannot both be true as written. A counselor would ask the student to fix it.',
    '- "consistent": both can be true. For example: a role that changed over time, two different events, a total next',
    '  to a part of it, different units that fit together, or wording that only sounds different.',
    '- "unsure": it depends on something the application doesn\'t say.',
    'Give one short reason for each. Answer for every number.',
  ].join('\n');
}

/** Keeps the flags whose verdict is "conflict" (and "unsure" when lenient). A flag with no verdict is kept. */
export function applyVerdicts(flags, answer, { keepUnsure = false } = {}) {
  const byNumber = new Map((answer?.verdicts ?? []).map((v) => [Number(v.n), String(v.verdict)]));
  return flags.filter((f, i) => {
    const verdict = byNumber.get(i + 1);
    if (verdict === undefined) return true;
    return verdict === 'conflict' || (keepUnsure && verdict === 'unsure');
  });
}

const overlapsAny = (ranges, others) => ranges.some((r) => others.some((o) => r.start < o.end && o.start < r.end));

/**
 * Turns the model's answer into flags. Drops anything whose quotes aren't both in the application, that points at
 * one section twice, or that repeats a place an existing flag already covers.
 * @param {{ conflicts?: Array<object> }} answer
 * @param {Record<string, string>} sections
 * @param {Array<{ citations: Array<{ sectionId: string, quote: string }> }>} existing  flags already on the list
 * @returns {{ kept: object[], dropped: Array<{ reason: string }> }}
 */
export function wholeReadFlags(answer, sections, existing = []) {
  const kept = [];
  const dropped = [];
  const covered = []; // { sectionId, ranges } of every place already flagged
  const cover = (flag) => {
    for (const c of flag.citations) {
      const found = locateQuote(sections, c, { minWords: 1 });
      if (found) covered.push({ sectionId: c.sectionId, ranges: found.ranges });
    }
  };
  existing.forEach(cover);
  for (const c of (answer?.conflicts ?? []).slice(0, MAX_CONFLICTS)) {
    const a = String(c.sectionA ?? '').trim();
    const b = String(c.sectionB ?? '').trim();
    if (!sections[a] || !sections[b]) { dropped.push({ reason: 'unknown section' }); continue; }
    // One section is allowed only for another college's name in a college essay (see collegeLine).
    const single = a === b;
    if (single && !(c.kind === 'college' && /^college-essay-/.test(a))) { dropped.push({ reason: 'same section twice' }); continue; }
    const foundA = locateQuote(sections, { sectionId: a, quote: String(c.quoteA ?? '') });
    const foundB = single ? foundA : locateQuote(sections, { sectionId: b, quote: String(c.quoteB ?? '') });
    if (!foundA || !foundB) { dropped.push({ reason: 'quote not found in the application' }); continue; }
    const seen = (sid, ranges) => covered.some((x) => x.sectionId === sid && overlapsAny(ranges, x.ranges));
    if (seen(a, foundA.ranges) && seen(b, foundB.ranges)) { dropped.push({ reason: 'already flagged' }); continue; }
    const flag = {
      id: `cloud:${a}:${b}:${foundA.ranges[0].start}:${foundB.ranges[0].start}`,
      check: 'on-device', // shown as a "maybe" like every AI flag; app.js words it as Gemini in the cloud
      kind: KINDS.includes(c.kind) ? c.kind : 'other',
      title: String(c.title ?? 'These disagree').slice(0, 70),
      detail: `${String(c.why ?? '').slice(0, 240)} Check which is right.`.trim(),
      citations: single ? [{ sectionId: a, quote: foundA.text }] : [{ sectionId: a, quote: foundA.text }, { sectionId: b, quote: foundB.text }],
    };
    kept.push(flag);
    cover(flag);
  }
  return { kept, dropped };
}
