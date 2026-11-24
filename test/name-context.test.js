import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameForms, contextSentences, googleSays, contextPrompt, contextFinding } from '../src/core/name-context.js';

// Made-up application text.
const sections = {
  'activity-4': 'Summer program\nLakeview Ocean Lab (LOL), Research Intern\nSpent six weeks at the LOL station in Duluth studying algae.\n11 (Break)\n40 hr/wk, 6 wk/yr',
  'personal-essay': 'Last summer I joined the Lakeview Ocean Lab in Portland, Maine. It changed how I see water.',
};
const question = { id: 1, kind: 'lookup', name: 'Lakeview Ocean Lab (LOL)', sectionIds: ['activity-4', 'personal-essay'] };

test('a name is found in the student\'s sentences in any of its forms', () => {
  assert.deepEqual(nameForms('Lakeview Ocean Lab (LOL)'), ['Lakeview Ocean Lab (LOL)', 'Lakeview Ocean Lab', 'LOL']);
  const found = contextSentences(question, sections);
  assert.equal(found.length, 2);
  assert.match(found[0].text, /LOL station in Duluth/);
  assert.match(found[1].text, /Portland, Maine/);
});

test('only answers with facts get a context question, and the prompt carries Google\'s words and one sentence', () => {
  assert.equal(googleSays({ verdict: 'unsure', place: 'x' }), null);
  assert.equal(googleSays({ verdict: 'exists' }), null);
  const google = googleSays({ verdict: 'exists', official: 'Lakeview Ocean Lab', place: 'Duluth, Minnesota', fact: 'A summer lab for high school students.' });
  const prompt = contextPrompt('Lakeview Ocean Lab', google, 'Last summer I joined the Lakeview Ocean Lab in Portland, Maine.');
  assert.match(prompt, /Duluth, Minnesota/);
  assert.match(prompt, /Portland, Maine/);
  assert.doesNotMatch(prompt, /algae/); // nothing else from the application
});

test('a finding needs Nano to say no, and its words must really be in the sentence', () => {
  const sentence = contextSentences(question, sections)[1];
  const found = contextFinding({ agrees: 'no', quote: 'Portland, Maine' }, sentence, sections, question.name);
  assert.equal(found.quote, 'Portland, Maine');
  assert.equal(found.sectionId, 'personal-essay');
  assert.equal(contextFinding({ agrees: 'no', quote: 'Seattle' }, sentence, sections, question.name), null);
  assert.equal(contextFinding({ agrees: 'no', quote: 'Lakeview Ocean Lab' }, sentence, sections, question.name), null);
  assert.equal(contextFinding({ agrees: 'yes', quote: '' }, sentence, sections, question.name), null);
  assert.equal(contextFinding({ agrees: 'unclear', quote: 'Portland' }, sentence, sections, question.name), null);
});
