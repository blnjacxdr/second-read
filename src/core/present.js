// What the results screen says. Pure functions: they turn the reader's result and the flags into plain
// view data (titles, the two quotes with where each came from, where to fix it in Common App, the
// headline). src/app.js only draws what these return.
//
// Pen and pencil: code-check flags are "pen" (sure). Gemini Nano's flags are "pencil" (a maybe, double-check).
// Pen flags come first; pencil flags are grouped after them so a wrong maybe never hides a sure one.

import { orderWithMentionAnswers } from './ai-checks.js';

/** Where a quote came from, in the words a student sees on their PDF. */
export function placeOf(result, sectionId) {
  const n = sectionId.split('-').pop();
  const activity = result.activities.find((a) => a.id === sectionId);
  if (activity) return { where: `Activity ${n}${activity.category ? `: ${activity.category}` : ''}`, fix: `Activities, item ${n}` };
  if (result.honors.some((h) => h.id === sectionId)) return { where: `Honor ${n}`, fix: `Honors, item ${n}` };
  const essay = result.collegeEssays.find((e) => e.id === sectionId);
  if (essay) {
    const college = result.college ?? 'this college';
    return { where: `${college} essay${essay.group ? ` (${essay.group})` : ''}`, fix: `My Colleges, ${college}, Questions` };
  }
  if (sectionId === 'personal-essay') return { where: 'Personal essay', fix: 'Writing, Personal essay' };
  if (sectionId === 'additional-information') return { where: 'Additional information', fix: 'Writing, Additional information' };
  return { where: sectionId, fix: null };
}

/**
 * Turns flags into cards for the screen.
 * @returns {{ sure: object[], maybes: object[], background: object[] }}
 *   each card: { id, tone: 'pen'|'pencil', title, detail, quotes: [{ where, text }], fixIn: string[] }
 */
export function presentFlags({ result, codeFlags = [], aiFlags = [], mentionAnswers = new Map() }) {
  const ordered = orderWithMentionAnswers([...codeFlags, ...aiFlags], mentionAnswers);
  const card = (flag) => {
    const places = flag.citations.map((c) => placeOf(result, c.sectionId));
    return {
      id: flag.id,
      kind: flag.kind,
      tone: flag.check === 'on-device' ? 'pencil' : 'pen',
      title: flag.title,
      detail: flag.detail,
      quotes: flag.citations.map((c, i) => ({ where: places[i].where, text: c.quote })),
      fixIn: [...new Set(places.map((p) => p.fix).filter(Boolean))],
    };
  };
  const cards = ordered.map((f) => ({ flag: f, card: card(f) }));
  return {
    sure: cards.filter(({ flag, card: c }) => c.tone === 'pen' && flag.mention !== 'background').map(({ card: c }) => c),
    maybes: cards.filter(({ flag, card: c }) => c.tone === 'pencil' && flag.mention !== 'background').map(({ card: c }) => c),
    background: cards.filter(({ flag }) => flag.mention === 'background').map(({ card: c }) => c),
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The big line at the top of the results, and the line under it.
 * @param {{ sure: number, maybes: number }} counts
 * @param {Map<string, 'fixed'|'kept'>} decisions  what the student chose per card
 * @param {string[]} ids  every card id shown (sure and maybes)
 * @param {{ nano: 'ran'|'skipped'|'failed' }} options
 */
export function headlineFor(counts, decisions, ids, { nano = 'ran' } = {}) {
  const total = counts.sure + counts.maybes;
  const nanoNote = {
    skipped: ' Gemini Nano isn\'t on this computer, so only the code checks ran.',
    'skipped-by-you': ' You skipped the Gemini step, so only the code checks ran.',
    cloud: ' Gemini read the essays in Google\'s cloud, as you chose.',
    failed: ' Gemini Nano stopped partway, so some AI checks didn\'t run.',
  }[nano] ?? '';
  if (total === 0) {
    return { headline: 'No arguments here.', subhead: `Every place we compared agrees with itself.${nanoNote}`, state: 'clean' };
  }
  const left = ids.filter((id) => !decisions.has(id)).length;
  const kept = ids.filter((id) => decisions.get(id) === 'kept').length;
  if (left === 0 && kept === total) {
    return { headline: `All ${total} on purpose.`, subhead: 'The student\'s call, every time. Nothing left to look at.', state: 'all-kept' };
  }
  if (left === 0) {
    return { headline: 'Every spot handled.', subhead: 'Download the PDF again from Common App to check the new version.', state: 'done' };
  }
  const parts = [];
  if (counts.sure) parts.push(`${plural(counts.sure, 'sure one', 'sure ones')} from the code checks`);
  if (counts.maybes) parts.push(`${plural(counts.maybes, 'maybe', 'maybes')} from Gemini${nano === 'cloud' ? '' : ' Nano'}`);
  return {
    headline: `${plural(left, 'spot', 'spots')} to look at.`,
    subhead: `${parts.join(', and ')}.${nanoNote}`,
    state: 'open',
  };
}

/** The receipt's numbers. "Sent to the internet" counts only what the sent log recorded. */
export function receiptFor({ pageCount, codeChecks, nano = 'ran', nanoQuestions = 0, tossed = 0, sentCount = 0, closer }) {
  // Rows that would only ever say 0 because Gemini Nano never ran say why instead.
  const nanoRows = nano === 'ran'
    ? [['nano questions', nanoQuestions], ['nano answers tossed', tossed]]
    : nano === 'cloud'
      ? [['cloud questions (your yes)', nanoQuestions], ['cloud answers tossed', tossed]]
    : [['gemini nano', { 'skipped-by-you': 'skipped', failed: 'stopped' }[nano] ?? 'not here']];
  return [
    ['pages read', pageCount],
    ['code checks', codeChecks],
    ...nanoRows,
    ...(closer === undefined ? [] : [['closer read (your yes)', `${closer} new`]]),
    ['sent to the internet', sentCount],
  ];
}

/** The sticky note on the start page, from Chrome's Gemini Nano availability. Words for students, not developers. */
export function nanoNote(availability) {
  const without = 'Without it, Second Read asks before using Gemini in Google\'s cloud instead. Say no and the code checks still run.';
  switch (availability) {
    case 'available':
      return { ready: true, title: 'Gemini Nano is ready', body: 'It\'s the AI built into Chrome, and it runs right here on this laptop. It reads what the essays mean, so it catches mismatches code alone can\'t.' };
    case 'downloading':
      return { ready: false, title: 'Gemini Nano is downloading', body: `Chrome is getting it now. It reads hours, titles and awards on this laptop, so it catches more. ${without}` };
    case 'downloadable':
      return { ready: false, canDownload: true, title: 'Gemini Nano catches more', body: `It reads hours, titles and awards in the essays, right on this laptop. Chrome downloads it once. ${without}` };
    default:
      return { ready: false, title: 'No Gemini Nano in this browser', body: `In Chrome on a laptop, Gemini Nano reads the essays right on the device. ${without}` };
  }
}
