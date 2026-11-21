// PDF reading: lines, header/footer removal, and sections. The end-to-end tests
// use text pdf.js read from the real sample PDFs (test/fixtures/*-items.json,
// made by tools/dump-pdf-items.mjs) and check the result against the sample JSON
// the PDFs were built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { itemsToLines, removeRepeatedLines, toPlainItems } from '../src/core/pdf-lines.js';
import { splitApplication, parseFields, SAMPLE_LAYOUT } from '../src/core/sectioner.js';
import { verifyQuote } from '../src/core/quotes.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const sample = readJson('../sample/application.json');
const key = readJson('../sample/expected-flags.json');

// Line breaks become spaces when prose is read from a PDF; every character is kept as written.
const collapseSpaces = (text) => text.replace(/\s+/g, ' ').trim();

const item = (str, x, y, width = str.length * 5, height = 11) => ({ str, x, y, width, height });

test('toPlainItems keeps text and position, drops empty pieces', () => {
  const raw = [
    { str: 'Hello', transform: [11, 0, 0, 11, 60.123, 700.456], width: 25.5, height: 11 },
    { str: '', transform: [11, 0, 0, 11, 90, 700], width: 0, height: 0 },
  ];
  assert.deepEqual(toPlainItems(raw), [{ str: 'Hello', x: 60.12, y: 700.46, width: 25.5, height: 11 }]);
});

test('itemsToLines orders lines top to bottom and pieces left to right', () => {
  const lines = itemsToLines([
    item('second line', 60, 680),
    item('world', 100, 700),
    item('Hello', 60, 700.8), // same line, tiny y difference
  ]);
  assert.deepEqual(lines, ['Hello world', 'second line']);
});

test('itemsToLines adds a space only where there is a visible gap', () => {
  assert.deepEqual(itemsToLines([item('Hours', 60, 700, 30), item('per', 95, 700, 15)]), ['Hours per']);
  assert.deepEqual(itemsToLines([item('co-', 60, 700, 15), item('captain', 75, 700, 35)]), ['co-captain']);
});

test('removeRepeatedLines drops page headers and footers, even with changing page numbers', () => {
  const pages = [
    ['SAMPLE banner', 'Activity 1', 'Position: Lead', 'Page 1 of 3'],
    ['SAMPLE banner', 'Activity 2', 'Position: Tutor', 'Page 2 of 3'],
    ['SAMPLE banner', 'Personal Essay', 'Forty seconds…', 'Page 3 of 3'],
  ];
  assert.deepEqual(removeRepeatedLines(pages), [
    ['Activity 1', 'Position: Lead'],
    ['Activity 2', 'Position: Tutor'],
    ['Personal Essay', 'Forty seconds…'],
  ]);
});

test('removeRepeatedLines never removes repeated lines from the middle of a page', () => {
  const pages = [
    ['Top A', 'Activity 1', 'x', 'y', 'Activity 2', 'Bottom A'],
    ['Top B', 'Activity 3', 'x', 'y', 'Activity 4', 'Bottom B'],
  ];
  // "x" and "y" repeat on both pages but are not at a page edge.
  assert.deepEqual(removeRepeatedLines(pages, { edgeLines: 1 }), pages);
  // A one-page document has nothing to compare against, so nothing is removed.
  assert.deepEqual(removeRepeatedLines([['Only page']]), [['Only page']]);
});

test('parseFields joins wrapped lines and ignores colons that are not field labels', () => {
  const fields = parseFields(
    ['Position: Lead Programmer', 'Description: Wrote code: drive, arm and', 'vision.', 'Hours per week: 6'],
    SAMPLE_LAYOUT.activityFields,
  );
  assert.deepEqual(fields, { position: 'Lead Programmer', description: 'Wrote code: drive, arm and vision.', hoursPerWeek: '6' });
});

test('a missing heading is reported, not silently ignored', () => {
  const result = splitApplication(['Activities and Experiences', 'Activity 1', 'Position: Lead']);
  assert.deepEqual(result.unmatchedHeadings, ['honors', 'personalEssay', 'supplement']);
});

for (const college of ['michigan', 'northwestern']) {
  const fixture = readJson(`./fixtures/${college}-items.json`);
  const lines = removeRepeatedLines(fixture.pages.map((page) => itemsToLines(page))).flat();
  const result = splitApplication(lines, SAMPLE_LAYOUT);
  const expectedSupplement = sample.supplements.find((s) => s.id === `supplement-${college}`);

  test(`${college} PDF: no SAMPLE banner left and every heading found`, () => {
    assert.equal(lines.some((line) => line.startsWith('SAMPLE -')), false);
    assert.deepEqual(result.unmatchedHeadings, []);
  });

  test(`${college} PDF: activities and honors match the sample, field for field`, () => {
    assert.deepEqual(result.activities, sample.activities);
    assert.deepEqual(result.honors, sample.honors);
  });

  test(`${college} PDF: essay and supplement text match the sample, prompts separated`, () => {
    assert.equal(result.personalEssay.text, collapseSpaces(sample.personalEssay.text));
    assert.equal(result.personalEssay.prompt, sample.personalEssay.prompt);
    assert.equal(result.supplement.college, expectedSupplement.college);
    assert.equal(result.supplement.prompt, expectedSupplement.prompt);
    assert.equal(result.supplement.text, collapseSpaces(expectedSupplement.text));
  });

  test(`${college} PDF: every answer-key quote for this PDF verifies against the PDF's sections`, () => {
    // In a single college's PDF, that college's supplement is just "supplement".
    const toPdfSection = (id) => (id === `supplement-${college}` ? 'supplement' : id);
    for (const flag of key.flags.filter((f) => f.inPdfs.includes(college))) {
      for (const citation of flag.citations) {
        const pdfCitation = { ...citation, sectionId: toPdfSection(citation.sectionId) };
        assert.equal(verifyQuote(result.sections, pdfCitation), true, `${flag.id}: "${citation.quote}"`);
      }
    }
  });
}
