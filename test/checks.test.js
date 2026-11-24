// Code-only checks. Synthetic text plus the fictional sample PDFs and their answer key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  wordsOf, sentencesOf, findCollegeMentions, checkOtherCollegeNames, checkStartYears,
  sharedPassages, checkRepeatedPassages, checkActivityDescriptionDraft, checkLimits, runCodeChecks, checkInputFromPdf,
  checkQualifiedTitles, checkGradeYears, checkCounts, countsIn, activityGrades,
} from '../src/core/checks.js';
import { buildRows } from '../src/core/pdf-lines.js';
import { readCommonApp, isPersonalAnswer } from '../src/core/common-app.js';
import { verifyQuote, normalizeForMatch, trimEdgePunctuation } from '../src/core/quotes.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const key = readJson('../sample/expected-flags.json');

const app = (overrides) => ({ college: 'University of Michigan', sections: {}, activityIds: [], essayIds: [], collegeEssayIds: [], ...overrides });

test('wordsOf keeps positions and treats curly apostrophes like straight ones', () => {
  assert.deepEqual(wordsOf('I don’t.').map((w) => [w.word, w.start, w.end]), [['i', 0, 1], ["don't", 2, 7]]);
});

test('sentencesOf splits on end punctuation and line breaks', () => {
  assert.deepEqual(sentencesOf('One two. Three!\nFour').map((s) => s.text), ['One two.', 'Three!', 'Four']);
});

test('college mentions: longest name wins, whole words only, case matters', () => {
  const found = findCollegeMentions('I toured Penn State and the University of Michigan, not UMichigan or mit.');
  assert.deepEqual(found.map((m) => m.name), ['Penn State', 'University of Michigan']);
});

test('other college name: flagged in a college essay, never the college itself', () => {
  const flags = checkOtherCollegeNames(app({
    sections: { 'college-essay-1': 'Ann Arbor feels like home. Unlike Stanford, the University of Michigan has a lab I love. UMich rocks.' },
    collegeEssayIds: ['college-essay-1'],
  }));
  assert.equal(flags.length, 1);
  assert.equal(flags[0].title, 'Mentions Stanford in the University of Michigan essay');
  assert.equal(flags[0].citations[0].quote, 'Unlike Stanford, the University of Michigan has a lab I love.');
});

test('other college name: the personal essay is not checked (it goes to every college)', () => {
  const flags = checkOtherCollegeNames(app({ sections: { 'personal-essay': 'I visited Yale once.' }, essayIds: ['personal-essay'] }));
  assert.deepEqual(flags, []);
});

test('start years: an essay sentence about the same activity with a different start year', () => {
  const sections = {
    'activity-1': 'Community service\nNorth Valley Chess Society, Founder\nFounded the society in 2022. Weekly games.',
    'essay-1': 'I started the chess society in 2021 with two friends. In 2022 we won a trophy.',
    'essay-2': 'I joined the robotics team in 2021.', // different activity: no shared keyword
  };
  const flags = checkStartYears(app({ sections, activityIds: ['activity-1'], essayIds: ['essay-1', 'essay-2'] }));
  assert.equal(flags.length, 1);
  assert.equal(flags[0].title, 'Start year 2022 in an activity, 2021 in an essay');
  assert.deepEqual(flags[0].citations.map((c) => c.quote), ['Founded the society in 2022.', 'I started the chess society in 2021 with two friends.']);
});

test('start years: matching years, or a year without a start word, are not flagged', () => {
  const sections = {
    'activity-1': 'Club\nNorth Valley Chess Society, Founder\nFounded the society in 2022.',
    'essay-1': 'I founded the chess society in 2022. The chess society hosted a tournament in 2023.',
  };
  assert.deepEqual(checkStartYears(app({ sections, activityIds: ['activity-1'], essayIds: ['essay-1'] })), []);
});

test('shared passages: 12+ identical words are found, shorter overlaps are normal', () => {
  const long = 'the bug hides one layer down in the assumption I was too sure of to question';
  const runs = sharedPassages(`First. ${long}. End.`, `Start here: ${long}! Done.`);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].words, 16);
  assert.deepEqual(sharedPassages('one of the most important things I learned', 'it was one of the most important things I learned'), []);
});

test('repeated passages are flagged once per pair, with each essay\'s own text', () => {
  const shared = 'Debugging taught me that the problem is almost never where I first look at all';
  const flags = checkRepeatedPassages(app({
    sections: { a: `Intro. ${shared}.`, b: `${shared.toUpperCase()}!`, c: 'Nothing in common here at all.' },
    essayIds: ['a', 'b', 'c'],
  }));
  assert.equal(flags.length, 1);
  assert.deepEqual(flags[0].citations.map((c) => c.sectionId), ['a', 'b']);
  assert.equal(flags[0].citations[1].quote, shared.toUpperCase());
});

test('limits: a 151-character draft description is flagged, 150 is fine', () => {
  assert.equal(checkActivityDescriptionDraft('d', 'x'.repeat(150)).length, 0);
  assert.equal(checkActivityDescriptionDraft('d', 'x'.repeat(151))[0].title, 'Description is 151 characters; the limit is 150');
  const drafts = readFileSync(new URL('../sample/paste-in-drafts.txt', import.meta.url), 'utf8');
  const description = drafts.match(/^Description: (.+)$/m)[1];
  assert.equal(checkActivityDescriptionDraft('draft', description).length, 1);
});

