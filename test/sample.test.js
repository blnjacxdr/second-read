// Keeps the fictional sample and its answer key honest: the sample obeys
// Common App's limits (as a real preview PDF would), every expected quote
// really is in the sample, and the planted mistakes are really there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applicationSections, countWords, LIMITS } from '../src/core/sections.js';
import { verifyQuote } from '../src/core/quotes.js';
import { publicNamesPrompt } from '../src/core/prompts.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const sample = readJson('../sample/application.json');
const key = readJson('../sample/expected-flags.json');
const sections = applicationSections(sample);

test('sample is clearly labeled as fictional', () => {
  assert.match(sample.notice, /^SAMPLE\. Fictional applicant/);
  assert.match(sample.personalInfo.email, /@example\.com$/);
});

test('every activity and honor is within Common App character limits', () => {
  assert.ok(sample.activities.length <= 10);
  assert.ok(sample.honors.length <= 5);
  for (const a of sample.activities) {
    assert.ok(a.position.length <= LIMITS.activityPosition, `${a.id} position`);
    assert.ok(a.organization.length <= LIMITS.activityOrganization, `${a.id} organization`);
    assert.ok(a.description.length <= LIMITS.activityDescription, `${a.id} description is ${a.description.length}`);
  }
  for (const h of sample.honors) assert.ok(h.title.length <= LIMITS.honorTitle, `${h.id} title`);
});

test('essays are within their word limits', () => {
  const essayWords = countWords(sample.personalEssay.text);
  assert.ok(essayWords >= 250 && essayWords <= sample.personalEssay.wordLimit, `essay is ${essayWords} words`);
  for (const s of sample.supplements) {
    assert.ok(countWords(s.text) <= s.wordLimit, `${s.id} is ${countWords(s.text)} words`);
  }
});

test('every quote in the answer key verifies against its section', () => {
  for (const flag of key.flags) {
    for (const citation of flag.citations) {
      assert.equal(verifyQuote(sections, citation), true, `${flag.id}: "${citation.quote}" not found in ${citation.sectionId}`);
    }
  }
});

test('each flag only uses sections that exist in the college PDFs it is listed for', () => {
  const shared = (id) => !id.startsWith('supplement-');
  for (const flag of key.flags) {
    for (const college of flag.inPdfs) {
      for (const { sectionId } of flag.citations) {
        assert.ok(shared(sectionId) || sectionId === `supplement-${college}`,
          `${flag.id}: ${sectionId} is not in the ${college} PDF`);
      }
    }
  }
});

test('the controls that must not flag are really in the sample', () => {
  assert.match(sections['supplement-northwestern'], /co-captain/);
  assert.match(sections['supplement-northwestern'], /Northwestern/);
  assert.match(sections['activity-4'], /Saturdays and Sundays/);
  assert.match(sample.personalEssay.text, /neighbor’s/);
});

test('the cloud prompt for the sample carries no essay text', () => {
  const prompt = publicNamesPrompt(sample.publicNames);
  for (const paragraph of sample.personalEssay.text.split('\n\n')) {
    assert.equal(prompt.includes(paragraph.slice(0, 40)), false);
  }
  for (const s of sample.supplements) assert.equal(prompt.includes(s.text.slice(0, 40)), false);
});

test('the paste-in draft really is over the 150-character limit', () => {
  const drafts = readFileSync(new URL('../sample/paste-in-drafts.txt', import.meta.url), 'utf8');
  const description = drafts.match(/^Description: (.+)$/m)[1];
  assert.ok(description.length > LIMITS.activityDescription, `draft is ${description.length}`);
});
