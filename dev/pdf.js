// Read a Common App preview PDF, run the code checks, and (on a computer with
// Gemini Nano) the on-device AI checks. Dev only: it turns on the App Check
// debug token, which must never be deployed.
self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;

import { readPdfRows } from '../src/pdf.js';
import { readCommonApp } from '../src/core/common-app.js';
import { countWords } from '../src/core/sections.js';
import { runCodeChecks, checkInputFromPdf } from '../src/core/checks.js';
import { orderWithMentionAnswers } from '../src/core/ai-checks.js';
import { runAiChecks, findPublicNames } from '../src/core/run-ai.js';
import { layoutReport, isImageOnlyPdf, IMAGE_ONLY_MESSAGE } from '../src/core/layout-report.js';
import { describeOnDeviceStatus, onDeviceAvailability } from '../src/core/privacy.js';
import { cloudQuestions, placeConflicts, answerStatus } from '../src/core/cloud-names.js';
import { createSentLog } from '../src/core/sent-log.js';
// src/ai.js (Firebase, loaded from Google's servers) is imported only when the AI
// button is clicked, so reading the PDF and the code checks work even where
// Google's servers are blocked or the computer is offline.

const $ = (id) => document.getElementById(id);
let current = null; // { result, app, codeFlags, aiFlags, aiNote }
let ai = null; // { models, ...functions } from src/ai.js, loaded on first use
let questions = []; // cloud fact-check questions for the current PDF
const sentLog = createSentLog(); // every string sent to the cloud, recorded before sending

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
  $('findNames').disabled = !current;
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

    const started = performance.now();
    const run = await runAiChecks({
      app: current.app,
      codeFlags: current.codeFlags,
      ask: ai.onDeviceAsker(models),
      design: 'extract', // held-out, Nov 22: 3.0 caught / 3.7 false alarms vs 3.7 / 7.3 for 'open'
      askMention: (name, sentence) => askMentionOnDevice(models.mentionModel, name, sentence),
      onProgress: (message) => { $('aiStatus').textContent = message; },
    });
    const { dropped, failed } = run;
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    current.aiFlags = run.flags;
    current.aiLog = run.log;
    current.mentionAnswers = run.mentionAnswers;
    current.aiNote = `Gemini Nano made ${run.comparisons} comparisons on this computer in ${seconds} s. ` +
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

// Dev only: shows which public names would be offered for the cloud fact-check.
// Uses Gemini Nano when it's ready; otherwise the code part alone. Sends nothing.
$('findNames').addEventListener('click', async () => {
  if (!current) return;
  $('findNames').disabled = true;
  try {
    let askNames;
    if ((await onDeviceAvailability()) === 'available') {
      if (!ai) {
        const module = await import('../src/ai.js');
        ai = { ...module, models: module.createSecondReadAI() };
      }
      askNames = (text) => ai.findNamesOnDevice(ai.models.namesModel, text);
    }
    const out = await findPublicNames({ result: current.result, askNames, onProgress: (m) => { $('namesStatus').textContent = m; } });
    const list = el('ul');
    for (const n of out.names) {
      list.append(el('li', `${n.defaultOn ? '[x]' : '[ ]'} ${n.name} (${n.kind}, found by ${n.source}, in ${n.sectionIds.join(', ')}${n.why ? `; unticked: ${n.why}` : ''})`));
    }
    const droppedList = el('ul');
    for (const d of out.dropped) droppedList.append(el('li', `${d.name}: ${d.reason}`, 'muted'));
    $('names').replaceChildren(card(`${out.names.length} public name(s) offered, ${out.names.filter((n) => n.defaultOn).length} ticked`, list), card(`${out.dropped.length} left out`, droppedList));
    renderQuestions(cloudQuestions(out.names, { college: current.result.college }));
    $('namesStatus').textContent = askNames
      ? `Done, with Gemini Nano on this computer${out.failed ? ` (${out.failed} search(es) failed)` : ''}.`
      : 'Done, code only (Gemini Nano is not ready on this computer).';
  } catch (err) {
    $('namesStatus').textContent = `Stopped: ${err.message}`;
    console.error(err);
  } finally {
    $('findNames').disabled = false;
  }
});

// ---- Cloud fact-check (dev). Only the ticked questions are sent; each prompt is in the sent log first. ----

async function loadAi() {
  if (!ai) {
    const module = await import('../src/ai.js');
    ai = { ...module, models: module.createSecondReadAI() };
  }
  return ai;
}

function renderQuestions(list) {
  questions = list;
  const box = $('questions');
  box.replaceChildren();
  for (const q of questions) {
    const label = el('label');
    const tick = el('input');
    tick.type = 'checkbox'; tick.checked = q.defaultOn; tick.dataset.id = String(q.id);
    const text = q.kind === 'partOf' ? `Is ${q.name} part of ${q.college}?` : `Look up ${q.name}`;
    label.append(tick, ` ${text}${q.why ? ` (unticked: ${q.why})` : ''}`);
    box.append(el('div'), label);
  }
  $('cloudBox').hidden = questions.length === 0;
  $('cloudAnswers').replaceChildren(); $('sources').replaceChildren();
  $('cloudStatus').textContent = `${questions.length} question(s), ${questions.filter((q) => q.defaultOn).length} ticked.`;
}

