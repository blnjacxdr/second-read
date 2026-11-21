// Reading Common App preview PDFs.
//
// Two kinds of tests:
// 1. Small made-up rows that copy layout patterns measured from real preview
//    PDFs (Nov 21): wrapped questions, swapped fonts, page breaks. No real text.
// 2. End to end on the fictional sample PDFs: test/fixtures/*-items.json is
//    what pdf.js read from them (tools/dump-pdf-items.mjs), and the result must
//    match the sample JSON they were built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toPlainItems, buildRows } from '../src/core/pdf-lines.js';
import { readCommonApp, readQuestions, joinLines } from '../src/core/common-app.js';
import { verifyQuote } from '../src/core/quotes.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const sample = readJson('../sample/application.json');
const key = readJson('../sample/expected-flags.json');

// Line breaks become spaces when prose is read from a PDF; every character is kept as written.
const collapseSpaces = (text) => text.replace(/[ \t\n]+/g, ' ').trim();

// A pdf.js-like item. Font "B" is bold (it's also used by the 24 pt heading below).
const item = (str, x, y, { h = 12, font = 'R', width = str.length * 5.5 } = {}) => ({ str, x, y, width, height: h, font });
const heading = (str, y, h = 24) => item(str, 36, y, { h, font: 'B' });

/** Rows for one page from short descriptions: [x, y, text, bold?]. */
function rowsOf(specs) {
  const items = [heading('Writing', 760), ...specs.map(([x, y, str, bold]) => item(str, x, y, { font: bold ? 'B' : 'R' }))];
  return buildRows([items]).slice(1); // drop the heading row
}

test('toPlainItems keeps text, position, size and font; drops blank pieces', () => {
  const raw = [
    { str: 'Hello', transform: [12, 0, 0, 12, 36.123, 700.456], width: 25.5, height: 12, fontName: 'g_d0_f1' },
    { str: '  ', transform: [12, 0, 0, 12, 90, 700], width: 3, height: 12, fontName: 'g_d0_f2' },
  ];
  assert.deepEqual(toPlainItems(raw), [{ str: 'Hello', x: 36.12, y: 700.46, width: 25.5, height: 12, font: 'g_d0_f1' }]);
});

test('buildRows drops the footer and the page-1 header, and marks bold by the heading font', () => {
  const page1 = [
    item('Applicant Name', 420, 760, { font: 'B' }), // header block above the first heading
    heading('Profile', 677),
    item('Name', 36, 627, { font: 'B' }),
    item('Riley', 179, 627),
    item('CA Riley  Fall 2027  1', 36, 22, { h: 9 }), // footer
  ];
  const rows = buildRows([page1]);
  assert.deepEqual(rows.map((r) => r.cells.map((c) => [c.text, c.bold])), [
    [['Profile', true]],
    [['Name', true], ['Riley', false]],
  ]);
});

test('buildRows joins pieces of one run of text and splits columns', () => {
  const rows = buildRows([[heading('Writing', 760), item('Hours', 36, 700, { width: 30 }), item('per', 71, 700, { width: 15 }), item('six', 179, 700)]]);
  assert.deepEqual(rows[1].cells.map((c) => c.text), ['Hours per', 'six']);
});

test('joinLines keeps hyphenated words whole but keeps spaced dashes', () => {
  assert.equal(joinLines(['assisted Spanish-', 'speaking clients']), 'assisted Spanish-speaking clients');
  assert.equal(joinLines(['Inducted Member -', 'National Honor Society']), 'Inducted Member - National Honor Society');
});

test('short answers: a wrapped question with its answer on the first line', () => {
  // Measured pattern: rows 14.5 apart inside one question, about 20 apart between questions.
  const { fields } = readQuestions(rowsOf([
    [36, 482, 'Have you previously', true], [179, 482, 'No'],
    [36, 467.5, 'applied to this', true],
    [36, 453, 'university?', true],
    [36, 432, 'Entry Term', true], [179, 432, 'Fall 2027'],
  ]));
  assert.deepEqual(fields, [
    { label: 'Have you previously applied to this university?', values: ['No'] },
    { label: 'Entry Term', values: ['Fall 2027'] },
  ]);
});

test('short answers: fonts swapped and both sides wrapping on the same lines', () => {
  // Some colleges' quick-answer blocks print questions regular and answers bold.
  const { fields, essays } = readQuestions(rowsOf([
    [36, 178, 'What is your favorite'], [179, 178, 'Cubed, slightly toasted,', true],
    [36, 163.5, 'snack?'], [179, 163.5, 'crunchy, yum!', true],
    [36, 143, 'Dream job:'], [179, 143, 'Head landscaper', true],
  ]));
  assert.deepEqual(fields, [
    { label: 'What is your favorite snack?', values: ['Cubed, slightly toasted, crunchy, yum!'] },
    { label: 'Dream job:', values: ['Head landscaper'] },
  ]);
  assert.deepEqual(essays, []);
});

