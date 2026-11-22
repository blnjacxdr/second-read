// Read a Common App preview PDF, run the code checks, and (on a computer with
// Gemini Nano) the on-device AI checks. Dev only: it turns on the App Check
// debug token, which must never be deployed.
self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;

import { readPdfRows } from '../src/pdf.js';
import { readCommonApp } from '../src/core/common-app.js';
import { countWords } from '../src/core/sections.js';
import { runCodeChecks, checkInputFromPdf } from '../src/core/checks.js';
import { planComparisons, aiFlagsFromAnswer, dedupeFlags, orderWithMentionAnswers } from '../src/core/ai-checks.js';
import { describeOnDeviceStatus, onDeviceAvailability } from '../src/core/privacy.js';
// src/ai.js (Firebase, loaded from Google's servers) is imported only when the AI
// button is clicked, so reading the PDF and the code checks work even where
// Google's servers are blocked or the computer is offline.

const $ = (id) => document.getElementById(id);
let current = null; // { result, app, codeFlags, aiFlags, aiNote }
let ai = null; // { models, ...functions } from src/ai.js, loaded on first use

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text; // textContent: file text is never treated as HTML
  if (className) node.className = className;
  return node;
}

function fieldList(fields) {
  const dl = el('dl');
  for (const [label, value] of fields) dl.append(el('dt', label), el('dd', String(value ?? '')));
  return dl;
}

function card(title, ...children) {
  const box = el('div', undefined, 'card');
  box.append(el('h3', title), ...children);
  return box;
}

/** A readable name for a section id, for the results view. */
function sectionLabel(result, sectionId) {
  const activity = result.activities.find((a) => a.id === sectionId);
  if (activity) return `Activity ${sectionId.split('-')[1]}: ${activity.category}`;
  const honor = result.honors.find((h) => h.id === sectionId);
  if (honor) return `Honor ${sectionId.split('-')[1]}`;
  const essay = result.collegeEssays.find((e) => e.id === sectionId);
  if (essay) return `${result.college} essay (${essay.group})`;
  return { 'personal-essay': 'Personal essay', 'additional-information': 'Additional information' }[sectionId] ?? sectionId;
}

function flagCard(result, flag) {
  const box = el('div', undefined, `card flag${flag.check === 'on-device' ? ' ai' : ''}`);
  const quotes = el('div', undefined, 'quotes');
  for (const citation of flag.citations) {
    const q = el('figure', undefined, 'quote');
    q.append(el('figcaption', sectionLabel(result, citation.sectionId)), el('blockquote', citation.quote));
    quotes.append(q);
  }
  const source = flag.check === 'on-device' ? 'Found by Gemini Nano on this computer' : 'Found by a code check (no AI)';
  box.append(el('h3', flag.title), el('p', flag.detail, 'muted'), quotes, el('p', source, 'source'));
  return box;
}

function essayCard(title, essay) {
  const paragraphs = essay.text.split('\n\n').map((p) => el('p', p, 'prose'));
  return card(`${title} (${countWords(essay.text)} words)`, el('p', essay.prompt ?? '(no prompt)', 'muted'), ...paragraphs);
}

/** Draws every flag: likely problems first, "looks intended" mentions folded at the end. */
function renderFlags() {
  const { result, codeFlags, aiFlags, aiNote, mentionAnswers, aiLog } = current;
  const all = orderWithMentionAnswers([...codeFlags, ...aiFlags], mentionAnswers ?? new Map());
  const main = all.filter((f) => f.mention !== 'background');
  const background = all.filter((f) => f.mention === 'background');
  const box = $('flags');
  box.replaceChildren(el('h2', `Things to check (${main.length})`));
  if (aiNote) box.append(el('p', aiNote, 'muted'));
  if (main.length === 0) box.append(el('p', 'Nothing to check.', 'ok'));
  for (const flag of main) box.append(flagCard(result, flag));
  if (background.length) {
    const fold = el('details');
    fold.append(el('summary', `${background.length} mention(s) that look intended`));
    for (const flag of background) fold.append(flagCard(result, flag));
    box.append(fold);
  }
  if (aiLog) {
    // Dev only: why each Gemini Nano answer was kept or not. Shown on this screen, never sent anywhere.
    const fold = el('details');
    fold.append(el('summary', `AI log (dev only): ${aiLog.length} entries`), el('pre', JSON.stringify(aiLog, null, 2)));
    box.append(fold);
  }
}

/** Enables the button where Gemini Nano is ready or can be downloaded (the button starts the download). */
async function updateAiButton() {
  const availability = await onDeviceAvailability();
  $('runAi').disabled = !current || !['available', 'downloadable', 'downloading'].includes(availability);
  return availability;
}

/** Shows Chrome's Gemini Nano status. Not called after a run, so a run's result or error stays visible. */
async function refreshAiStatus() {
  const status = describeOnDeviceStatus(await updateAiButton());
  $('aiStatus').textContent = status.message;
  $('aiStatus').className = status.canRun ? 'ok' : 'muted';
}