function renderSentLog() {
  const entries = sentLog.entries();
  $('sentLog').replaceChildren(...(entries.length ? entries.map((e) => card(`${e.purpose} (${e.at})`, el('pre', e.text))) : [el('span', 'Nothing yet.')]));
}

async function runCloud(withSearch) {
  const ticked = new Set([...$('questions').querySelectorAll('input:checked')].map((t) => Number(t.dataset.id)));
  // Renumber 1..n so the prompt only shows what's sent; map back by name and kind.
  const send = questions.filter((q) => ticked.has(q.id)).map((q, i) => ({ ...q, id: i + 1 }));
  if (send.length === 0) { $('cloudStatus').textContent = 'Nothing ticked, nothing sent.'; return; }
  $('cloudSearch').disabled = $('cloudNoSearch').disabled = true;
  $('cloudStatus').textContent = `Sending ${send.length} question(s)…`;
  try {
    const { models, checkNamesInCloud } = await loadAi();
    const model = withSearch ? models.publicModel : models.publicModelWithoutSearch;
    const answer = await checkNamesInCloud(model, send, sentLog, { withSearch });
    renderSentLog();
    const rows = el('ul');
    for (const q of send) {
      const a = answer.answers.find((x) => x.id === q.id);
      const conflicts = a ? placeConflicts(q, a, current.result.sections) : [];
      const status = answerStatus(q, a, conflicts);
      const ask = q.kind === 'partOf' ? `Is ${q.name} part of ${q.college}?` : q.name;
      const said = a ? [a.verdict, a.official, a.place, a.fact].filter(Boolean).join(' | ') : 'no answer';
      const extra = conflicts.length ? ` You wrote ${conflicts.map((c) => c.written).join(', ')} next to it.` : '';
      rows.append(el('li', `[${status}] ${ask}: ${said}.${extra}`, status === 'look' ? 'bad' : status === 'fine' ? 'ok' : 'muted'));
    }
    const leftover = answer.leftover.length ? [el('p', 'Lines we could not place:', 'muted'), el('pre', answer.leftover.join('\n'))] : [];
    $('cloudAnswers').replaceChildren(card(`Answers (${answer.inferenceSource}, ${answer.grounded ? 'grounded with Google Search' : 'not grounded, no sources'})`, rows, ...leftover));
    // Required by Google for grounded answers: show the search suggestions exactly as sent (in a shadow root
    // so their styles stay contained) and the sources.
    const host = $('suggestions');
    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.innerHTML = answer.searchSuggestionsHtml || '';
    const sources = el('ul');
    for (const source of answer.sources) {
      const li = el('li'); const link = el('a', source.title);
      link.href = source.uri; link.target = '_blank'; link.rel = 'noopener noreferrer';
      li.append(link); sources.append(li);
    }
    $('sources').replaceChildren(answer.sources.length ? card('Sources', sources) : el('span'));
    $('cloudStatus').textContent = `Done. ${answer.missing.length ? `${answer.missing.length} question(s) got no answer line.` : ''}`;
  } catch (err) {
    renderSentLog();
    $('cloudStatus').textContent = `Stopped: ${err.message}`;
    console.error('cloud check stopped:', err);
  } finally {
    $('cloudSearch').disabled = $('cloudNoSearch').disabled = false;
  }
}
$('cloudSearch').addEventListener('click', () => runCloud(true));
$('cloudNoSearch').addEventListener('click', () => runCloud(false));

$('file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $('status').textContent = `Reading ${file.name}…`;
  $('status').className = 'muted';
  const started = performance.now();
  try {
    const { pageCount, rows, pages } = await readPdfRows(file);
    $('layout').textContent = JSON.stringify(layoutReport(pages), null, 2);
    if (isImageOnlyPdf(pages)) {
      $('status').textContent = `Read ${pageCount} pages, but ${IMAGE_ONLY_MESSAGE}`;
      $('status').className = 'bad';
      current = null;
      $('flags').replaceChildren(); $('out').replaceChildren(); $('names').replaceChildren(); renderQuestions([]);
      await updateAiButton();
      return;
    }
    const result = readCommonApp(rows);
    const ms = Math.round(performance.now() - started);

    const found = `${result.activities.length} activities, ${result.honors.length} honors, ` +
      `${result.personalEssay ? 'the personal essay' : 'no personal essay'} and ` +
      `${result.collegeEssays.length} essay(s) for ${result.college ?? 'an unknown college'}`;
    $('status').textContent = result.missing.length
      ? `Read ${pageCount} pages in ${ms} ms. Found ${found}, but could not find: ${result.missing.join(', ')}. Is this a Common App preview PDF?`
      : `Read ${pageCount} pages in ${ms} ms. Found ${found}.`;
    $('status').className = result.missing.length ? 'bad' : 'ok';
    $('layoutBox').open = result.missing.length > 0; // open the report when the reader couldn't find something

    const app = checkInputFromPdf(result);
    current = { result, app, codeFlags: runCodeChecks(app), aiFlags: [], aiNote: null, mentionAnswers: null };
    $('names').replaceChildren(); renderQuestions([]); // names and questions belong to the previous PDF
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
