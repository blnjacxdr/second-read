// Tests for the cloud name check (src/core/cloud-names.js). Made-up names and text throughout,
// so the rules are tested on their own, not fitted to the sample applicant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSendableName, cloudQuestions, cloudNamesPrompt, parseCloudAnswer, placeConflicts, answerStatus,
  MAX_QUESTIONS,
} from '../src/core/cloud-names.js';

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

test('no part-of question for colleges themselves, or without a known college', () => {
  const inEssay = ['college-essay-2'];
  assert.equal(cloudQuestions([name('UMich', inEssay)], { college: 'University of Michigan' }).length, 1); // an alias from the college list
  assert.equal(cloudQuestions([name('Tufts University', inEssay, { kind: 'college' })], { college: 'University of Michigan' }).length, 1);
  assert.equal(cloudQuestions([name('Blue Delta Rocketry Lab', inEssay)]).length, 1);
});

test('names too long to be names are never offered, and the list is capped', () => {
  assert.equal(cloudQuestions([name('I spent every summer at the lake helping my grandmother fix the dock and the boat', ['activity-1'])]).length, 0);
  const many = Array.from({ length: 40 }, (_, i) => name(`Program Number ${i}`, ['activity-1']));
  assert.equal(cloudQuestions(many).length, MAX_QUESTIONS);
});

test('the prompt holds fixed wording, the names and the college, numbered', () => {
  const qs = cloudQuestions([name('Blue Delta Rocketry Lab', ['college-essay-1'])], { college: 'University of Michigan' });
  const prompt = cloudNamesPrompt(qs);
  assert.match(prompt, /^Use Google Search/);
  assert.match(prompt, /^1\. Look up: Blue Delta Rocketry Lab$/m);
  assert.match(prompt, /^2\. Part of: is Blue Delta Rocketry Lab part of University of Michigan\?$/m);
  assert.match(prompt, /EXISTS, NOT FOUND or UNSURE/);
  assert.match(prompt, /YES, NO or UNSURE/);
  const noSearch = cloudNamesPrompt(qs, { withSearch: false });
  assert.doesNotMatch(noSearch, /Google Search/);
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
  assert.equal(answerStatus(RSI, { verdict: 'not_found' }), 'look');
  assert.equal(answerStatus(RSI, { verdict: 'no' }), 'look');
  assert.equal(answerStatus(RSI, { verdict: 'unsure' }), 'unsure');
  assert.equal(answerStatus(RSI, undefined), 'unsure');
});
