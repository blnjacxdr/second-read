// Second Read, the app. Draws the screens and runs the checks:
//   start -> reading (PDF read in this tab, code checks, Gemini Nano on this laptop) -> results -> optional name check.
// Privacy: the PDF never leaves the tab. Application text goes only to code and to Gemini Nano (ONLY_ON_DEVICE, in
// src/ai.js). The only thing that can reach the internet is the optional name check: the names the student ticks,
// recorded in the sent log before sending. All file text is drawn with textContent, never as HTML.
// Logic lives in src/core (tested); this file only wires it to the page. Firebase is loaded only by src/ai.js.

import { readPdfRows } from './pdf.js';
import { readCommonApp } from './core/common-app.js';
import { runCodeChecks, checkInputFromPdf } from './core/checks.js';
import { runAiChecks, findPublicNames } from './core/run-ai.js';
import { isImageOnlyPdf, IMAGE_ONLY_MESSAGE } from './core/layout-report.js';
import { onDeviceAvailability } from './core/privacy.js';
import { cloudQuestions, placeConflicts, answerStatus } from './core/cloud-names.js';
import { createSentLog } from './core/sent-log.js';
import { safeLinkUrl } from './core/grounding.js';
import { presentFlags, headlineFor, receiptFor, nanoNote } from './core/present.js';
import { startEyes, startLogo } from './ui/eyes.js';
import { startScrolling } from './ui/scroll.js';

const $ = (id) => document.getElementById(id);
const CODE_CHECK_COUNT = 5;      // the checks in runCodeChecks: other colleges' names, start years, titles, repeats, limits
const MAX_CLOUD_CHECKS = 3;      // name checks per visit; a student needs one, so this only stops abuse and surprise costs
const MAX_PDF_BYTES = 40 * 1024 * 1024;
const MIN_READING_MS = 1600;     // long enough to see the reading screen, short enough not to slow anyone down
const SAMPLE = { url: 'sample/application-michigan.pdf', label: "Riley's made-up application (Michigan)" };

const sentLog = createSentLog();
let ai = null;        // src/ai.js plus its models, loaded on first use
let run = null;       // everything about the PDF being checked
let cloudChecks = 0;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function loadAi() {
  if (!ai) {
    const module = await import('./ai.js');
    ai = { ...module, models: module.createSecondReadAI() };
  }
  return ai;
}

// ---------- Start page: Gemini Nano status on the sticky note ----------

async function showNanoStatus() {
  const availability = await onDeviceAvailability().catch(() => 'unavailable');
  const note = nanoNote(availability);
  $('nano-title').textContent = note.title;
  $('nano-body').textContent = note.body;
  $('nano-dot').style.background = note.ready ? '#1F7A45' : '#B26B00';
  $('nano-dot').classList.toggle('sr-ready', note.ready); // only a ready model gets the breathing dot
  $('nano-extra').hidden = !note.ready; // the not-ready message already says this
  return availability;
}

// ---------- Views ----------

function showView(name) {
  $('view-start').hidden = name === 'results';
  $('view-results').hidden = name !== 'results';
  $('view-idle').hidden = name !== 'start';
  $('view-reading').hidden = name !== 'reading';
  document.querySelector('.sr-nav').hidden = name === 'results';
  $('again').hidden = name !== 'results';
}

