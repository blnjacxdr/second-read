// Scores Second Read on a fictional test set (eval/fresh or eval/heldout), with Gemini Nano or in the cloud.
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
import { createSentLog } from '../src/core/sent-log.js';
import { wholeReadFlags } from '../src/core/whole-read.js';

const RUNS = 3; // Gemini Nano answers differently run to run, so one run proves little
const $ = (id) => document.getElementById(id);
const say = (text) => { $('status').textContent = text; };

const line = (label, t) =>
  `${label}: caught ${t.caught}/${t.planted}, false alarms ${t.falseAlarms}, tricky cases flagged ${t.trickyTriggered}`;
const kinds = (t) => Object.entries(t.byKind).map(([k, v]) => `${k} ${v.caught}/${v.planted}`).join(', ') +
  `\n  false alarms by check: ${Object.entries(t.falseAlarmKinds).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`;

$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  const set = $('set').value;
  const engine = $('engine').value;
  const report = [`Set: ${set}. Engine: ${engine === 'cloud' ? 'Gemini in the cloud' : 'Gemini Nano'}.`];
  try {
    const nano = (await onDeviceAvailability()) === 'available';
    if (engine === 'nano' && !nano) throw new Error('Gemini Nano is not ready in this browser.');
    if (engine === 'cloud' && nano) throw new Error('This browser has Gemini Nano, so the hybrid models would stay on the device. Open this page in a browser without it (Opera GX) to test the cloud.');
    const key = await (await fetch(`../eval/${set}/answer-key.json`)).json();

    // Read every PDF once.
    const apps = [];
    for (const entry of key.applications) {
      const pdf = entry.file.replace('.json', '.pdf');
      say(`Reading ${pdf}…`);
      const response = await fetch(`../eval/${set}/${pdf}`);
      if (!response.ok) throw new Error(`${pdf} not found. Run "node eval/score.mjs ${set}" once to build the PDFs.`);
      const result = readCommonApp((await readPdfRows(await response.blob())).rows);
      const app = checkInputFromPdf(result);
      apps.push({ entry, result, app, codeFlags: runCodeChecks(app) });
    }

    const codeTotal = totalScores(apps.map((a) => scoreApplication(a.codeFlags, a.entry, a.result.sections)));
    report.push(line('Code checks only', codeTotal), `  by kind: ${kinds(codeTotal)}`);

    const module = await import('../src/ai.js');
    const models = module.createSecondReadAI();
    const sentLog = createSentLog();
    const hybrid = engine === 'cloud' ? module.createConsentedHybridModels(models) : null;
    const runs = engine === 'cloud' ? 1 : RUNS;
    let seconds = 0;
    let failed = 0;
    const toReview = [];
    for (let r = 1; r <= runs; r++) {
      const narrow = [];
      const withWhole = [];
      for (const [i, a] of apps.entries()) {
        const started = performance.now();
        const skipNarrow = hybrid && $('skip-narrow').checked;
        const run = skipNarrow ? { flags: [], failed: 0 } : await runAiChecks({
          app: a.app,
          codeFlags: a.codeFlags,
          ask: hybrid ? module.consentedAsker(hybrid, sentLog) : module.onDeviceAsker(models),
          design: 'extract',
          askMention: async () => null, // mention ordering never hides a flag, so it doesn't change the score
          onProgress: (m) => say(`Run ${r} of ${runs}, application ${i + 1} of ${apps.length}: ${m}`),
        });
        failed += run.failed;
        const base = [...a.codeFlags, ...run.flags];
        narrow.push(scoreApplication(base, a.entry, a.result.sections));
        if (hybrid) {
          say(`Run ${r}, application ${i + 1} of ${apps.length}: reading it all together…`);
          const whole = await module.wholeReadConsented(hybrid, sentLog, a.app).catch((err) => { failed += 1; console.warn(err.message); return null; });
          const extra = wholeReadFlags(whole, a.app.sections, base).kept;
          const scored = scoreApplication([...base, ...extra], a.entry, a.result.sections);
          withWhole.push(scored);
          if (r === runs) toReview.push(...scored.wrongFlags.map((f) => ({ file: a.entry.file, flag: f })));
        }
        if (!hybrid && r === runs) {
          toReview.push(...narrow.at(-1).wrongFlags.map((f) => ({ file: a.entry.file, flag: f })));
        }
        seconds += (performance.now() - started) / 1000;
      }
      const t = totalScores(narrow);
      report.push(line(`Code + narrow questions, run ${r}`, t), `  by kind: ${kinds(t)}`);
      if (hybrid) {
        const w = totalScores(withWhole);
        report.push(line(`Code + narrow + whole read, run ${r}`, w), `  by kind: ${kinds(w)}`);
      }
      $('out').textContent = report.join('\n');
    }
    report.push(`AI time: ${(seconds / runs).toFixed(0)} s per run for ${apps.length} applications${failed ? `; ${failed} AI call(s) failed` : ''}` +
      (hybrid ? `; ${sentLog.entries().length} prompts sent to the cloud` : ''));
    if ($('review').checked && set === 'fresh') showReview(toReview);
    say('Done. Copy the numbers below and paste them into the chat.');
  } catch (err) {
    say(`Stopped: ${err.message}`);
    console.error(err);
  } finally {
    $('out').textContent = report.join('\n');
    $('run').disabled = false;
  }
});

/** The false alarms, for the person running the page to judge. Fresh set only: held-out text is never shown. */
function showReview(items) {
  const list = $('review-list');
  list.replaceChildren();
  for (const { file, flag } of items) {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.textContent = `${file}: ${flag.title} (${flag.check === 'on-device' ? 'Gemini' : 'code'})`;
    li.append(head);
    for (const c of flag.citations ?? []) {
      const q = document.createElement('q');
      q.textContent = `${c.sectionId}: ${c.quote}`;
      li.append(q);
    }
    if (flag.detail) {
      const why = document.createElement('div');
      why.textContent = `Why: ${flag.detail}`;
      li.append(why);
    }
    list.append(li);
  }
  $('review-box').hidden = items.length === 0;
}
