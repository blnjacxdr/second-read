// Tests for the results screen's words (src/core/present.js). Made-up result data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOf, presentFlags, headlineFor, receiptFor } from '../src/core/present.js';

const result = {
  college: 'Tufts University',
  activities: [{ id: 'activity-1', category: 'Music' }, { id: 'activity-2', category: 'Robotics' }],
  honors: [{ id: 'honor-1' }],
  collegeEssays: [{ id: 'college-essay-1', group: 'Writing Questions' }],
};

test('each section gets the name a student sees and where to fix it in Common App', () => {
  assert.deepEqual(placeOf(result, 'activity-2'), { where: 'Activity 2: Robotics', fix: 'Activities, item 2' });
  assert.deepEqual(placeOf(result, 'honor-1'), { where: 'Honor 1', fix: 'Honors, item 1' });
  assert.deepEqual(placeOf(result, 'college-essay-1'), { where: 'Tufts University essay (Writing Questions)', fix: 'My Colleges, Tufts University, Questions' });
  assert.deepEqual(placeOf(result, 'personal-essay'), { where: 'Personal essay', fix: 'Writing, Personal essay' });
  assert.deepEqual(placeOf(result, 'mystery'), { where: 'mystery', fix: null });
});

const flag = (id, check, citations, extra = {}) => ({ id, check, kind: 'x', title: `T ${id}`, detail: `D ${id}`, citations, ...extra });

test('sure flags (code) come first, maybes (Gemini Nano) after, background mentions apart', () => {
  const out = presentFlags({
    result,
    codeFlags: [flag('c1', 'code', [{ sectionId: 'activity-1', quote: 'Lead cellist' }, { sectionId: 'personal-essay', quote: 'I play viola' }])],
    aiFlags: [flag('a1', 'on-device', [{ sectionId: 'activity-2', quote: '6 hr/wk' }])],
  });
  assert.deepEqual(out.sure.map((c) => c.id), ['c1']);
  assert.deepEqual(out.maybes.map((c) => c.id), ['a1']);
  assert.equal(out.sure[0].tone, 'pen');
  assert.equal(out.maybes[0].tone, 'pencil');
  assert.deepEqual(out.sure[0].quotes, [{ where: 'Activity 1: Music', text: 'Lead cellist' }, { where: 'Personal essay', text: 'I play viola' }]);
  assert.deepEqual(out.sure[0].fixIn, ['Activities, item 1', 'Writing, Personal essay']);
});

test('another college\'s name that reads as background goes in its own group', () => {
  const other = flag('o1', 'code', [{ sectionId: 'college-essay-1', quote: 'my cousin went to Brown' }], { kind: 'other-college-name' });
  const out = presentFlags({ result, codeFlags: [other], mentionAnswers: new Map([['o1', false]]) });
  assert.equal(out.sure.length, 0);
  assert.deepEqual(out.background.map((c) => c.id), ['o1']);
});

test('the headline follows what the student has decided', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(headlineFor({ sure: 2, maybes: 1 }, new Map(), ids).headline, '3 spots to look at.');
  assert.equal(headlineFor({ sure: 2, maybes: 1 }, new Map(), ids).subhead, '2 sure ones from the code checks, and 1 maybe from Gemini Nano.');
  assert.equal(headlineFor({ sure: 2, maybes: 1 }, new Map([['a', 'fixed']]), ids).headline, '2 spots to look at.');
  assert.equal(headlineFor({ sure: 2, maybes: 1 }, new Map([['a', 'fixed'], ['b', 'kept'], ['c', 'fixed']]), ids).state, 'done');
  assert.equal(headlineFor({ sure: 2, maybes: 1 }, new Map([['a', 'kept'], ['b', 'kept'], ['c', 'kept']]), ids).headline, 'All 3 on purpose.');
  assert.equal(headlineFor({ sure: 1, maybes: 0 }, new Map(), ['a']).headline, '1 spot to look at.');
});

test('a clean application, and an honest note when Gemini Nano did not run', () => {
  const clean = headlineFor({ sure: 0, maybes: 0 }, new Map(), []);
  assert.equal(clean.headline, 'No arguments here.');
  assert.equal(clean.state, 'clean');
  assert.match(headlineFor({ sure: 0, maybes: 0 }, new Map(), [], { nano: 'skipped' }).subhead, /only the code checks ran/);
  // Skipping it yourself is not the same as not having it.
  assert.match(headlineFor({ sure: 1, maybes: 0 }, new Map(), ['a'], { nano: 'skipped-by-you' }).subhead, /You skipped Gemini Nano/);
  assert.match(headlineFor({ sure: 1, maybes: 0 }, new Map(), ['a'], { nano: 'failed' }).subhead, /stopped partway/);
});

test('the receipt lists what happened, ending with what was sent', () => {
  const rows = receiptFor({ pageCount: 4, codeChecks: 6, nanoQuestions: 12, tossed: 2, sentCount: 0 });
  assert.deepEqual(rows.at(-1), ['sent to the internet', 0]);
  assert.equal(rows.length, 5);
  const without = receiptFor({ pageCount: 4, codeChecks: 6, nano: 'skipped', sentCount: 0 });
  assert.deepEqual(without.map((r) => r[0]), ['pages read', 'code checks', 'gemini nano', 'sent to the internet']);
  assert.equal(without[2][1], 'not here');
  assert.equal(receiptFor({ pageCount: 4, codeChecks: 6, nano: 'skipped-by-you' })[2][1], 'skipped');
});

test('the sticky note speaks to students about Gemini Nano, and never promises a cloud fallback', async () => {
  const { nanoNote } = await import('../src/core/present.js');
  assert.equal(nanoNote('available').ready, true);
  for (const a of ['downloadable', 'downloading', 'unavailable', undefined]) {
    const n = nanoNote(a);
    assert.equal(n.ready, false);
    assert.match(n.body, /code checks/);
    assert.doesNotMatch(n.body, /Click|Prepare/);
  }
});
