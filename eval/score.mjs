// Scores the CODE checks on the held-out test set: npm run eval
//
// Builds a PDF for each eval/heldout/app-N.json (same template as the samples),
// reads it the way the app does, runs the code checks, and compares with
// eval/heldout/answer-key.json. Prints NUMBERS ONLY, never application text,
// so the person tuning the checks never sees the held-out applications.
// The Gemini Nano part is scored in the browser: dev/eval.html.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { toPlainItems, buildRows } from '../src/core/pdf-lines.js';
import { readCommonApp } from '../src/core/common-app.js';
import { runCodeChecks, checkInputFromPdf } from '../src/core/checks.js';
import { scoreApplication, totalScores } from '../src/core/eval.js';

// Which set to score: eval/heldout by default, or another folder under eval/ (node eval/score.mjs fresh).
const set = process.argv[2] ?? 'heldout';
if (!/^[a-z0-9-]+$/.test(set)) throw new Error('set name: letters, digits and dashes only');
const dir = fileURLToPath(new URL(`./${set}/`, import.meta.url));
const key = JSON.parse(readFileSync(join(dir, 'answer-key.json'), 'utf8'));
const apps = readdirSync(dir).filter((f) => /^app-\d+\.json$/.test(f)).sort();

async function readPdf(path) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) pages.push(toPlainItems((await (await doc.getPage(n)).getTextContent()).items));
  return readCommonApp(buildRows(pages));
}

const scores = [];
for (const file of apps) {
  const pdfPath = join(dir, file.replace('.json', '.pdf'));
  if (!existsSync(pdfPath)) {
    execFileSync(process.execPath, [fileURLToPath(new URL('../tools/make-sample-pdf.js', import.meta.url)), join(dir, file), pdfPath]);
  }
  const result = await readPdf(pdfPath);
  const flags = runCodeChecks(checkInputFromPdf(result));
  const entry = key.applications.find((a) => a.file === file) ?? { mistakes: [], trickyConsistent: [] };
  const score = scoreApplication(flags, entry, result.sections);
  scores.push(score);
  console.log(`${file}: caught ${score.caught}/${score.planted}, false alarms ${score.falseAlarms}, ` +
    `tricky cases flagged ${score.trickyTriggered}/${(entry.trickyConsistent ?? []).length}` +
    `${result.missing.length ? `, READER MISSED: ${result.missing.join(', ')}` : ''}` +
    `${score.keyQuotesMissing ? `, KEY QUOTES NOT FOUND IN PDF: ${score.keyQuotesMissing}` : ''}`);
}

const total = totalScores(scores);
console.log(`\nCode checks: caught ${total.caught} of ${total.planted} planted mistakes, ${total.falseAlarms} false alarm(s), ` +
  `${total.trickyTriggered} tricky consistent case(s) flagged.`);
console.log('By kind (caught/planted):', Object.entries(total.byKind).map(([k, v]) => `${k} ${v.caught}/${v.planted}`).join(', '));
