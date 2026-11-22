// The shared AI loop, with Gemini Nano replaced by fake answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRows } from '../src/core/pdf-lines.js';
import { readCommonApp } from '../src/core/common-app.js';
import { checkInputFromPdf, runCodeChecks } from '../src/core/checks.js';
import { planComparisons } from '../src/core/ai-checks.js';
import { runAiChecks } from '../src/core/run-ai.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const app = checkInputFromPdf(readCommonApp(buildRows(readJson('./fixtures/michigan-items.json').pages)));
const codeFlags = runCodeChecks(app);
const quiet = { warn: console.warn };

test('asks once per planned pair, and a model that finds nothing gives no flags', async () => {
  let calls = 0;
  const run = await runAiChecks({
    app, codeFlags,
    ask: async () => { calls += 1; return { contradictions: [] }; },
    askMention: async () => ({ likelySlip: false }),
  });
  assert.equal(calls, planComparisons(app).length);
  assert.equal(run.comparisons, calls);
  assert.deepEqual(run.flags, []);
  assert.equal(run.failed, 0);
});

test('a failing comparison is counted, not fatal, and the others still run', async () => {
  console.warn = () => {}; // the loop logs the error name; keep test output clean
  try {
    let calls = 0;
    const run = await runAiChecks({
      app, codeFlags,
      ask: async () => { calls += 1; if (calls === 1) throw new Error('model busy'); return { contradictions: [] }; },
      askMention: async () => { throw new Error('model busy'); },
    });
    assert.equal(run.failed, 1);
    assert.equal(calls, run.comparisons);
    assert.equal(run.mentionAnswers.size, 0);
  } finally {
    console.warn = quiet.warn;
  }
});

test('an invented quote is dropped, never shown', async () => {
  const run = await runAiChecks({
    app, codeFlags,
    ask: async () => ({ contradictions: [{ kind: 'hours', activityQuote: 'twelve hours every single week', essayQuote: 'I never went to practice at all', explanation: 'x' }] }),
    askMention: async () => ({ likelySlip: false }),
  });
  assert.deepEqual(run.flags, []);
  assert.ok(run.dropped.length > 0);
});
