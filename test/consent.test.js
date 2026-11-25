import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_COPY, withJsonShape, parseModelJson, readingChoices } from '../src/core/consent.js';

test('the consent text says what is sent and where it is listed', () => {
  assert.match(CONSENT_COPY.what, /essays, activities and honors/);
  assert.match(CONSENT_COPY.what, /What was sent/);
});

test('the reading picker starts on the private choice, never the cloud', () => {
  assert.equal(readingChoices('available').picked, 'nano');
  for (const a of ['unavailable', 'downloadable', 'downloading', undefined]) {
    assert.equal(readingChoices(a).picked, 'code', a);
    assert.equal(readingChoices(a).nano.enabled, false, a);
    assert.ok(readingChoices(a).nano.why.length > 0, 'a greyed-out Nano says why');
  }
  assert.equal(readingChoices('available').nano.why, '');
});

test('the reading picker keeps an earlier pick only while it is still possible', () => {
  assert.equal(readingChoices('available', 'cloud').picked, 'cloud');
  assert.equal(readingChoices('unavailable', 'cloud').picked, 'cloud');
  assert.equal(readingChoices('available', 'code').picked, 'code');
  assert.equal(readingChoices('unavailable', 'nano').picked, 'code', 'Nano went away: back to the private default');
  assert.equal(readingChoices('available', 'something else').picked, 'nano');
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
