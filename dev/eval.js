// Scores Second Read on the held-out test set, Gemini Nano included.
// Dev only (App Check debug token). Shows NUMBERS ONLY: the held-out
// applications are never displayed, so whoever tunes the checks can't
// tune them to these particular applications.
self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;

import { readPdfRows } from '../src/pdf.js';
import { readCommonApp } from '../src/core/common-app.js';
import { runCodeChecks, checkInputFromPdf } from '../src/core/checks.js';
import { runAiChecks } from '../src/core/run-ai.js';
import { scoreApplication, totalScores } from '../src/core/eval.js';
import { onDeviceAvailability } from '../src/core/privacy.js';

const RUNS = 3; // Gemini Nano answers differently run to run, so one run proves little
const $ = (id) => document.getElementById(id);
const say = (text) => { $('status').textContent = text; };

const line = (label, t) =>
  `${label}: caught ${t.caught}/${t.planted}, false alarms ${t.falseAlarms}, tricky cases flagged ${t.trickyTriggered}`;
const kinds = (t) => Object.entries(t.byKind).map(([k, v]) => `${k} ${v.caught}/${v.planted}`).join(', ');

$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  const report = [];
  try {
    if ((await onDeviceAvailability()) !== 'available') throw new Error('Gemini Nano is not ready in this Chrome.');
    const key = await (await fetch('../eval/heldout/answer-key.json')).json();

    // Read every PDF once.
    const apps = [];
    for (const entry of key.applications) {
      const pdf = entry.file.replace('.json', '.pdf');
      say(`Reading ${pdf}…`);
      const response = await fetch(`../eval/heldout/${pdf}`);
      if (!response.ok) throw new Error(`${pdf} not found. Run "npm run eval" once to build the PDFs.`);
      const result = readCommonApp((await readPdfRows(await response.blob())).rows);
      const app = checkInputFromPdf(result);
      apps.push({ entry, result, app, codeFlags: runCodeChecks(app) });
    }

    const codeTotal = totalScores(apps.map((a) => scoreApplication(a.codeFlags, a.entry, a.result.sections)));
    report.push(line('Code checks only', codeTotal), `  by kind: ${kinds(codeTotal)}`);
    if (codeTotal.keyQuotesMissing) report.push(`  WARNING: ${codeTotal.keyQuotesMissing} answer-key quote(s) not found in the PDFs`);

    const module = await import('../src/ai.js');
    const models = module.createSecondReadAI();
    const runTotals = [];
    let seconds = 0;
    let failed = 0;
    for (let r = 1; r <= RUNS; r++) {
      const scores = [];
      for (const [i, a] of apps.entries()) {
        const started = performance.now();
        const run = await runAiChecks({
          app: a.app,
          codeFlags: a.codeFlags,
          compare: (itemText, passage) => module.findContradictionsOnDevice(models.privateModel, itemText, passage),
          askMention: async () => null, // mention ordering never hides a flag, so it doesn't change the score
          onProgress: (m) => say(`Run ${r} of ${RUNS}, application ${i + 1} of ${apps.length}: ${m}`),
        });
        seconds += (performance.now() - started) / 1000;
        failed += run.failed;
        scores.push(scoreApplication([...a.codeFlags, ...run.flags], a.entry, a.result.sections));
      }
      const t = totalScores(scores);
      runTotals.push(t);
      report.push(line(`Code + AI, run ${r}`, t), `  by kind: ${kinds(t)}`);
      $('out').textContent = report.join('\n');
    }

    const avg = (field) => (runTotals.reduce((s, t) => s + t[field], 0) / RUNS).toFixed(1);
    report.push(
      `Average over ${RUNS} runs: caught ${avg('caught')}/${codeTotal.planted}, false alarms ${avg('falseAlarms')}, tricky ${avg('trickyTriggered')}`,
      `AI time: ${(seconds / RUNS).toFixed(0)} s per run for ${apps.length} applications${failed ? `; ${failed} comparison(s) failed` : ''}`,
    );
    say('Done. Copy the numbers below and paste them into the chat.');
  } catch (err) {
    say(`Stopped: ${err.message}`);
    console.error(err);
  } finally {
    $('out').textContent = report.join('\n');
    $('run').disabled = false;
  }
});
