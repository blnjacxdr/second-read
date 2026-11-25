import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wholeReadPrompt, wholeReadFlags, MAX_CONFLICTS } from '../src/core/whole-read.js';

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
