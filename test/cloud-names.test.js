// Tests for the cloud name check (src/core/cloud-names.js). Made-up names and text throughout,
// so the rules are tested on their own, not fitted to the sample applicant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSendableName, cloudQuestions, cloudNamesPrompt, parseCloudAnswer, placeConflicts, answerStatus, expandAbbreviation,
  MAX_QUESTIONS,
} from '../src/core/cloud-names.js';
import { sourcesByAnswer, looksProper, honorLevel, levelMismatch, cloudNamesPrompt as promptFor, parseCloudAnswer as parseFor, answerStatus as statusFor, cloudQuestions as questionsFor } from '../src/core/cloud-names.js';

const name = (n, sectionIds, extra = {}) => ({ name: n, kind: 'program', sectionIds, defaultOn: true, ...extra });

test('only short, one-line names can be sent', () => {
  assert.equal(isSendableName('Research Science Institute (RSI)'), true);
  assert.equal(isSendableName('Harbor Youth Orchestra'), true);
  assert.equal(isSendableName('two\nlines'), false);
  assert.equal(isSendableName('one two three four five six seven eight nine ten eleven twelve thirteen'), false);
  assert.equal(isSendableName('x'.repeat(121)), false);
  assert.equal(isSendableName(''), false);
  assert.equal(isSendableName(undefined), false);
});

test('every name gets a lookup that keeps its own default; names in this college\'s essays also get a part-of question', () => {
  const qs = cloudQuestions([
    name('Cedar Point Math Circle', ['activity-2']),
    name('Lakeside Day School', ['activity-1'], { defaultOn: false, why: 'your own school' }),
    name('Blue Delta Rocketry Lab', ['college-essay-1']),
  ], { college: 'University of Michigan' });
  assert.deepEqual(qs.map((q) => [q.id, q.kind, q.name, q.defaultOn]), [
    [1, 'lookup', 'Cedar Point Math Circle', true],
    [2, 'lookup', 'Lakeside Day School', false],
    [3, 'lookup', 'Blue Delta Rocketry Lab', true],
    [4, 'partOf', 'Blue Delta Rocketry Lab', true],
  ]);
  assert.equal(qs[1].why, 'your own school');
  assert.equal(qs[3].college, 'University of Michigan');
});

test('colleges get no questions at all: we know they exist, and the code check handles other colleges', () => {
  const inEssay = ['college-essay-2'];
  assert.equal(cloudQuestions([name('UMich', inEssay)], { college: 'University of Michigan' }).length, 0); // an alias from the college list
  assert.equal(cloudQuestions([name('Tufts University', inEssay, { kind: 'college' })], { college: 'University of Michigan' }).length, 0);
  assert.equal(cloudQuestions([name('Stanford University', ['activity-5'], { kind: 'organization' })]).length, 0); // known college, any kind
});

test('part-of is asked only for names in this college\'s essays and nowhere else', () => {
  const opts = { college: 'University of Michigan' };
  assert.deepEqual(cloudQuestions([name('Blue Delta Rocketry Lab', ['college-essay-1', 'activity-3'])], opts).map((q) => q.kind), ['lookup']);
  assert.deepEqual(cloudQuestions([name('Blue Delta Rocketry Lab', ['college-essay-1', 'college-essay-2'])], opts).map((q) => q.kind), ['lookup', 'partOf']);
  assert.deepEqual(cloudQuestions([name('Blue Delta Rocketry Lab', ['college-essay-1'])]).map((q) => q.kind), ['lookup']); // no college known
});

test('clubs named after the student\'s own school start unticked, with the reason', () => {
  const qs = cloudQuestions([
    name('Maple Grove High School Chess Team', ['activity-1'], { defaultOn: false, why: 'your own school' }),
    name('Maple Grove Robotics', ['activity-2']),
    name('Maple Leaf Youth Symphony', ['activity-3']),
  ]);
  assert.deepEqual(qs.map((q) => [q.name, q.defaultOn, q.why]), [
    ['Maple Grove High School Chess Team', false, 'your own school'],
    ['Maple Grove Robotics', false, "sounds like a club at the student's school"],
    ['Maple Leaf Youth Symphony', true, null],
  ]);
});

test('an abbreviation is sent the way the application spells it out', () => {
  const sections = { 'activity-5': 'Research Science Institute (RSI) at Stanford University, summer research' };
  assert.equal(cloudQuestions([name('RSI', ['activity-5'])], { sections })[0].name, 'Research Science Institute (RSI)');
  assert.equal(expandAbbreviation('NASA', ['activity-5'], sections), 'NASA'); // not spelled out: sent as written
  // A field label on the line above, and a sentence-starting word, are not part of the name.
  const labelled = { 'activity-5': 'Research\nResearch Science Institute (RSI), six weeks', 'essay': 'At Harbor Youth Orchestra (HYO) I learned to listen.' };
  assert.equal(expandAbbreviation('RSI', ['activity-5'], labelled), 'Research Science Institute (RSI)');
  assert.equal(expandAbbreviation('HYO', ['essay'], labelled), 'Harbor Youth Orchestra (HYO)');
  assert.equal(expandAbbreviation('Harbor Youth Orchestra', ['activity-5'], sections), 'Harbor Youth Orchestra'); // not an abbreviation
});