function goToStart() {
  run = null;
  $('pdf').value = '';
  showView('start');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ---------- Reading ----------

const LINE_WIDTHS = [92, 78, 100, 64, 88, 96, 70, 84, 58];

function startReadingScreen(label) {
  showView('reading');
  $('read-title').textContent = 'Reading on this laptop…';
  $('read-found').replaceChildren();
  $('read-note').textContent = label;
  $('read-skip').hidden = true;
  $('read-error').hidden = true;
  // Fresh lines and a fresh reading pencil, so the animation plays again for every PDF.
  const lines = $('read-lines');
  const pencil = lines.querySelector('.sr-reader');
  const fresh = pencil.cloneNode(true);
  lines.replaceChildren(fresh, ...LINE_WIDTHS.map((w, i) => {
    const line = el('div', undefined, 'sr-line');
    line.style.cssText = `width: ${w}%; --d: ${(i * 0.3).toFixed(1)}s`;
    return line;
  }));
  $('view-reading').scrollIntoView({ block: 'center', behavior: 'instant' });
}

function found(text) {
  const li = el('li', undefined, 'sr-pop');
  li.style.cssText = 'display: flex; gap: 10px; align-items: baseline';
  li.innerHTML = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#2340D9" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.5l3 3L12 3"></path></svg>';
  li.append(el('span', text));
  $('read-found').append(li);
}

function readingError(title, body) {
  $('read-title').textContent = 'That didn\'t work';
  $('read-error-title').textContent = title;
  $('read-error-body').textContent = body;
  $('read-error').hidden = false;
  $('read-skip').hidden = true;
  $('read-note').textContent = '';
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

async function check(file, label) {
  startReadingScreen(label);
  const started = performance.now();
  if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) {
    readingError('That isn\'t a PDF.', 'Second Read reads the PDF from Common App\'s Print preview. In Common App: My Colleges, pick a college, Review and submit, Print preview, then download.');
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    readingError('That PDF is too big to be a Common App preview.', 'A preview is usually under 2 MB. Download it again from Review and submit, Print preview.');
    return;
  }
  try {
    const { pageCount, rows, pages } = await readPdfRows(file);
    if (isImageOnlyPdf(pages)) {
      readingError('This PDF is pictures of text, so there\'s nothing to read.', `${IMAGE_ONLY_MESSAGE}`);
      return;
    }
    found(`Read ${pageCount} pages in ${seconds(performance.now() - started)}`);
    const result = readCommonApp(rows);
    if (result.activities.length === 0 && !result.personalEssay && result.collegeEssays.length === 0) {
      readingError('This doesn\'t look like a Common App preview.', 'We couldn\'t find activities, honors or essays. Download the PDF from Common App: My Colleges, pick a college, Review and submit, Print preview.');
      return;
    }
    await wait(250);
    found(`Found ${result.activities.length} activities and ${result.honors.length} honors`);
    if (result.personalEssay) { await wait(200); found('Found your personal essay'); }
    if (result.collegeEssays.length) {
      await wait(200);
      found(`Found ${result.collegeEssays.length} ${result.college ?? 'college'} ${result.collegeEssays.length === 1 ? 'essay' : 'essays'}`);
    }

    const app = checkInputFromPdf(result);
    const codeFlags = runCodeChecks(app);
    await wait(200);
    found(`Ran ${CODE_CHECK_COUNT} checks in code`);
    run = { label, pageCount, result, app, codeFlags, aiFlags: [], mentionAnswers: new Map(), nano: 'skipped', comparisons: 0, tossed: 0, decisions: new Map() };

    await askNano(run);
    const left = MIN_READING_MS - (performance.now() - started);
    if (left > 0) await wait(left);
    showResults();
  } catch (err) {
    console.error('Reading stopped:', err);
    readingError('Something went wrong reading this PDF.', 'Try downloading it again from Common App. If it keeps happening, the PDF may be damaged.');
  }
}

// Gemini Nano runs only when it's already on this computer. A student can skip it and see the sure ones now.
async function askNano(current) {
  if ((await onDeviceAvailability().catch(() => 'unavailable')) !== 'available') return;
  let skipped = false;
  const skip = new Promise((resolve) => {
    $('read-skip').hidden = false;
    $('read-skip').onclick = () => { skipped = true; resolve(null); };
  });
  $('read-note').textContent = 'Asking Gemini Nano on this laptop. This can take a minute.';
  try {
    const { models, onDeviceAsker, askMentionOnDevice } = await loadAi();
    const work = runAiChecks({
      app: current.app,
      codeFlags: current.codeFlags,
      ask: onDeviceAsker(models),
      design: 'extract',
      askMention: (name, sentence) => askMentionOnDevice(models.mentionModel, name, sentence),
      onProgress: (message) => { if (!skipped) $('read-note').textContent = message; },
    });
    const out = await Promise.race([work, skip]);
    if (!out || skipped) { current.nano = 'skipped-by-you'; return; }
    current.aiFlags = out.flags;
    current.mentionAnswers = out.mentionAnswers ?? new Map();
    current.comparisons = out.comparisons;
    current.tossed = out.dropped.length;
    current.nano = out.failed ? 'failed' : 'ran';
    found(`Asked Gemini Nano ${out.comparisons} questions, on this laptop`);
  } catch (err) {
    console.error('Gemini Nano stopped:', err);
    current.nano = 'failed';
  } finally {
    $('read-skip').hidden = true;
  }
}

// ---------- Results ----------

const SOURCE = { pen: 'pen: checked by code', pencil: 'pencil: Gemini Nano, double-check' };
const NOTES = { fixed: 'nice.', kept: 'your call.' };

function cardFor(card) {
  const article = el('article', undefined, `sr-card ${card.tone}`);
  article.dataset.id = card.id;
  const top = el('div', undefined, 'sr-card-top');
  top.append(el('h3', card.title), el('span', SOURCE[card.tone], 'sr-card-src'));
  const quotes = el('div', undefined, 'sr-quotes');
  card.quotes.forEach((q, i) => {
    if (i > 0) {
      const vs = el('div', undefined, 'sr-vs');
      vs.setAttribute('aria-hidden', 'true');
      vs.innerHTML = '<svg width="40" height="20" viewBox="0 0 40 20" fill="none" stroke="#8A919E" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7 H 34 M 28 2 L 34 7 L 28 12 M36 15 H 6 M 12 10 L 6 15 L 12 20"></path></svg>';
      quotes.append(vs);
    }
    const fig = el('figure');
    const quote = el('blockquote');
    quote.append(el('span', q.text, `sr-hl${card.tone === 'pencil' ? ' pencil' : ''}`));
    fig.append(el('figcaption', q.where), quote);
    quotes.append(fig);
  });
  const parts = [top, quotes, el('p', card.detail, 'sr-detail')];
  if (card.fixIn.length) parts.push(el('p', `Fix it in Common App: ${card.fixIn.join('; ')}.`, 'sr-fixin'));
  const actions = el('div', undefined, 'sr-actions');
  const fix = el('button', 'Fixed it', 'fix');
  const keep = el('button', 'That\'s on purpose', 'keep');
  const note = el('span', '', 'note');
  note.setAttribute('aria-hidden', 'true');
  for (const [button, choice] of [[fix, 'fixed'], [keep, 'kept']]) {
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `${button.textContent}: ${card.title}`);
    button.addEventListener('click', () => decide(card.id, choice));
  }
  actions.append(fix, keep, note);
  const strike = el('div', undefined, 'sr-strike');
  strike.setAttribute('aria-hidden', 'true');
  parts.push(actions, strike);
  article.append(...parts);
  return article;
}

