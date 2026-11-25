// Tests for where the margin marks go (src/core/marks.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMarks, MARK_SHAPES } from '../src/core/marks.js';

test('marks run down the whole page, alternating sides, inside the margins', () => {
  const marks = planMarks(4000);
  assert.ok(marks.length >= 8, `a tall page gets marks all the way down (${marks.length})`);
  assert.ok(marks.at(-1).top > 3000, 'the last mark is near the bottom, not just the top');
  marks.forEach((m, i) => {
    assert.equal(m.side, i % 2 === 0 ? 'left' : 'right');
    assert.ok(m.offset >= 40 && m.offset <= 150);
    assert.ok(MARK_SHAPES.includes(m.shape));
    assert.ok(Math.abs(m.tilt) <= 8);
    if (i) assert.ok(m.top - marks[i - 1].top >= 250, 'never crowded together');
  });
});

test('the same height always gives the same marks, and a short page gets few or none', () => {
  assert.deepEqual(planMarks(2500), planMarks(2500));
  assert.deepEqual(planMarks(0), []);
  assert.deepEqual(planMarks(Number.NaN), []);
  assert.ok(planMarks(700).length <= 2);
});

test('every kind of mark shows up on a long page', () => {
  const shapes = new Set(planMarks(9000).map((m) => m.shape));
  assert.equal(shapes.size, MARK_SHAPES.length);
});
