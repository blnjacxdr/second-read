// Scores Second Read on fictional test sets (eval/<set>/), with Gemini Nano or in the cloud.
// Dev only (App Check debug token). Shows NUMBERS ONLY by default, so whoever tunes the checks can't tune them to
// these particular applications. The optional false-alarm list (practice sets only) is for the person running it.
self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;

import { readPdfRows } from '../src/pdf.js';
import { readCommonApp } from '../src/core/common-app.js';
import { runCodeChecks, checkInputFromPdf } from '../src/core/checks.js';
import { runAiChecks } from '../src/core/run-ai.js';
import { scoreApplication, totalScores } from '../src/core/eval.js';
import { onDeviceAvailability } from '../src/core/privacy.js';
import { createSentLog } from '../src/core/sent-log.js';
import { wholeReadFlags } from '../src/core/whole-read.js';

const NANO_RUNS = 3; // Gemini Nano answers differently run to run, so one run proves little
const CLOUD_AT_ONCE = 4; // applications read in parallel in the cloud; Nano reads one at a time
const REVIEW_VARIANT = 'G'; // the false-alarm list shows this setup's false alarms
// Gemini 3.5 Flash list prices (USD per million tokens), for a rough cost line. Thinking bills as output.
const PRICE = { input: 1.5, output: 9 };

// A choice in the Test set menu can stand for several folders.
const GROUPS = {
  practice: ['practice-1', 'practice-2', 'practice-3'],
  final: ['final-1', 'final-2'],
};
const isFinal = (folder) => folder.startsWith('final');
const canReview = (folder) => folder === 'fresh' || folder.startsWith('practice');

// Nov 24, practice-1: the check step removed more real catches than false alarms, so it's no longer run here
// (verifyConsented stays in src/ai.js). Two independent reads are compared instead: each read misses different things.
const VARIANTS = {
  A: 'A original read',
  B: 'B data first',
  C: 'C data first + second look',
  G: 'G = A and B together (two reads)',
  H: 'H = A and C together (three reads)',
};

// Why Gemini's answers were thrown away (counts only), across every read in a run. "quote not found" means Gemini
// spotted something but didn't copy the words exactly, so the quote check dropped it.
let dropReasons = {};

const $ = (id) => document.getElementById(id);
const say = (text) => { $('status').textContent = text; };
const line = (label, t) =>
  `${label}: caught ${t.caught}/${t.planted}${t.caughtBySectionOnly ? ` (${t.caughtBySectionOnly} by section only)` : ''}, false alarms ${t.falseAlarms}, tricky cases flagged ${t.trickyTriggered}`;
const kinds = (t) => Object.entries(t.byKind).map(([k, v]) => `${k} ${v.caught}/${v.planted}`).join(', ') +
  `\n  false alarms by check: ${Object.entries(t.falseAlarmKinds).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`;