function decide(id, choice) {
  const { decisions } = run;
  if (decisions.get(id) === choice) decisions.delete(id); else decisions.set(id, choice);
  const article = document.querySelector(`.sr-card[data-id="${CSS.escape(id)}"]`);
  const now = decisions.get(id);
  article.classList.toggle('done', Boolean(now));
  article.classList.toggle('fixed', now === 'fixed');
  article.querySelector('.fix').setAttribute('aria-pressed', String(now === 'fixed'));
  article.querySelector('.keep').setAttribute('aria-pressed', String(now === 'kept'));
  article.querySelector('.note').textContent = now ? NOTES[now] : '';
  updateHeadline();
}

function updateHeadline() {
  const { cards, decisions } = run;
  const ids = [...cards.sure, ...cards.maybes].map((c) => c.id);
  const nano = run.nano === 'ran' ? 'ran' : run.nano === 'failed' ? 'failed' : 'skipped';
  const h = headlineFor({ sure: cards.sure.length, maybes: cards.maybes.length }, decisions, ids, { nano });
  $('res-headline').textContent = h.headline;
  $('res-subhead').textContent = h.subhead;
  $('res-stamp').hidden = !(h.state === 'done' || h.state === 'clean');
  $('res-allkept').hidden = h.state !== 'all-kept';
  document.getElementById('logo-eyes')?.classList.toggle('sr-happy', h.state === 'done');
}

function updateReceipt() {
  const rows = receiptFor({
    pageCount: run.pageCount, codeChecks: CODE_CHECK_COUNT, nanoQuestions: run.comparisons, tossed: run.tossed, sentCount: sentLog.entries().length,
  });
  const dl = $('receipt-rows');
  dl.replaceChildren();
  for (const [label, value] of rows.slice(0, -1)) dl.append(el('dt', label), el('dd', String(value)));
  const sent = rows.at(-1)[1];
  const cell = $('receipt-sent');
  cell.firstChild.textContent = String(sent);
  cell.classList.toggle('sr-zero', sent === 0);
}