test('names too long to be names are never offered, and the list is capped', () => {
  assert.equal(cloudQuestions([name('I spent every summer at the lake helping my grandmother fix the dock and the boat', ['activity-1'])]).length, 0);
  const many = Array.from({ length: 40 }, (_, i) => name(`Program Number ${i}`, ['activity-1']));
  assert.equal(cloudQuestions(many).length, MAX_QUESTIONS);
});

test('the prompt holds fixed wording, the names and the college, numbered', () => {
  const qs = cloudQuestions([name('Blue Delta Rocketry Lab', ['college-essay-1'])], { college: 'University of Michigan' });
  const prompt = cloudNamesPrompt(qs);
  assert.match(prompt, /^Search Google for every numbered question/);
  assert.match(prompt, /^1\. Look up: Blue Delta Rocketry Lab$/m);
  assert.match(prompt, /^2\. Part of: is Blue Delta Rocketry Lab part of University of Michigan\?$/m);
  assert.match(prompt, /EXISTS, NOT FOUND or UNSURE/);
  assert.match(prompt, /YES, NO or UNSURE/);
  const noSearch = cloudNamesPrompt(qs, { withSearch: false });
  assert.doesNotMatch(noSearch, /Search Google|Google Search/);
  assert.match(noSearch, /not sure, answer UNSURE/);
});

test('the prompt refuses empty lists, too many questions and anything that is not a name', () => {
  assert.throws(() => cloudNamesPrompt([]));
  assert.throws(() => cloudNamesPrompt([{ id: 1, kind: 'lookup', name: 'a\nb' }]));
  assert.throws(() => cloudNamesPrompt([{ id: 1, kind: 'partOf', name: 'Blue Delta Lab', college: 'x\ny' }]));
  const tooMany = Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => ({ id: i + 1, kind: 'lookup', name: `Name ${i}` }));
  assert.throws(() => cloudNamesPrompt(tooMany));
});

test('answers are read back by number, tolerating bold, bullets and other numbering', () => {
  const qs = [
    { id: 1, kind: 'lookup', name: 'Research Science Institute (RSI)' },
    { id: 2, kind: 'partOf', name: 'Blue Delta Rocketry Lab', college: 'University of Michigan' },
    { id: 3, kind: 'lookup', name: 'Cedar Point Math Circle' },
    { id: 4, kind: 'lookup', name: 'Harbor Youth Orchestra' },
  ];
  const text = [
    'Here are the answers:',
    '**1** | EXISTS | Research Science Institute | Massachusetts Institute of Technology, Cambridge, MA | A free summer program.',
    '- 2) NO | - | Tucson, Arizona | It is a club at another university.',
    '3. NOT FOUND | - | - | -',
  ].join('\n');
  const { answers, missing, leftover } = parseCloudAnswer(text, qs);
  assert.deepEqual(answers[0], { id: 1, verdict: 'exists', official: 'Research Science Institute', place: 'Massachusetts Institute of Technology, Cambridge, MA', fact: 'A free summer program.' });
  assert.deepEqual(answers[1], { id: 2, verdict: 'no', official: null, place: 'Tucson, Arizona', fact: 'It is a club at another university.' });
  assert.deepEqual(answers[2], { id: 3, verdict: 'not_found', official: null, place: null, fact: null });
  assert.deepEqual(missing, [4]);
  assert.deepEqual(leftover, ['Here are the answers:']);
});

test('unknown verdicts and repeated or unknown numbers are handled safely', () => {
  const qs = [{ id: 1, kind: 'lookup', name: 'A Program' }, { id: 2, kind: 'partOf', name: 'B Lab', college: 'C University' }];
  const { answers, leftover } = parseCloudAnswer('1 | maybe? | - | - | -\n1 | EXISTS | x | y | z\n2 | probably | - | - | -\n9 | EXISTS', qs);
  assert.equal(answers[0].verdict, 'unsure');
  assert.equal(answers[1].verdict, 'unsure');
  assert.equal(leftover.length, 2);
  assert.deepEqual(parseCloudAnswer('', qs), { answers: [], missing: [1, 2], leftover: [] });
});

const RSI = { id: 1, kind: 'lookup', name: 'Research Science Institute (RSI)', sectionIds: ['activity-5'] };
const atMit = { verdict: 'exists', official: 'Research Science Institute', place: 'Massachusetts Institute of Technology', fact: 'Held each summer.' };

