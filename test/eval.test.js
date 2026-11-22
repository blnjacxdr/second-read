// The scorer itself, on made-up text (never the held-out set).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagMatches, scoreApplication, totalScores, toPdfSectionId } from '../src/core/eval.js';

const sections = {
  'activity-1': 'Debate or speech\nNorth Ridge Debate, President\nLed weekly practice.\n10, 11, 12 (School)\n5 hr/wk, 30 wk/yr\nWill continue',
  'personal-essay': 'As vice president of the debate team, I ran practice. Later I joined the band.',
  'college-essay-1': 'I hope to join the debate team at Stanford next fall.',
};
const flag = (id, ...citations) => ({ id, citations: citations.map(([sectionId, quote]) => ({ sectionId, quote })) });

const entry = {
  mistakes: [
    { id: 'm1', kind: 'role', places: [{ sectionId: 'activity-1', quote: 'North Ridge Debate, President' }, { sectionId: 'personal-essay', quote: 'As vice president of the debate team' }] },
    { id: 'm2', kind: 'other-college-name', places: [{ sectionId: 'supplement-main', quote: 'the debate team at Stanford' }] },
  ],
  trickyConsistent: [{ places: [{ sectionId: 'activity-1', quote: '5 hr/wk, 30 wk/yr' }, { sectionId: 'personal-essay', quote: 'I ran practice' }] }],
};

test('the key\'s "supplement-main" is the PDF\'s first college essay', () => {
  assert.equal(toPdfSectionId('supplement-main'), 'college-essay-1');
  assert.equal(toPdfSectionId('activity-3'), 'activity-3');
});

test('a flag matches when it points at the same sections and overlaps a quote', () => {
  const good = flag('f1', ['activity-1', 'North Ridge Debate, President'], ['personal-essay', 'As vice president of the debate team, I ran practice.']);
  assert.equal(flagMatches(good, entry.mistakes[0].places, sections), true);
  const wrongSections = flag('f2', ['activity-1', 'North Ridge Debate, President']);
  assert.equal(flagMatches(wrongSections, entry.mistakes[0].places, sections), false);
  const noOverlap = flag('f3', ['activity-1', 'Led weekly practice.'], ['personal-essay', 'Later I joined the band.']);
  assert.equal(flagMatches(noOverlap, entry.mistakes[0].places, sections), false);
});

test('scoring counts catches, false alarms and tricky cases', () => {
  const flags = [
    flag('f1', ['activity-1', 'North Ridge Debate, President'], ['personal-essay', 'As vice president of the debate team']),
    flag('f2', ['activity-1', '5 hr/wk, 30 wk/yr'], ['personal-essay', 'As vice president of the debate team, I ran practice.']), // tricky: counted once, not as a false alarm
    flag('f3', ['personal-essay', 'Later I joined the band.']),
  ];
  const score = scoreApplication(flags, entry, sections);
  assert.deepEqual(
    { planted: score.planted, caught: score.caught, falseAlarms: score.falseAlarms, trickyTriggered: score.trickyTriggered, keyQuotesMissing: score.keyQuotesMissing },
    { planted: 2, caught: 1, falseAlarms: 1, trickyTriggered: 1, keyQuotesMissing: 0 },
  );
  assert.deepEqual(score.byKind, { role: { planted: 1, caught: 1 }, 'other-college-name': { planted: 1, caught: 0 } });
});

test('a key quote missing from the PDF is counted, so a broken key is noticed', () => {
  const broken = { mistakes: [{ id: 'm', kind: 'x', places: [{ sectionId: 'personal-essay', quote: 'words that are not there' }] }] };
  assert.equal(scoreApplication([], broken, sections).keyQuotesMissing, 1);
});

test('totals add up across applications', () => {
  const a = { planted: 2, caught: 1, falseAlarms: 1, trickyTriggered: 0, keyQuotesMissing: 0, byKind: { role: { planted: 1, caught: 1 } } };
  const b = { planted: 1, caught: 0, falseAlarms: 2, trickyTriggered: 1, keyQuotesMissing: 0, byKind: { role: { planted: 1, caught: 0 } } };
  assert.deepEqual(totalScores([a, b]), { planted: 3, caught: 1, falseAlarms: 3, trickyTriggered: 1, keyQuotesMissing: 0, byKind: { role: { planted: 2, caught: 1 } }, falseAlarmKinds: {} });
});