test('limits: a personal essay over 650 words is flagged', () => {
  const flags = checkLimits(app({ sections: { 'personal-essay': 'word '.repeat(651) } }));
  assert.equal(flags[0].kind, 'word-limit');
});

test('data minimization: personal college answers are recognized', () => {
  assert.equal(isPersonalAnswer('Residency', 'Are you an Oregon Resident?'), true);
  assert.equal(isPersonalAnswer('General', "Person's phone number:"), true);
  assert.equal(isPersonalAnswer('Academics', 'Major Selected'), false);
});

for (const college of ['michigan', 'northwestern']) {
  const result = readCommonApp(buildRows(readJson(`./fixtures/${college}-items.json`).pages));
  const flags = runCodeChecks(checkInputFromPdf(result));
  const toPdfSection = (id) => (id === `supplement-${college}` ? 'college-essay-1' : id);
  const expected = key.flags.filter((f) => f.check === 'code' && f.inPdfs.includes(college));

  test(`${college} PDF: exactly the planted code-check mistakes are flagged`, () => {
    assert.deepEqual(flags.map((f) => f.kind).sort(), expected.map((f) => f.kind).sort());
  });

  test(`${college} PDF: each flag points at the answer key's places and quotes`, () => {
    for (const want of expected) {
      const got = flags.find((f) => f.kind === want.kind);
      assert.deepEqual(got.citations.map((c) => c.sectionId), want.citations.map((c) => toPdfSection(c.sectionId)));
      want.citations.forEach((c, i) => {
        assert.ok(normalizeForMatch(got.citations[i].quote).includes(trimEdgePunctuation(normalizeForMatch(c.quote))), `${want.id}: "${c.quote}"`);
      });
    }
  });

  test(`${college} PDF: every flag's quotes verify against the application`, () => {
    for (const flag of flags) for (const c of flag.citations) assert.equal(verifyQuote(result.sections, c), true, flag.id);
  });
}

test('qualified titles: "Co-Captain" in an activity vs a bare "captain" in an essay about it', () => {
  const sections = {
    'activity-1': 'Athletics\nRiver Valley Rowing Club, Co-Captain\nLed practices.',
    'activity-2': 'Club\nDebate Society, Vice President\nRan tournaments.',
    e1: 'As captain of the rowing club, I set the schedule. As co-captain of the debate team I spoke.',
    e2: 'I was president of the debate society for a year.',
    e3: 'Our captain at the chess club was great.', // different activity: no shared word
  };
  const flags = checkQualifiedTitles(app({ sections, activityIds: ['activity-1', 'activity-2'], essayIds: ['e1', 'e2', 'e3'] }));
  assert.deepEqual(flags.map((f) => f.title), ['"Co-Captain" in an activity, "captain" in an essay', '"Vice President" in an activity, "president" in an essay']);
  assert.equal(flags[0].citations[1].quote, 'As captain of the rowing club, I set the schedule.');
});

// Made-up activity text in the PDF's layout: category, "Org, Position", description, grades, hours.
const birdActivity = 'Environmental\nMarsh Hollow Bird Count, Volunteer Coordinator\nOrganized 25 volunteers for the winter bird count and trained new spotters.\n10, 11, 12 (School)\n4 hr/wk, 20 wk/yr';

test('grade years: an essay start earlier than the grades listed is flagged', () => {
  assert.deepEqual(activityGrades(birdActivity).grades, [10, 11, 12]);
  const flags = checkGradeYears(app({
    sections: { 'activity-1': birdActivity, 'personal-essay': 'I have coordinated the Marsh Hollow bird count since freshman year.' },
    activityIds: ['activity-1'], essayIds: ['personal-essay'],
  }));
  assert.equal(flags.length, 1);
  assert.deepEqual(flags[0].citations.map((c) => c.quote), ['10, 11, 12 (School)', 'I have coordinated the Marsh Hollow bird count since freshman year.']);
});

test('grade years: a start that fits, or a sentence about something else, is not flagged', () => {
  const quiet = (essay) => checkGradeYears(app({
    sections: { 'activity-1': birdActivity, 'personal-essay': essay }, activityIds: ['activity-1'], essayIds: ['personal-essay'],
  }));
  assert.equal(quiet('I joined the Marsh Hollow bird count in sophomore year.').length, 0);
  assert.equal(quiet('Since freshman year I have loved chemistry.').length, 0);
});

test('counts: the same thing counted differently is flagged; growth sentences are not', () => {
  assert.deepEqual(countsIn('Raised $1,200 and trained 25 volunteers, 60+ students and twelve schools').map((c) => [c.noun, c.value]),
    [['dollars', 1200], ['volunteers', 25], ['students', 60], ['schools', 12]]);
  const run = (essay) => checkCounts(app({
    sections: { 'activity-1': birdActivity, 'personal-essay': essay }, activityIds: ['activity-1'], essayIds: ['personal-essay'],
  }));
  const flags = run('At the Marsh Hollow bird count I led 40 volunteers through the snow.');
  assert.equal(flags.length, 1);
  assert.match(flags[0].title, /^25 volunteers in an activity, 40 in an essay$/);
  assert.equal(run('At the Marsh Hollow bird count I led twenty-five, I mean 25 volunteers.').length, 0);
  assert.equal(run('The Marsh Hollow bird count grew from 10 volunteers to 40 volunteers.').length, 0);
  assert.equal(run('At the Marsh Hollow bird count our 2024 season was cold.').length, 0);
});