test('a college written right after the name that the answer does not mention is a conflict', () => {
  const sections = { 'activity-5': 'Research Science Institute (RSI) at Stanford University, summer research in math' };
  assert.deepEqual(placeConflicts(RSI, atMit, sections), [{ written: 'Stanford University' }]);
  assert.equal(answerStatus(RSI, atMit, placeConflicts(RSI, atMit, sections)), 'look');
});

test('no conflict when the answer agrees, when the college is far away, or when it is part of the name', () => {
  const agrees = { 'activity-5': 'Research Science Institute (RSI) at MIT, summer research' };
  assert.deepEqual(placeConflicts(RSI, atMit, agrees), []);
  const far = { 'activity-5': `Research Science Institute (RSI), ${'six weeks of reading papers and running experiments every day, '.repeat(2)}then I toured Stanford` };
  assert.deepEqual(placeConflicts(RSI, atMit, far), []);
  const camp = { id: 2, kind: 'lookup', name: 'Stanford Math Camp', sectionIds: ['activity-1'] };
  assert.deepEqual(placeConflicts(camp, { verdict: 'exists', official: 'SUMaC', place: 'Palo Alto, California', fact: null }, { 'activity-1': 'Stanford Math Camp at Stanford' }), []);
  assert.deepEqual(placeConflicts(RSI, { ...atMit, place: null }, { 'activity-5': 'Research Science Institute (RSI) at Stanford' }), []);
});

test('what the student sees for each answer', () => {
  assert.equal(answerStatus(RSI, atMit), 'fine');
  assert.equal(answerStatus(RSI, { verdict: 'not_found' }), 'unsure'); // Google rarely knows a local club
  assert.equal(answerStatus(RSI, { verdict: 'no' }), 'look');
  assert.equal(answerStatus(RSI, { verdict: 'unsure' }), 'unsure');
  assert.equal(answerStatus(RSI, undefined), 'unsure');
});

test('sources sit with the answer they back up; the rest are kept, not dropped', () => {
  const text = '1 | EXISTS | Maple Youth Orchestra | Dayton, Ohio | A youth orchestra.\n2 | EXISTS | Lakeview Science Camp | Duluth, Minnesota | A summer camp.';
  const sources = [{ title: 'a.org', uri: 'https://a.org' }, { title: 'b.org', uri: 'https://b.org' }, { title: 'c.org', uri: 'https://c.org' }];
  const supports = [
    { text: 'Maple Youth Orchestra | Dayton, Ohio', uris: ['https://a.org'] },
    { text: 'Lakeview Science Camp | Duluth, Minnesota | A summer camp.', uris: ['https://b.org', 'https://a.org'] },
    { text: 'words that are nowhere in the reply', uris: ['https://c.org'] },
  ];
  const { byId, other } = sourcesByAnswer(text, supports, sources);
  assert.deepEqual(byId.get(1).map((s) => s.title), ['a.org']);
  assert.deepEqual(byId.get(2).map((s) => s.title), ['b.org', 'a.org']);
  assert.deepEqual(other.map((s) => s.title), ['c.org']);
});

test('part-of questions are only for proper names', () => {
  assert.equal(looksProper('Michigan Hackers'), true);
  assert.equal(looksProper('Society of Women Engineers'), true);
  assert.equal(looksProper('RC aircraft'), false);
  const qs = questionsFor([{ name: 'paper airplanes', kind: 'program', sectionIds: ['college-essay-1'], defaultOn: false }], { college: 'Purdue University' });
  assert.equal(qs.filter((q) => q.kind === 'partOf').length, 0);
});

test('an honor with a level gets a level question; the level itself is never sent', () => {
  const sections = { 'honor-1': 'Coastal Poetry Prize\nState/Regional\n11' };
  assert.deepEqual(honorLevel(['honor-1'], sections), { listed: 'State/Regional', highest: 'state' });
  const [q] = questionsFor([{ name: 'Coastal Poetry Prize', kind: 'award', sectionIds: ['honor-1'], defaultOn: true }], { sections });
  assert.equal(q.kind, 'level');
  const prompt = promptFor([q]);
  assert.match(prompt, /Level: at what level is the honor Coastal Poetry Prize given\?/);
  assert.doesNotMatch(prompt, /State\/Regional/);
  const national = parseFor('1 | NATIONAL | Coastal Poetry Prize | - | A national poetry award.', [q]).answers[0];
  assert.equal(national.verdict, 'national');
  assert.deepEqual(levelMismatch(q, national), { listed: 'State/Regional', google: 'national' });
  assert.equal(statusFor(q, national), 'look');
  const regional = parseFor('1 | REGIONAL | Coastal Poetry Prize | - | -', [q]).answers[0];
  assert.equal(levelMismatch(q, regional), null);
  assert.equal(statusFor(q, regional), 'fine');
});
