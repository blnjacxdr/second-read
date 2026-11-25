import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_COPY, withJsonShape, parseModelJson } from '../src/core/consent.js';

test('the consent question says what is sent, where, and that it is optional', () => {
  assert.match(CONSENT_COPY.question, /Gemini Nano isn't on this laptop/);
  assert.match(CONSENT_COPY.what, /essays, activities and honors/);
  assert.match(CONSENT_COPY.what, /What was sent/);
  assert.match(CONSENT_COPY.no, /Code checks only/);
});

test('the cloud prompt is the same question plus the answer shape', () => {
  const schema = { type: 'object', properties: { hoursPerWeek: { type: 'number' } } };
  const p = withJsonShape('What hours does this paragraph state?', schema);
  assert.ok(p.startsWith('What hours does this paragraph state?'));
  assert.match(p, /"hoursPerWeek"/);
});

test('model JSON is read with or without a code fence, and nonsense is refused', () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseModelJson('Here you go: {"a":3} thanks'), { a: 3 });
  assert.throws(() => parseModelJson('no json here'));
});
