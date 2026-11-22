// The claim design: Nano's verdicts are faked; code decides what's kept.
// Made-up text only (never the held-out set).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimsFor, flagsFromClaims } from '../src/core/claim-checks.js';
import { claimPrompt } from '../src/core/prompts.js';

const activity = 'Athletics: JV/Varsity\nLakeview Swim Club, Captain\nLed warmups and coached new swimmers.\n10, 11, 12 (School)\n6 hr/wk, 40 wk/yr';
const honor = 'Regional Science Fair, 2nd Place\nRegional\n11';
const none = { hoursVerdict: 'not stated', hoursQuote: '', roleVerdict: 'not stated', roleQuote: '', placeVerdict: 'not stated', placeQuote: '' };

function run(passage, verdicts, itemId = 'activity-1', itemText = activity) {
  const sections = { [itemId]: itemText, 'personal-essay': passage };
  return flagsFromClaims({ itemId, essayId: 'personal-essay', itemText, passage }, { ...none, ...verdicts }, sections);
}

test('code writes plain claims from the activity list', () => {
  const claims = claimsFor('activity-1', activity);
  assert.equal(claims.hours, 'The student spends about 6 hours per week on Lakeview Swim Club.');
  assert.equal(claims.role, 'The student\'s title in Lakeview Swim Club is Captain.');
  assert.equal(claims.place, '');
  assert.equal(claimsFor('honor-1', honor).place, 'The student received this honor: Regional Science Fair, 2nd Place.');
  const prompt = claimPrompt(claims, 'THE REAL PARAGRAPH');
  assert.ok(prompt.includes('PLACE CLAIM: (none)') && prompt.trimEnd().endsWith('THE REAL PARAGRAPH'));
});

test('a "disagree" with a real quote about hours becomes a flag with both quotes', () => {
  const out = run('I swam twenty hours every week that season.', { hoursVerdict: 'disagree', hoursQuote: 'twenty hours every week' });
  assert.equal(out.kept.length, 1);
  assert.deepEqual(out.kept[0].citations.map((c) => c.quote), ['6 hr/wk, 40 wk/yr', 'twenty hours every week']);
});

test('"agree" and "not stated" never flag', () => {
  const out = run('I swam twenty hours every week that season.', { hoursVerdict: 'agree', hoursQuote: 'twenty hours every week' });
  assert.equal(out.kept.length, 0);
});

test('a "disagree" is dropped when the quote is invented or doesn\'t state that kind of fact', () => {
  assert.equal(run('I loved the water.', { hoursVerdict: 'disagree', hoursQuote: 'twenty hours every week' }).kept.length, 0);
  // A year is not time per week.
  assert.equal(run('I joined the club in 2023 with my sister.', { hoursVerdict: 'disagree', hoursQuote: 'joined the club in 2023' }).kept.length, 0);
  // Same title, or a title that changed over time, is not a disagreement.
  assert.equal(run('As the team captain, I led warmups.', { roleVerdict: 'disagree', roleQuote: 'As the team captain' }).kept.length, 0);
  assert.equal(run('I was a member first, and I became captain junior year.', { roleVerdict: 'disagree', roleQuote: 'I was a member first' }).kept.length, 0);
  assert.equal(run('As team manager, I kept the split times.', { roleVerdict: 'disagree', roleQuote: 'As team manager' }).kept.length, 1);
});

test('a placing disagreement is checked against the student\'s own words', () => {
  assert.equal(run('At regionals we took first place overall.', { placeVerdict: 'disagree', placeQuote: 'we took first place' }, 'honor-1', honor).kept.length, 1);
  assert.equal(run('At regionals we took second place overall.', { placeVerdict: 'disagree', placeQuote: 'we took second place' }, 'honor-1', honor).kept.length, 0);
});