function showResults() {
  run.cards = presentFlags({ result: run.result, codeFlags: run.codeFlags, aiFlags: run.aiFlags, mentionAnswers: run.mentionAnswers });
  const { sure, maybes, background } = run.cards;
  $('res-file').textContent = `${run.result.college ?? 'College'} PDF${run.label ? `: ${run.label}` : ''}`;
  $('res-sure').replaceChildren(...sure.map(cardFor));
  $('res-maybes').hidden = maybes.length === 0;
  $('res-maybes').open = sure.length === 0; // nothing sure to look at: open the maybes right away
  $('res-maybes-sum').textContent = `${maybes.length} ${maybes.length === 1 ? 'maybe' : 'maybes'} from Gemini Nano. Skim ${maybes.length === 1 ? 'this' : 'these'}.`;
  $('res-maybes-list').replaceChildren(...maybes.map(cardFor));
  $('res-background').hidden = background.length === 0;
  $('res-background-sum').textContent = `${background.length} other college ${background.length === 1 ? 'mention that reads' : 'mentions that read'} like a story, not a slip`;
  $('res-background-list').replaceChildren(...background.map(cardFor));
  resetNamesPanel();
  updateHeadline();
  updateReceipt();
  showView('results');
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('view-results').focus({ preventScroll: true });
}

// ---------- Optional name check (the only thing that can go to the internet) ----------

function resetNamesPanel() {
  run.questions = [];
  $('names-start').hidden = false;
  $('names-start').disabled = false;
  $('names-pick').hidden = true;
  $('names-status').textContent = '';
  for (const id of ['names-list', 'names-answers', 'names-sources']) $(id).replaceChildren();
  const chips = $('names-chips');
  if (chips.shadowRoot) chips.shadowRoot.innerHTML = '';
}

async function pickNames() {
  $('names-start').disabled = true;
  $('names-status').textContent = 'Finding public names on this laptop…';
  try {
    let askNames;
    if ((await onDeviceAvailability().catch(() => 'unavailable')) === 'available') {
      const { models, findNamesOnDevice } = await loadAi();
      askNames = (text) => findNamesOnDevice(models.namesModel, text);
    }
    const out = await findPublicNames({ result: run.result, askNames });
    run.questions = cloudQuestions(out.names, { college: run.result.college, sections: run.result.sections });
    if (run.questions.length === 0) {
      $('names-status').textContent = 'No public names worth checking in this PDF. Nothing was sent.';
      $('names-start').hidden = true;
      return;
    }
    const list = $('names-list');
    list.replaceChildren();
    for (const q of run.questions) {
      const label = el('label');
      const tick = el('input');
      tick.type = 'checkbox';
      tick.checked = q.defaultOn;
      tick.dataset.id = String(q.id);
      const text = el('span', q.kind === 'partOf' ? `Is ${q.name} part of ${q.college}?` : q.name);
      if (q.why) text.append(el('span', ` (unticked: ${q.why})`, 'why'));
      label.append(tick, text);
      list.append(label);
    }
    $('names-start').hidden = true;
    $('names-pick').hidden = false;
    $('names-status').textContent = 'Untick anything you\'d rather keep private. Only the ticked names are sent.';
  } catch (err) {
    console.error('Name finder stopped:', err);
    $('names-status').textContent = 'Couldn\'t list the names. Nothing was sent.';
    $('names-start').disabled = false;
  }
}

async function sendNames() {
  if (cloudChecks >= MAX_CLOUD_CHECKS) {
    $('names-status').textContent = `That's ${MAX_CLOUD_CHECKS} name checks this visit, the limit. Reload the page to check again.`;
    return;
  }
  const ticked = new Set([...$('names-list').querySelectorAll('input:checked')].map((t) => Number(t.dataset.id)));
  const send = run.questions.filter((q) => ticked.has(q.id)).map((q, i) => ({ ...q, id: i + 1 }));
  if (send.length === 0) { $('names-status').textContent = 'Nothing ticked, so nothing was sent.'; return; }
  $('names-send').disabled = true;
  $('names-status').textContent = `Sending ${send.length} ${send.length === 1 ? 'name' : 'names'} to Google…`;
  try {
    const { models, checkNamesInCloud } = await loadAi();
    cloudChecks += 1;
    const answer = await checkNamesInCloud(models.publicModel, send, sentLog, { withSearch: true });
    drawAnswers(send, answer);
  } catch (err) {
    console.error('Name check stopped:', err);
    $('names-status').textContent = 'The name check didn\'t go through. Your results above are unchanged.';
  } finally {
    $('names-send').disabled = false;
    drawSentLog();
    updateReceipt();
  }
}