test('essays: bold prompt, regular paragraphs split by bigger gaps, after a short answer', () => {
  const { fields, essays } = readQuestions(rowsOf([
    [36, 432, 'Preferred major', true], [179, 432, 'Engineering'],
    [36, 391, 'Interest in pursuing this program', true], // gap 41: a new prompt, not the label wrapping
    [36, 358, 'My grandparents live on a farm where the summers are long and the work is hard and'],
    [36, 343.5, 'nobody complains.'],
    [36, 314.5, 'That is where I learned to fix things.'], // gap 29: new paragraph
  ]));
  assert.deepEqual(fields, [{ label: 'Preferred major', values: ['Engineering'] }]);
  assert.deepEqual(essays, [{
    prompt: 'Interest in pursuing this program',
    text: 'My grandparents live on a farm where the summers are long and the work is hard and nobody complains.\n\nThat is where I learned to fix things.',
  }]);
});

test('honors: a title that wraps onto the next page stays one honor', () => {
  const page1 = [heading('Education', 740), heading('Honors', 74, 16.5),
    item('AI Ethics', 36, 51, { font: 'B' }), item('National', 179, 51), item('12', 286, 51)];
  const page2 = [item('(Program Name)', 36, 795, { font: 'B' }),
    item('Honor Roll', 36, 760, { font: 'B' }), item('School', 179, 760), item('10, 11', 286, 760)];
  const result = readCommonApp(buildRows([page1, page2]));
  assert.deepEqual(result.honors, [
    { id: 'honor-1', title: 'AI Ethics (Program Name)', level: 'National', grades: [12] },
    { id: 'honor-2', title: 'Honor Roll', level: 'School', grades: [10, 11] },
  ]);
});

test('any college name works, Affirmations are skipped, and missing parts are reported', () => {
  const page = [heading('Any State University questions', 740), heading('Writing Questions', 714, 16.5),
    item('Why us?', 36, 690, { font: 'B' }), item('Because of the robotics lab and the people in it.', 36, 660),
    heading('Affirmations', 600, 16.5), item('I affirm that all information is accurate.', 36, 575)];
  const result = readCommonApp(buildRows([page]));
  assert.equal(result.college, 'Any State University');
  assert.deepEqual(result.collegeEssays, [{ id: 'college-essay-1', group: 'Writing Questions', prompt: 'Why us?', text: 'Because of the robotics lab and the people in it.' }]);
  assert.deepEqual(result.missing, ['activities', 'personal essay']);
});

for (const college of ['michigan', 'northwestern']) {
  const fixture = readJson(`./fixtures/${college}-items.json`);
  const result = readCommonApp(buildRows(fixture.pages));
  const supplement = sample.supplements.find((s) => s.id === `supplement-${college}`);

  test(`${college} PDF: college found, nothing missing, no page chrome in the text`, () => {
    assert.equal(result.college, supplement.college);
    assert.deepEqual(result.missing, []);
    assert.equal(JSON.stringify(result).includes('SAMPLE -'), false);
  });

  test(`${college} PDF: activities match the sample, field for field`, () => {
    assert.equal(result.activities.length, sample.activities.length);
    result.activities.forEach((a, i) => {
      const expected = sample.activities[i];
      assert.equal(a.category, expected.type);
      assert.equal(a.heading, `${expected.organization}, ${expected.position}`);
      assert.equal(a.description, expected.description);
      assert.deepEqual(a.grades, expected.grades);
      assert.deepEqual([a.timing, a.hoursPerWeek, a.weeksPerYear, a.plans],
        [expected.timing, expected.hoursPerWeek, expected.weeksPerYear, expected.plans]);
    });
  });

  test(`${college} PDF: honors match the sample`, () => {
    assert.deepEqual(result.honors, sample.honors);
  });

  test(`${college} PDF: essays match the sample, paragraphs and prompts kept`, () => {
    assert.equal(result.personalEssay.prompt, sample.personalEssay.prompt);
    assert.equal(result.personalEssay.text, sample.personalEssay.text.split('\n\n').map(collapseSpaces).join('\n\n'));
    assert.equal(result.collegeEssays.length, 1);
    assert.equal(result.collegeEssays[0].prompt, supplement.prompt);
    assert.equal(result.collegeEssays[0].text, supplement.text.split('\n\n').map(collapseSpaces).join('\n\n'));
    assert.deepEqual(result.collegeAnswers.map((a) => [a.label, a.values[0]]), supplement.answers.map((a) => [a.label, a.value]));
  });

  test(`${college} PDF: every answer-key quote for this PDF verifies against the PDF's sections`, () => {
    // In one college's PDF, that college's supplement is its first college essay.
    const toPdfSection = (id) => (id === `supplement-${college}` ? 'college-essay-1' : id);
    for (const flag of key.flags.filter((f) => f.inPdfs.includes(college))) {
      for (const citation of flag.citations) {
        const pdfCitation = { ...citation, sectionId: toPdfSection(citation.sectionId) };
        assert.equal(verifyQuote(result.sections, pdfCitation), true, `${flag.id}: "${citation.quote}"`);
      }
    }
  });
}
