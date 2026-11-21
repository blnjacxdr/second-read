import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertOnDevice, describeOnDeviceStatus, PrivacyError } from '../src/core/privacy.js';
import { readGroundedAnswer } from '../src/core/grounding.js';
import { createSentLog } from '../src/core/sent-log.js';
import { contradictionPrompt, publicNamesPrompt, CONTRADICTION_SCHEMA, CONTRADICTION_KINDS } from '../src/core/prompts.js';

test('assertOnDevice accepts on-device answers only', () => {
  assert.doesNotThrow(() => assertOnDevice({ inferenceSource: 'on_device' }));
  assert.throws(() => assertOnDevice({ inferenceSource: 'in_cloud' }), PrivacyError);
  assert.throws(() => assertOnDevice({}), PrivacyError);
  assert.throws(() => assertOnDevice(undefined), PrivacyError);
});

test('on-device status: only "available" can run, and no state suggests the cloud', () => {
  for (const state of ['available', 'downloadable', 'downloading', 'unavailable', undefined]) {
    const status = describeOnDeviceStatus(state);
    assert.equal(status.canRun, state === 'available');
    assert.doesNotMatch(status.message, /cloud|upload/i);
  }
  assert.match(describeOnDeviceStatus(undefined).message, /code checks only/);
});

test('readGroundedAnswer pulls text, suggestions and de-duplicated sources', () => {
  const response = {
    inferenceSource: 'in_cloud',
    text: () => 'RSI is held at MIT.',
    candidates: [{
      groundingMetadata: {
        searchEntryPoint: { renderedContent: '<div>chips</div>' },
        groundingChunks: [
          { web: { uri: 'https://a.example', title: 'A' } },
          { web: { uri: 'https://a.example', title: 'A again' } },
          { web: { uri: 'https://b.example' } },
          { maps: { uri: 'https://ignored.example' } },
        ],
      },
    }],
  };
  assert.deepEqual(readGroundedAnswer(response), {
    text: 'RSI is held at MIT.',
    grounded: true,
    searchSuggestionsHtml: '<div>chips</div>',
    sources: [{ title: 'A', uri: 'https://a.example' }, { title: 'https://b.example', uri: 'https://b.example' }],
    inferenceSource: 'in_cloud',
  });
});

test('readGroundedAnswer reports an ungrounded answer honestly', () => {
  const answer = readGroundedAnswer({ text: () => 'hi', candidates: [{}] });
  assert.equal(answer.grounded, false);
  assert.equal(answer.searchSuggestionsHtml, null);
  assert.deepEqual(answer.sources, []);
});

test('sent log records full text in order and returns copies', () => {
  const log = createSentLog(() => 'T');
  log.record('names', 'prompt one');
  log.record('names', 'prompt two');
  const entries = log.entries();
  entries[0].text = 'changed';
  assert.deepEqual(log.entries(), [
    { purpose: 'names', text: 'prompt one', at: 'T' },
    { purpose: 'names', text: 'prompt two', at: 'T' },
  ]);
  assert.throws(() => log.record('x', ''));
  log.clear();
  assert.deepEqual(log.entries(), []);
});

test('contradiction prompt contains both texts and forbids rewriting', () => {
  const prompt = contradictionPrompt('ACT TEXT', 'ESSAY TEXT');
  assert.match(prompt, /ACT TEXT/);
  assert.match(prompt, /ESSAY TEXT/);
  assert.match(prompt, /Do not rewrite/);
  // Quotes under 3 words are dropped by verifyQuote, so the prompt must ask for longer ones.
  assert.match(prompt, /at least 3 words/);
  assert.deepEqual(CONTRADICTION_SCHEMA.properties.contradictions.items.properties.kind.enum, CONTRADICTION_KINDS);
});

test('public names prompt contains the names and nothing else of the user\'s', () => {
  const prompt = publicNamesPrompt(['Oregon Museum of Science and Industry']);
  assert.match(prompt, /- Oregon Museum of Science and Industry$/);
  assert.throws(() => publicNamesPrompt([]));
});

test('the no-search prompt does not claim to search and allows UNSURE', () => {
  const prompt = publicNamesPrompt(['FIRST Robotics Competition'], { withSearch: false });
  assert.doesNotMatch(prompt, /Google Search/);
  assert.match(prompt, /UNSURE/);
  assert.match(publicNamesPrompt(['x y z']), /Use Google Search/);
});
