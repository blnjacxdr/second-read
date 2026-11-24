// Tests for re-checking after fixes (src/core/recheck.js). Made-up cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareChecks, carriedDecisions, recheckSummary } from '../src/core/recheck.js';

const card = (id, kind, ...quotes) => ({ id, kind, quotes: quotes.map(([where, text]) => ({ where, text })) });
const year = card('p1', 'start-year', ['Activity 3', 'Founded club in 2024.'], ['Tufts essay', 'Since I started the club in 2023']);
const title = card('p2', 'title', ['Activity 1', 'Co-Captain'], ['Personal essay', 'As captain of the team']);
const other = card('p3', 'other-college-name', ['Tufts essay', 'I hope to find at Brown.']);

test('a problem that is gone counts as fixed; an identical one is still there', () => {
  const now = [card('n1', 'title', ['Activity 1', 'Co-Captain'], ['Personal essay', 'As captain of the team'])];
  const out = compareChecks([year, title], now);
  assert.deepEqual(out.fixed.map((c) => c.id), ['p1']);
  assert.deepEqual(out.still.map((s) => [s.card.id, s.was.id, s.changed]), [['n1', 'p2', false]]);
  assert.deepEqual(out.fresh, []);
});

test('the same problem with new wording is still there (changed), not "fixed plus new"', () => {
  const now = [card('n1', 'start-year', ['Activity 3', 'Founded the club in 2024.'], ['Tufts essay', 'Since we began in 2023'])];
  const out = compareChecks([year], now);
  assert.equal(out.fixed.length, 0);
  assert.deepEqual(out.still.map((s) => s.changed), [true]);
});

test('punctuation and capitals do not make a problem look new', () => {
  const now = [card('n1', 'other-college-name', ['Tufts essay', 'i hope to find at brown'])];
  assert.equal(compareChecks([other], now).still[0].changed, false);
});

test('something that was not there before is new', () => {
  const out = compareChecks([title], [title, other]);
  assert.deepEqual(out.fresh.map((c) => c.id), ['p3']);
});

test('only "On purpose" carries over; the check itself decides what is fixed', () => {
  const now = [{ ...title, id: 'n1' }, { ...year, id: 'n2' }];
  const comparison = compareChecks([title, year], now);
  const carried = carriedDecisions(comparison, new Map([['p2', 'kept'], ['p1', 'fixed']]));
  assert.deepEqual([...carried], [['n1', 'kept']]);
});

test('the summary line, and the all-fixed moment', () => {
  assert.equal(recheckSummary(compareChecks([year, title], [{ ...title, id: 'n' }])).line, 'Since the last check: 1 fixed, 1 still there, 0 new.');
  assert.equal(recheckSummary(compareChecks([year, title], [])).allFixed, true);
  assert.equal(recheckSummary(compareChecks([], [])).allFixed, false);
});
