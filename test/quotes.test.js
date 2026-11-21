import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyQuote, keepVerifiedFlags, normalizeForMatch } from '../src/core/quotes.js';

const sections = {
  essay: 'Every day after school, I stayed in the robotics lab until seven.\nI buried twelve of them in my neighbor’s garden — all summer.',
  activity: 'Position: Varsity Co-Captain\nHours per week: 6',
  short: 'Co-Captain',
};

test('an exact quote from its own section verifies', () => {
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: 'I stayed in the robotics lab until seven' }), true);
});

test('a quote that exists only in a different section fails', () => {
  assert.equal(verifyQuote(sections, { sectionId: 'activity', quote: 'I stayed in the robotics lab' }), false);
});

test('a reworded quote fails', () => {
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: 'I stayed at the robotics lab until seven' }), false);
});

test('an unknown section, empty quote or missing quote fails', () => {
  assert.equal(verifyQuote(sections, { sectionId: 'nope', quote: 'Every day after school' }), false);
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: '' }), false);
  assert.equal(verifyQuote(sections, { sectionId: 'essay' }), false);
  assert.equal(verifyQuote(sections, null), false);
});

test('line breaks and extra spaces are forgiven, words are not', () => {
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: 'until seven. I buried   twelve' }), true);
});

test('straight quotes match curly ones, and hyphens match dashes', () => {
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: "in my neighbor's garden - all summer" }), true);
});

test('quotes under three words fail unless they are the whole field', () => {
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: 'robotics lab' }), false);
  assert.equal(verifyQuote(sections, { sectionId: 'short', quote: 'Co-Captain' }), true);
});

test('ellipsis pieces must each match, in order', () => {
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: 'Every day after school … until seven' }), true);
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: 'Every day after school ... until seven' }), true);
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: 'until seven … Every day after school' }), false);
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: 'Every day after school … until midnight' }), false);
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: 'Every day … … until seven' }), false);
});

test('a leading or trailing ellipsis only marks a cut', () => {
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: '… stayed in the robotics lab' }), true);
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: 'stayed in the robotics lab …' }), true);
  assert.equal(verifyQuote(sections, { sectionId: 'essay', quote: '…' }), false);
});

test('normalization never changes letters or digits', () => {
  assert.equal(normalizeForMatch('Hours per week:  6'), 'Hours per week: 6');
  assert.equal(normalizeForMatch('2nd “Place”'), '2nd "Place"');
});

test('keepVerifiedFlags drops a flag if any of its quotes fails', () => {
  const good = { citations: [{ sectionId: 'activity', quote: 'Hours per week: 6' }, { sectionId: 'essay', quote: 'Every day after school' }] };
  const half = { citations: [{ sectionId: 'activity', quote: 'Hours per week: 6' }, { sectionId: 'essay', quote: 'Every single day after school' }] };
  const none = { citations: [] };
  const { kept, dropped } = keepVerifiedFlags(sections, [good, half, none]);
  assert.deepEqual(kept, [good]);
  assert.deepEqual(dropped, [half, none]);
});
