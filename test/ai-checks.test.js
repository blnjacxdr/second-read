// On-device AI checks, without the AI: Gemini Nano's answers are stubbed with
// the kinds of answers it really gave on Nov 20, good and bad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRows } from '../src/core/pdf-lines.js';
import { readCommonApp } from '../src/core/common-app.js';
import { checkInputFromPdf, runCodeChecks } from '../src/core/checks.js';
import {
  planComparisons, aiFlagsFromAnswer, passesKindGuard, dedupeFlags, mentionPrompt, orderWithMentionAnswers, MAX_COMPARISONS,
} from '../src/core/ai-checks.js';
import { verifyQuote } from '../src/core/quotes.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const key = readJson('../sample/expected-flags.json');
const michigan = readCommonApp(buildRows(readJson('./fixtures/michigan-items.json').pages));
const app = checkInputFromPdf(michigan);
const plan = planComparisons(app);
const pairFor = (itemId, essayId, words) =>
  plan.find((p) => p.itemId === itemId && p.essayId === essayId && words.every((w) => p.passage.includes(w)));

test('the plan includes every planted on-device mistake\'s pair', () => {
  const toPdf = (id) => (id === 'supplement-michigan' ? 'college-essay-1' : id);
  for (const flag of key.flags.filter((f) => f.check === 'device' && f.inPdfs.includes('michigan'))) {
    const [item, essay] = flag.citations;
    assert.ok(pairFor(item.sectionId, toPdf(essay.sectionId), [essay.quote.slice(0, 20)]), flag.id);
  }
});

test('the plan is capped and pairs only items and paragraphs that share a distinctive word', () => {
  assert.ok(plan.length <= MAX_COMPARISONS);
  for (const pair of plan) assert.ok(pair.shared.length > 0);
  // "FIRST" in "FIRST Robotics" is an everyday word: it must not link the robotics activity to every paragraph.
  assert.equal(plan.some((p) => p.itemId === 'activity-2' && p.passage.startsWith('On Saturday')), false);
});

test('a good answer becomes a flag that shows the student\'s own words', () => {
  const pair = pairFor('activity-2', 'personal-essay', ['Every day after school']);
  // As Gemini Nano answered on Nov 20: lowercase first letter, period where the essay has a comma.
  const answer = { contradictions: [{ kind: 'hours', activityQuote: '6 hr/wk, 30 wk/yr', essayQuote: 'every day after school, I stayed in the robotics lab until seven.' }] };
  const { kept, dropped } = aiFlagsFromAnswer(pair, answer, app.sections);
  assert.equal(dropped.length, 0);
  assert.equal(kept[0].citations[1].quote, 'Every day after school, I stayed in the robotics lab until seven');
  for (const c of kept[0].citations) assert.equal(verifyQuote(app.sections, c), true);
});

test('real quotes that don\'t both state the fact are dropped (the Nov 20 false alarm)', () => {
  const pair = pairFor('activity-2', 'personal-essay', ['Every day after school']);
  const answer = { contradictions: [{ kind: 'dates', activityQuote: '10, 11, 12 (School)', essayQuote: 'That night I did what I always do.' }] };
  const { kept, dropped } = aiFlagsFromAnswer(pair, answer, app.sections);
  assert.deepEqual(kept, []);
  assert.match(dropped[0].reason, /don't both mention dates/);
});

test('invented quotes and the vague "other" kind are dropped', () => {
  const pair = pairFor('activity-2', 'personal-essay', ['Every day after school']);
  const answer = { contradictions: [
    { kind: 'hours', activityQuote: '6 hr/wk, 30 wk/yr', essayQuote: 'I practiced every single night' },
    { kind: 'other', activityQuote: '6 hr/wk, 30 wk/yr', essayQuote: 'Every day after school, I stayed in the robotics lab' },
  ] };
  const { kept, dropped } = aiFlagsFromAnswer(pair, answer, app.sections);
  assert.deepEqual(kept, []);
  assert.deepEqual(dropped.map((d) => d.reason), ['quote not found in the application', "quotes don't both mention a specific fact"]);
});

test('kind guards: each kind needs its kind of fact on both sides', () => {
  assert.equal(passesKindGuard('role', 'Varsity Soccer, Varsity Co-Captain', 'As captain of the varsity soccer team'), true);
  assert.equal(passesKindGuard('role', 'Varsity Soccer, Varsity Co-Captain', 'I love the varsity soccer team'), false);
  assert.equal(passesKindGuard('award', 'State Science Fair, 2nd Place', 'The project won first place at the state science fair'), true);
  assert.equal(passesKindGuard('award', 'State Science Fair, 2nd Place', 'I presented at the state science fair'), false);
  assert.equal(passesKindGuard('hours', '6 hr/wk, 30 wk/yr', 'I stayed in the robotics lab'), false);
  assert.equal(passesKindGuard('unknown', 'a b c', 'd e f'), false);
});

test('a null or malformed answer produces no flags', () => {
  const pair = plan[0];
  assert.deepEqual(aiFlagsFromAnswer(pair, null, app.sections), { kept: [], dropped: [] });
  assert.deepEqual(aiFlagsFromAnswer(pair, {}, app.sections), { kept: [], dropped: [] });
});

test('dedupeFlags removes the same flag found twice', () => {
  assert.deepEqual(dedupeFlags([{ id: 'a' }, { id: 'b' }, { id: 'a' }]).map((f) => f.id), ['a', 'b']);
});

test('mention prompt holds only the college name and the one sentence', () => {
  const prompt = mentionPrompt('Northwestern', 'That is the kind of community I hope to find at Northwestern.');
  assert.match(prompt, /SENTENCE:\nThat is the kind of community I hope to find at Northwestern\.$/);
});

test('mention answers reorder flags but never remove one', () => {
  const flags = [
    { id: 'x', kind: 'dates' },
    { id: 'mit', kind: 'other-college-name', detail: 'd' },
    { id: 'nw', kind: 'other-college-name', detail: 'd' },
    { id: 'yale', kind: 'other-college-name', detail: 'd' }, // no answer: Gemini Nano unavailable or failed
  ];
  const ordered = orderWithMentionAnswers(flags, new Map([['mit', false], ['nw', true]]));
  assert.deepEqual(ordered.map((f) => f.id), ['nw', 'x', 'yale', 'mit']);
  assert.equal(ordered[0].mention, 'likely-slip');
  assert.equal(ordered.at(-1).mention, 'background');
  assert.equal(ordered.length, flags.length);
});

test('the Michigan sample\'s other-college flag is the one the mention question will see', () => {
  const flag = runCodeChecks(app).find((f) => f.kind === 'other-college-name');
  assert.equal(flag.citations[0].quote, 'That is the kind of community I hope to find at Northwestern.');
});
