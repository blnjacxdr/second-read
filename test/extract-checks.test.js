// The extraction design: Nano's narrow answers are faked; code does the comparing.
// Made-up text only (never the held-out set).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemFacts, placeOf, titleOf, flagsFromFacts } from '../src/core/extract-checks.js';
import { factsPrompt } from '../src/core/prompts.js';

const activity = 'Athletics: JV/Varsity\nLakeview Swim Club, Captain\nLed warmups and coached new swimmers.\n10, 11, 12 (School)\n6 hr/wk, 40 wk/yr';
const honor = 'Regional Science Fair, 2nd Place\nRegional\n11';

function pairWith(passage, itemId = 'activity-1', itemText = activity) {
  const sections = { [itemId]: itemText, 'personal-essay': passage };
  return { pair: { itemId, essayId: 'personal-essay', itemText, passage }, sections };
}
const answer = (fields) => ({ aboutThisActivity: true, hoursQuote: '', hoursPerWeek: 0, roleQuote: '', role: '', placeQuote: '', ...fields });

test('code reads the activity\'s own facts; Nano is only told the organization', () => {
  const facts = itemFacts('activity-1', activity);
  assert.equal(facts.name, 'Lakeview Swim Club');
  assert.equal(facts.position, 'Captain');
  assert.equal(facts.hoursPerWeek, 6);
  const prompt = factsPrompt(facts.name, 'A paragraph.');
  assert.ok(!prompt.includes('Captain') && !prompt.includes('6 hr/wk'));
});

test('placings and titles are read the same way from both sides', () => {
  assert.equal(placeOf('Regional Science Fair, 2nd Place'), 2);
  assert.equal(placeOf('we took second place at regionals'), 2);
  assert.equal(placeOf('I won first in my division'), 1);
  assert.equal(placeOf('we were named grand prize winner'), 1);
  assert.equal(placeOf('I presented my project'), null);
  assert.equal(titleOf('as vice president of the club'), 'vice president');
  assert.equal(titleOf('Lakeview Swim Club, Captain'), 'captain');
  assert.equal(titleOf('as co-captain that year'), 'co-captain');
});

test('hours far apart are flagged with both quotes; close estimates are not', () => {
  const { pair, sections } = pairWith('I swam twenty hours every week that season.');
  const far = flagsFromFacts(pair, answer({ hoursQuote: 'twenty hours every week', hoursPerWeek: 20 }), sections);
  assert.equal(far.kept.length, 1);
  assert.deepEqual(far.kept[0].citations.map((c) => c.quote), ['6 hr/wk, 40 wk/yr', 'twenty hours every week']);
  const close = flagsFromFacts(pair, answer({ hoursQuote: 'twenty hours every week', hoursPerWeek: 8 }), sections);
  assert.equal(close.kept.length, 0);
});

test('an invented quote never becomes a flag', () => {
  const { pair, sections } = pairWith('I swam a lot that season.');
  const out = flagsFromFacts(pair, answer({ hoursQuote: 'twenty hours every week', hoursPerWeek: 20 }), sections);
  assert.equal(out.kept.length, 0);
  assert.match(out.dropped[0].reason, /not found/);
});

test('a different title is flagged, but not when the essay says it changed over time', () => {
  const differs = pairWith('As team manager, I kept every split time.');
  assert.equal(flagsFromFacts(differs.pair, answer({ roleQuote: 'As team manager', role: 'manager' }), differs.sections).kept.length, 1);
  const promoted = pairWith('I started as a member, and I became captain junior year.');
  assert.equal(flagsFromFacts(promoted.pair, answer({ roleQuote: 'started as a member', role: 'member' }), promoted.sections).kept.length, 0);
  const same = pairWith('As the team captain, I led warmups.');
  assert.equal(flagsFromFacts(same.pair, answer({ roleQuote: 'As the team captain', role: 'captain' }), same.sections).kept.length, 0);
});

test('a placing is read from the student\'s own words, not from Nano\'s summary', () => {
  const differs = pairWith('At regionals we took first place overall.', 'honor-1', honor);
  assert.equal(flagsFromFacts(differs.pair, answer({ placeQuote: 'we took first place overall' }), differs.sections).kept.length, 1);
  const same = pairWith('At regionals we took second place overall.', 'honor-1', honor);
  assert.equal(flagsFromFacts(same.pair, answer({ placeQuote: 'we took second place overall' }), same.sections).kept.length, 0);
});

test('a paragraph Nano says is about something else gives no flags', () => {
  const { pair, sections } = pairWith('I swam twenty hours every week that season.');
  assert.equal(flagsFromFacts(pair, answer({ aboutThisActivity: false, hoursQuote: 'twenty hours every week', hoursPerWeek: 20 }), sections).kept.length, 0);
});