/** Runs task(item, index) over items, at most `limit` at a time, keeping results in order. */
async function pool(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Reads every PDF in the chosen folders once. */
async function loadApplications(folders) {
  const apps = [];
  for (const folder of folders) {
    const response = await fetch(`../eval/${folder}/answer-key.json`);
    if (!response.ok) throw new Error(`eval/${folder}/answer-key.json not found.`);
    const key = await response.json();
    for (const entry of key.applications) {
      const pdf = entry.file.replace('.json', '.pdf');
      say(`Reading ${folder}/${pdf}…`);
      const file = await fetch(`../eval/${folder}/${pdf}`);
      if (!file.ok) throw new Error(`${folder}/${pdf} not found. Run "node eval/score.mjs ${folder}" once to build the PDFs.`);
      const result = readCommonApp((await readPdfRows(await file.blob())).rows);
      const app = checkInputFromPdf(result);
      apps.push({ folder, entry: { ...entry, file: `${folder}/${entry.file}` }, result, app, codeFlags: runCodeChecks(app) });
    }
  }
  return apps;
}

/** One application in the cloud: every setup in VARIANTS from the same answers. */
async function cloudVariants(module, hybrid, sentLog, a, base, onFail) {
  const ask = (opts) => module.wholeReadConsented(hybrid, sentLog, a.app, opts).catch((err) => { onFail(err); return null; });
  const flagsFrom = (answer, existing) => {
    const out = wholeReadFlags(answer, a.app.sections, existing);
    for (const d of out.dropped) dropReasons[d.reason] = (dropReasons[d.reason] ?? 0) + 1;
    return out.kept;
  };
  const [answerA, answerB] = await Promise.all([ask({ layout: 'instructions-first' }), ask({ layout: 'data-first' })]);
  const flagsA = flagsFrom(answerA, base);
  const flagsB = flagsFrom(answerB, base);
  const answerC = await ask({ layout: 'data-first', alreadyFound: flagsB });
  const flagsC = [...flagsB, ...flagsFrom(answerC, [...base, ...flagsB])];
  const flagsG = [...flagsA, ...flagsFrom(answerB, [...base, ...flagsA])];
  const flagsH = [...flagsG, ...flagsFrom(answerC, [...base, ...flagsG])];
  return { A: flagsA, B: flagsB, C: flagsC, G: flagsG, H: flagsH };
}

$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  const choice = $('set').value;
  const folders = GROUPS[choice] ?? [choice];
  const engine = $('engine').value;
  const report = [`Set: ${choice}. Engine: ${engine === 'cloud' ? 'Gemini in the cloud' : 'Gemini Nano'}.`];
  const toReview = [];
  dropReasons = {};
  try {
    if (folders.some(isFinal) && !window.confirm('This is the FINAL test set. Run it only once, after the feature freeze. Run it now?')) {
      throw new Error('not run.');
    }
    const nano = (await onDeviceAvailability()) === 'available';
    if (engine === 'nano' && !nano) throw new Error('Gemini Nano is not ready in this browser.');
    if (engine === 'cloud' && nano) throw new Error('This browser has Gemini Nano, so the hybrid models would stay on the device. Open this page in a browser without it (Opera GX) to test the cloud.');

    const apps = await loadApplications(folders);
    const codeTotal = totalScores(apps.map((a) => scoreApplication(a.codeFlags, a.entry, a.result.sections)));
    report.push(`${apps.length} applications.`, line('Code checks only', codeTotal), `  by kind: ${kinds(codeTotal)}`);
    $('out').textContent = report.join('\n');

    const module = await import('../src/ai.js');
    const models = module.createSecondReadAI();
    const sentLog = createSentLog();
    const hybrid = engine === 'cloud' ? module.createConsentedHybridModels(models) : null;
    const skipNarrow = hybrid && $('skip-narrow').checked;
    const runs = hybrid ? 1 : NANO_RUNS;
    let failed = 0;
    let done = 0;
    const onFail = (err) => { failed += 1; console.warn(err.message); };
    const started = performance.now();

    for (let r = 1; r <= runs; r++) {
      const results = await pool(apps, hybrid ? CLOUD_AT_ONCE : 1, async (a) => {
        const run = skipNarrow ? { flags: [], failed: 0 } : await runAiChecks({
          app: a.app,
          codeFlags: a.codeFlags,
          ask: hybrid ? module.consentedAsker(hybrid, sentLog) : module.onDeviceAsker(models),
          design: 'extract',
          askMention: async () => null, // mention ordering never hides a flag, so it doesn't change the score
        });
        failed += run.failed;
        const base = [...a.codeFlags, ...run.flags];
        const out = { narrow: scoreApplication(base, a.entry, a.result.sections), variants: {} };
        if (hybrid) {
          const variants = await cloudVariants(module, hybrid, sentLog, a, base, onFail);
          for (const [k, extra] of Object.entries(variants)) out.variants[k] = scoreApplication([...base, ...extra], a.entry, a.result.sections);
        }
        done += 1;
        say(`Run ${r} of ${runs}: ${done - (r - 1) * apps.length} of ${apps.length} applications done…`);
        return out;
      });

      if (!skipNarrow) {
        const t = totalScores(results.map((x) => x.narrow));
        report.push(line(`Code + narrow questions, run ${r}`, t), `  by kind: ${kinds(t)}`);
      }
      for (const [k, label] of Object.entries(hybrid ? VARIANTS : {})) {
        const w = totalScores(results.map((x) => x.variants[k]));
        report.push(line(`Code + ${label}`, w), `  by kind: ${kinds(w)}`);
      }
      if (r === runs) {
        results.forEach((x, i) => {
          const scored = hybrid ? x.variants[REVIEW_VARIANT] : x.narrow;
          if (canReview(apps[i].folder)) toReview.push(...scored.wrongFlags.map((f) => ({ file: apps[i].entry.file, flag: f })));
        });
      }
      $('out').textContent = report.join('\n');
    }

    const seconds = (performance.now() - started) / 1000;
    report.push(`AI time: ${seconds.toFixed(0)} s in all for ${apps.length} applications${failed ? `; ${failed} AI call(s) failed` : ''}`);
    if (hybrid) {
      const u = sentLog.usage();
      const dollars = (u.input * PRICE.input + u.output * PRICE.output) / 1e6;
      report.push(`Cloud: ${u.calls} prompts, ${u.input.toLocaleString()} input + ${u.output.toLocaleString()} output tokens, ` +
        `about $${dollars.toFixed(2)} for this run (about $${(dollars / apps.length).toFixed(3)} per application for 3 reads; one read is about a third)`);
    }
    if (hybrid) report.push(`Gemini answers thrown away (all reads): ${Object.entries(dropReasons).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
    if ($('review').checked) showReview(toReview);
    say('Done. Copy the numbers below and paste them into the chat.');
  } catch (err) {
    say(`Stopped: ${err.message}`);
    console.error(err);
  } finally {
    $('out').textContent = report.join('\n');
    $('run').disabled = false;
  }
});

/** The false alarms, for the person running the page to judge. Practice sets only. */
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
