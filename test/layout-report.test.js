// The layout report must never show a student's writing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutReport, safeLabel } from '../src/core/layout-report.js';

test('headings show only standard labels; anything else shows only its length', () => {
  assert.equal(safeLabel('Activities and experiences'), 'Activities and experiences');
  assert.equal(safeLabel('Seattle University questions'), '[a college name] questions');
  assert.equal(safeLabel('Jordan Example'), '[other text, 14 characters]');
});

test('the report holds sizes and counts, never body text', () => {
  const secret = 'I stayed in the robotics lab every night';
  const pages = [[
    { str: 'Activities', x: 36, y: 700, width: 80, height: 14, font: 'B' },
    { str: secret, x: 179, y: 680, width: 300, height: 9, font: 'R' },
  ]];
  const report = layoutReport(pages);
  assert.ok(!JSON.stringify(report).includes('robotics'));
  assert.equal(report.hasHeadingSizedText, false);
  assert.equal(report.droppedAsTooSmall, secret.length);
});

test('a PDF that is only pictures of text is recognized, so the app can say why', async () => {
  const { isImageOnlyPdf } = await import('../src/core/layout-report.js');
  assert.equal(isImageOnlyPdf([[], [{ str: ' ', x: 0, y: 0, width: 0, height: 0, font: 'x' }]]), true);
  assert.equal(isImageOnlyPdf([[{ str: 'Activities', x: 36, y: 700, width: 80, height: 24, font: 'B' }]]), false);
  assert.equal(isImageOnlyPdf([]), false);
});