$('runAi').addEventListener('click', async () => {
  if (!current) return;
  const button = $('runAi');
  button.disabled = true;
  try {
    if (!ai) {
      $('aiStatus').textContent = 'Loading the AI connection…';
      const module = await import('../src/ai.js').catch(() => {
        throw new Error('Couldn\'t reach Google to load the AI connection. The code checks above still apply.');
      });
      ai = { ...module, models: module.createSecondReadAI() };
    }
    const { models, prepareOnDeviceModel, findContradictionsOnDevice, askMentionOnDevice } = ai;
    if ((await onDeviceAvailability()) !== 'available') {
      await prepareOnDeviceModel(models.privateModel, (f) => { $('aiStatus').textContent = `Downloading Gemini Nano: ${Math.round(f * 100)}%`; });
      if ((await onDeviceAvailability()) !== 'available') {
        $('aiStatus').textContent = 'Gemini Nano is not ready yet. Try again when the download finishes.';
        return;
      }
    }

    const plan = planComparisons(current.app);
    const started = performance.now();
    const kept = [];
    const dropped = [];
    const log = []; // dev only: every answer and what happened to it, shown on this screen only
    let failed = 0;
    for (const [i, pair] of plan.entries()) {
      $('aiStatus').textContent = `Comparing ${i + 1} of ${plan.length} on this computer…`;
      try {
        const answer = await findContradictionsOnDevice(models.privateModel, pair.itemText, pair.passage);
        const out = aiFlagsFromAnswer(pair, answer, current.app.sections);
        kept.push(...out.kept);
        dropped.push(...out.dropped);
        const pairName = `${pair.itemId} vs ${pair.essayId} (shared: ${pair.shared.join(', ')})`;
        if ((answer?.contradictions ?? []).length === 0) log.push({ pair: pairName, outcome: 'no contradiction reported' });
        for (const d of out.dropped) log.push({ pair: pairName, outcome: `dropped: ${d.reason}`, answer: d.contradiction });
        for (const f of out.kept) log.push({ pair: pairName, outcome: 'passed the quote check and guard', flagId: f.id, kind: f.kind, quotes: f.citations.map((c) => c.quote) });
      } catch (err) {
        failed += 1;
        console.warn('comparison failed:', err.name, err.message); // the error only, never the text
      }
    }

    const mentionAnswers = new Map();
    for (const flag of current.codeFlags.filter((f) => f.kind === 'other-college-name')) {
      $('aiStatus').textContent = `Reading the ${flag.mentionName} mention on this computer…`;
      try {
        mentionAnswers.set(flag.id, await askMentionOnDevice(models.mentionModel, flag.mentionName, flag.citations[0].quote));
      } catch (err) {
        console.warn('mention question failed:', err.name, err.message);
      }
    }

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    current.aiFlags = dedupeFlags(kept);
    current.aiLog = log;
    current.mentionAnswers = mentionAnswers;
    current.aiNote = `Gemini Nano made ${plan.length} comparisons on this computer in ${seconds} s. ` +
      `${current.aiFlags.length} flag(s) kept; ${dropped.length} answer(s) dropped because a quote wasn't in your application ` +
      `or didn't state the fact${failed ? `; ${failed} comparison(s) failed` : ''}.`;
    renderFlags();
    $('aiStatus').textContent = `Done: ${current.aiFlags.length} AI flag(s). Details above the flags.`;
    $('aiStatus').className = 'ok';
  } catch (err) {
    $('aiStatus').textContent = `AI check stopped: ${err.message}`;
    $('aiStatus').className = 'bad';
    console.error('AI check stopped:', err); // full error in DevTools > Console for debugging
  } finally {
    await updateAiButton().catch(() => {});
  }
});

$('file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $('status').textContent = `Reading ${file.name}…`;
  $('status').className = 'muted';
  const started = performance.now();
  try {
    const { pageCount, rows } = await readPdfRows(file);
    const result = readCommonApp(rows);
    const ms = Math.round(performance.now() - started);

    const found = `${result.activities.length} activities, ${result.honors.length} honors, ` +
      `${result.personalEssay ? 'the personal essay' : 'no personal essay'} and ` +
      `${result.collegeEssays.length} essay(s) for ${result.college ?? 'an unknown college'}`;
    $('status').textContent = result.missing.length
      ? `Read ${pageCount} pages in ${ms} ms. Found ${found}, but could not find: ${result.missing.join(', ')}. Is this a Common App preview PDF?`
      : `Read ${pageCount} pages in ${ms} ms. Found ${found}.`;
    $('status').className = result.missing.length ? 'bad' : 'ok';

    const app = checkInputFromPdf(result);
    current = { result, app, codeFlags: runCodeChecks(app), aiFlags: [], aiNote: null, mentionAnswers: null };
    renderFlags();
    await refreshAiStatus();

    const out = $('out');
    out.replaceChildren();

    out.append(el('h2', `Activities (${result.activities.length})`));
    for (const a of result.activities) {
      out.append(card(`${a.id}: ${a.category}`, fieldList([
        ['Organization, position', a.heading],
        ['Description', `${a.description} (${a.description.length} characters)`],
        ['Grades', (a.grades ?? []).join(', ')], ['Timing', a.timing],
        ['Hours per week', a.hoursPerWeek], ['Weeks per year', a.weeksPerYear], ['Plans', a.plans ?? '(none selected)'],
      ])));
    }

    out.append(el('h2', `Honors (${result.honors.length})`));
    for (const h of result.honors) {
      out.append(card(h.id, fieldList([['Title', h.title], ['Level', h.level], ['Grades', h.grades.join(', ')]])));
    }

    out.append(el('h2', 'Common App writing'));
    if (result.personalEssay) out.append(essayCard('Personal essay', result.personalEssay));
    if (result.additionalInformation) out.append(essayCard('Additional information', result.additionalInformation));

    out.append(el('h2', `${result.college ?? 'College'} questions`));
    for (const essay of result.collegeEssays) out.append(essayCard(`${essay.id} (${essay.group})`, essay));
    if (result.collegeAnswers.length) {
      out.append(card(`Short answers (${result.collegeAnswers.length})`,
        fieldList(result.collegeAnswers.map((a) => [`${a.group}: ${a.label}`, a.values.join(' | ')]))));
    }
  } catch (err) {
    $('status').textContent = `Could not read this PDF: ${err.message}`;
    $('status').className = 'bad';
  }
});

refreshAiStatus();
