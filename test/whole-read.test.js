import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wholeReadPrompt, wholeReadFlags, MAX_CONFLICTS, verifyPrompt, applyVerdicts } from '../src/core/whole-read.js';

// Made-up application text.
const sections = {
  'activity-1': 'Community service\nHarbor Food Pantry, Shift Lead\nRun Saturday shifts and train new volunteers.\n10, 11, 12 (School)\n4 hr/wk, 40 wk/yr',
  'honor-1': 'County Youth Service Award\nState/Regional\n11',
  'personal-essay': 'Every Saturday at the Harbor Food Pantry I spent eight hours sorting cans as a shift lead. I joined in ninth grade.',
};
const app = { sections, activityIds: ['activity-1'], honorIds: ['honor-1'], essayIds: ['personal-essay'] };

test('the prompt labels every section and asks for exact quotes', () => {
  const p = wholeReadPrompt(app);
  for (const id of Object.keys(sections)) assert.match(p, new RegExp(`\\[${id}\\]`));
  assert.match(p, /character for character/);
});

test('conflicts become flags only when both quotes are really there, in two sections', () => {
  const { kept, dropped } = wholeReadFlags({
    conflicts: [
      { kind: 'hours', title: 'Hours differ', sectionA: 'activity-1', quoteA: '4 hr/wk, 40 wk/yr', sectionB: 'personal-essay', quoteB: 'I spent eight hours sorting cans', why: 'Four hours vs eight.' },
      { kind: 'dates', title: 'Start differs', sectionA: 'activity-1', quoteA: '10, 11, 12 (School)', sectionB: 'personal-essay', quoteB: 'I joined in tenth grade.', why: 'made up' },
      { kind: 'role', title: 'Same section', sectionA: 'personal-essay', quoteA: 'sorting cans as a shift lead', sectionB: 'personal-essay', quoteB: 'I joined in ninth grade.', why: 'x' },
      { kind: 'role', title: 'Unknown', sectionA: 'activity-9', quoteA: 'x y z', sectionB: 'personal-essay', quoteB: 'I joined in ninth grade.', why: 'x' },
    ],
  }, sections);
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].citations.map((c) => c.sectionId), ['activity-1', 'personal-essay']);
  assert.match(kept[0].detail, /Four hours vs eight\. Check which is right\./);
  assert.deepEqual(dropped.map((d) => d.reason), ['quote not found in the application', 'same section twice', 'unknown section']);
});

test('a place already flagged is not flagged again, and the list is capped', () => {
  const existing = [{ citations: [{ sectionId: 'activity-1', quote: '4 hr/wk, 40 wk/yr' }, { sectionId: 'personal-essay', quote: 'I spent eight hours sorting cans as a shift lead.' }] }];
  const one = { kind: 'hours', title: 'Hours differ', sectionA: 'activity-1', quoteA: '4 hr/wk, 40 wk/yr', sectionB: 'personal-essay', quoteB: 'I spent eight hours sorting cans', why: 'x' };
  assert.equal(wholeReadFlags({ conflicts: [one] }, sections, existing).kept.length, 0);
  assert.equal(wholeReadFlags({ conflicts: Array(MAX_CONFLICTS + 5).fill(one) }, sections).kept.length, 1); // duplicates collapse too
});

test('data first puts the application before the instructions; the original puts it after', () => {
  const dataFirst = wholeReadPrompt(app);
  assert.ok(dataFirst.indexOf('[activity-1]') < dataFirst.indexOf('Find every place'));
  const original = wholeReadPrompt(app, { layout: 'instructions-first' });
  assert.ok(original.indexOf('Find every place') < original.indexOf('[activity-1]'));
});

test('a second look lists what was already found', () => {
  const found = [{ citations: [{ sectionId: 'activity-1', quote: '4 hr/wk, 40 wk/yr' }, { sectionId: 'personal-essay', quote: 'I spent eight hours sorting cans' }] }];
  const p = wholeReadPrompt(app, { alreadyFound: found });
  assert.match(p, /already found/);
  assert.match(p, /\[activity-1\] "4 hr\/wk, 40 wk\/yr" vs \[personal-essay\] "I spent eight hours sorting cans"/);
});

test('the check step numbers every flag and keeps only the conflicts', () => {
  const flags = ['a', 'b', 'c', 'd'].map((t) => ({ title: t, citations: [{ sectionId: 'activity-1', quote: 'Shift Lead' }, { sectionId: 'personal-essay', quote: 'as a shift lead' }] }));
  const p = verifyPrompt(app, flags);
  assert.match(p, /^4\. /m);
  const answer = { verdicts: [{ n: 1, verdict: 'conflict' }, { n: 2, verdict: 'consistent' }, { n: 3, verdict: 'unsure' }] };
  assert.deepEqual(applyVerdicts(flags, answer).map((f) => f.title), ['a', 'd']); // d had no verdict, so it stays
  assert.deepEqual(applyVerdicts(flags, answer, { keepUnsure: true }).map((f) => f.title), ['a', 'c', 'd']);
  assert.deepEqual(applyVerdicts(flags, null).map((f) => f.title), ['a', 'b', 'c', 'd']);
});