function drawAnswers(send, answer) {
  const list = el('ul', undefined, 'sr-answers');
  let looks = 0;
  for (const q of send) {
    const a = answer.answers.find((x) => x.id === q.id);
    const conflicts = a ? placeConflicts(q, a, run.result.sections) : [];
    const status = answerStatus(q, a, conflicts);
    if (status === 'look') looks += 1;
    const li = el('li', undefined, status);
    const tag = { look: 'Worth a look', fine: 'Looks right', unsure: 'Couldn\'t confirm' }[status];
    li.append(el('span', `${tag}: `, 'tag'), el('span', q.kind === 'partOf' ? `Is ${q.name} part of ${q.college}? ` : `${q.name}. `));
    if (a) {
      const said = [a.official && a.official !== q.name ? a.official : null, a.place, a.fact].filter(Boolean).join('. ').replace(/[.]+$/, '');
      if (said) li.append(el('span', `${said}.`));
    }
    if (conflicts.length) li.append(el('strong', ` You wrote ${conflicts.map((c) => c.written).join(' and ')} next to it.`));
    list.append(li);
  }
  $('names-answers').replaceChildren(list);
  // Google requires its search suggestions to be shown exactly as sent, and the sources. The chips live in a
  // shadow root so their own styles can't touch the page.
  const chips = $('names-chips');
  (chips.shadowRoot || chips.attachShadow({ mode: 'open' })).innerHTML = answer.searchSuggestionsHtml || '';
  if (answer.sources.length) {
    const sources = el('ul', undefined, 'sr-sources');
    for (const s of answer.sources) {
      const li = el('li');
      const href = safeLinkUrl(s.uri);
      if (!href) continue; // only https links become clickable
      const link = el('a', s.title);
      link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      li.append(link);
      sources.append(li);
    }
    $('names-sources').replaceChildren(el('p', 'Sources', 'sr-small'), sources);
  } else {
    $('names-sources').replaceChildren(el('p', 'Gemini answered from memory this time, so there are no sources. Try again to search.', 'sr-small'));
  }
  $('names-status').textContent = looks
    ? `${looks} ${looks === 1 ? 'name is' : 'names are'} worth a look.`
    : 'Nothing looks off.';
}

function drawSentLog() {
  const entries = sentLog.entries();
  $('sent-box').hidden = entries.length === 0;
  $('sent-log').replaceChildren(...entries.map((e) => {
    const box = el('div');
    box.append(el('p', `${e.purpose} (${new Date(e.at).toLocaleTimeString()})`, 'sr-small'), el('pre', e.text));
    return box;
  }));
}

// ---------- Wiring ----------

const eyes = startEyes();
const scrolling = startScrolling();
startLogo(() => scrolling.toTop());
showNanoStatus();

$('pdf').addEventListener('change', (e) => { const file = e.target.files[0]; if (file) check(file, file.name); });
$('pdf').addEventListener('focus', () => eyes.lookDown());
$('pdf').addEventListener('blur', () => eyes.lookUp());

// Dropping a PDF anywhere on the page checks it; nothing else happens to dropped files (the browser won't open them).
const drop = $('drop-label');
for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, () => eyes.lookDown());
drop.addEventListener('dragleave', () => eyes.lookUp());
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  eyes.lookUp();
  const file = e.dataTransfer?.files?.[0];
  if (file && $('view-results').hidden && $('view-reading').hidden) check(file, file.name);
});

$('sample').addEventListener('click', async () => {
  try {
    const blob = await (await fetch(SAMPLE.url)).blob();
    check(new File([blob], 'application-michigan.pdf', { type: 'application/pdf' }), SAMPLE.label);
  } catch (err) {
    console.error('Sample stopped:', err);
  }
});

$('read-back').addEventListener('click', goToStart);
$('again').addEventListener('click', goToStart);
$('names-start').addEventListener('click', pickNames);
$('names-send').addEventListener('click', sendNames);
