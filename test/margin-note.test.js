import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marginNote, nearDeadline } from '../src/core/margin-note.js';

test('an ordinary afternoon keeps the usual note', () => {
  assert.equal(marginNote(new Date(2026, 2, 10, 15, 0)), null);
});

test('very late at night, the note tells the time and suggests sleep', () => {
  assert.equal(marginNote(new Date(2026, 2, 10, 1, 12)), "it's 1:12 am. your essay will still be here after some sleep.");
  assert.equal(marginNote(new Date(2026, 2, 10, 0, 5)), "it's 12:05 am. your essay will still be here after some sleep.");
  assert.equal(marginNote(new Date(2026, 2, 10, 5, 0)), null);
});

test('the days before a deadline count down, across the new year too', () => {
  assert.deepEqual(nearDeadline(new Date(2026, 9, 29, 14)), { days: 3, name: 'Nov 1' });
  assert.equal(marginNote(new Date(2026, 9, 31, 14)), "1 day until Nov 1. you've got this.");
  assert.equal(marginNote(new Date(2026, 11, 30, 14)), "2 days until Jan 1. you've got this.");
  assert.equal(marginNote(new Date(2027, 0, 1, 14)), "it's Jan 1. breathe. one more read, then submit.");
  assert.equal(nearDeadline(new Date(2026, 9, 20)), null);
});
