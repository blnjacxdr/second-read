// The whole-application read (Nov 25). Only in the cloud, only after the user's yes (src/core/consent.js).
//
// Gemini Nano is too small to read a whole application at once, so on the device Second Read asks narrow questions
// and code compares the answers. A cloud model can read everything together, so after a yes it is also asked to list
// every pair of places that state the same fact differently. Like every AI flag, both quotes must be in the
// application word for word (locateQuote), in two different sections, or the conflict is dropped.

import { locateQuote } from './quotes.js';

export const MAX_CONFLICTS = 8;
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

/** Every section, labeled with its id, in a stable order: activities, honors, essays. */
export function wholeReadPrompt(app) {
  const ids = [...app.activityIds, ...(app.honorIds ?? []), ...app.essayIds].filter((id) => app.sections[id]);
  return [
    'Below is one student\'s college application, split into labeled sections.',
    'Find every place where two DIFFERENT sections state the same fact differently: hours or weeks, a role or title,',
    'an award or placing, a year or grade, a count or amount, a place, an organization name, or the name of the college.',
    'Do not report: things that can both be true (a role that changed over time, a club that grew), differences in',
    'wording or tone, opinions, or anything only one section mentions.',
    `List at most ${MAX_CONFLICTS}, most important first. For each, copy the exact words from each section into quoteA`,
    'and quoteB (3 to 25 words, copied character for character), name the sections by their ids, give a short title',
    '(under 8 words) and say in one sentence why they disagree. If nothing disagrees, return an empty list.',
    '',
    ...ids.map((id) => `[${id}]\n${app.sections[id]}\n`),
  ].join('\n');
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
    if (a === b) { dropped.push({ reason: 'same section twice' }); continue; }
    const foundA = locateQuote(sections, { sectionId: a, quote: String(c.quoteA ?? '') });
    const foundB = locateQuote(sections, { sectionId: b, quote: String(c.quoteB ?? '') });
    if (!foundA || !foundB) { dropped.push({ reason: 'quote not found in the application' }); continue; }
    const seen = (sid, ranges) => covered.some((x) => x.sectionId === sid && overlapsAny(ranges, x.ranges));
    if (seen(a, foundA.ranges) && seen(b, foundB.ranges)) { dropped.push({ reason: 'already flagged' }); continue; }
    const flag = {
      id: `cloud:${a}:${b}:${foundA.ranges[0].start}:${foundB.ranges[0].start}`,
      check: 'on-device', // shown as a "maybe" like every AI flag; app.js words it as Gemini in the cloud
      kind: KINDS.includes(c.kind) ? c.kind : 'other',
      title: String(c.title ?? 'These disagree').slice(0, 70),
      detail: `${String(c.why ?? '').slice(0, 240)} Check which is right.`.trim(),
      citations: [{ sectionId: a, quote: foundA.text }, { sectionId: b, quote: foundB.text }],
    };
    kept.push(flag);
    cover(flag);
  }
  return { kept, dropped };
}
