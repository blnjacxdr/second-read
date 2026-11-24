// Second Read, the app. One page, five phases:
//   1 Your PDF (start page) -> 2 hand it over -> 3 the second read (reading stage) -> 4 fix list -> 5 re-check
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
import { cloudQuestions, placeConflicts, answerStatus, sourcesByAnswer, levelMismatch } from './core/cloud-names.js';
import { createSentLog } from './core/sent-log.js';
import { safeLinkUrl } from './core/grounding.js';
import { presentFlags, headlineFor, receiptFor, nanoNote } from './core/present.js';
import { compareChecks, carriedDecisions, recheckSummary } from './core/recheck.js';
import { startEyes, startLogo } from './ui/eyes.js';
import { startScrolling } from './ui/scroll.js';
import { addFace, setFace } from './ui/face.js';
import { marginNote } from './core/margin-note.js';
import { contextSentences, googleSays, contextFinding } from './core/name-context.js';

const $ = (id) => document.getElementById(id);
const CODE_CHECK_COUNT = 7;      // the checks in runCodeChecks: other colleges' names, start years, titles, grade years, counts, repeats, limits
const MAX_CLOUD_CHECKS = 3;      // name checks per visit; a student needs one, so this only stops abuse and surprise costs
const MAX_PDF_BYTES = 40 * 1024 * 1024;
// File names can be anything ("Scan 2026-11-02.pdf"), so the page never shows them. A real PDF is "your PDF";
// the sample is Riley's.
const SAMPLE = { url: 'sample/application-michigan.pdf', label: "Riley's made-up application" };
const reduced = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const sentLog = createSentLog();
let ai = null;        // src/ai.js plus its models, loaded on first use
let run = null;       // the PDF being checked now
let last = null;      // the previous check in this tab, for re-checking (never stored anywhere else)
let cloudChecks = 0;
let busy = false;     // true while a PDF is being read; the phase tabs wait

// The eyes that can make faces: the logo (every phase), the two on the reading card, and the start page pair.
const faces = {
  logo: () => $('logo-eyes'),
  reading: () => [...document.querySelectorAll('.sr-readeyes svg')],
  hero: () => [$('sr-eye-1'), $('sr-eye-2')],
};
const face = (which, mood, ms) => [].concat(faces[which]()).forEach((svg) => setFace(svg, mood, ms));

// A small stroked icon, built as DOM (never as an HTML string). Paths are in a 24 by 24 box.
function icon(paths, { size = 16, color = 'currentColor', width = 2.6 } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
  for (const d of paths) { const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
const ICONS = {
  check: ['M5 12.5 L10 17.5 L19 7'],
  pencil: ['M4 20 L5 15 L16 4 L20 8 L9 19 Z', 'M14 6 L18 10'],
  flag: ['M5 21 V4', 'M5 4 H17 L14.5 8 L17 12 H5'],
  question: ['M9 9 C9 6.5 10.5 5 12.2 5 C14 5 15.5 6.3 15.5 8.2 C15.5 10.6 12.5 11 12.5 13.6', 'M12.5 18.5 V18.6'],
};

// Grows or shrinks a box smoothly while its content changes, instead of letting it jump.
// offsetHeight is in the page's own pixels, the same units as the height we animate.
function growWhile(box, change) {
  const from = box.offsetHeight;
  change();
  const to = box.offsetHeight;
  if (reduced() || Math.abs(to - from) < 2 || !box.animate) return;
  box.style.overflow = 'clip';
  box.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 400, easing: 'cubic-bezier(.32,.72,0,1)' })
    .finished.catch(() => {}).then(() => { box.style.overflow = ''; });
}

// Changes a line of text with a quick blur-and-settle, so new words arrive instead of teleporting.
function swapText(node, text) {
  if (!node || node.textContent === text) return;
  node.textContent = text;
  if (reduced() || !node.animate || !node.isConnected || node.offsetParent === null) return;
  node.animate([{ opacity: 0.35, filter: 'blur(2px)', transform: 'translateY(3px)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }],
    { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' });
}

// One toast at a time: what just happened, with Undo. Gone after 4 seconds, or when replaced.
let toastTimer = 0;
let toastUndo = null;
function toast(text, undo) {
  const box = $('toast');
  clearTimeout(toastTimer);
  box.classList.remove('leaving');
  $('toast-text').textContent = text;
  toastUndo = undo ?? null;
  $('toast-undo').hidden = !undo;
  box.hidden = false;
  toastTimer = setTimeout(hideToast, 4000);
}
function hideToast() {
  const box = $('toast');
  if (box.hidden) return;
  box.classList.add('leaving');
  toastTimer = setTimeout(() => { box.hidden = true; box.classList.remove('leaving'); }, reduced() ? 0 : 300);
}

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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

// ---------- Phases ----------

const PHASES = ['start', 'reading', 'results'];

// Moves between phases. Where the browser supports it, the change is a view transition: the drop sheet carries
// over into the reading card, and the rest of the page steps back and rises in. Otherwise it simply switches.
async function setPhase(name) {
  const apply = () => {
    document.body.classList.remove(...PHASES.map((p) => `phase-${p}`));
    document.body.classList.add(`phase-${name}`);
    $('view-start').hidden = name === 'results';
    $('view-results').hidden = name !== 'results';
    $('view-idle').hidden = name !== 'start';
    $('view-reading').hidden = name !== 'reading';
    document.querySelector('.sr-nav').hidden = name !== 'start';
    $('again').hidden = name !== 'results';
    const at = PHASES.indexOf(name);
    document.querySelectorAll('#phases li').forEach((li, i) => {
      li.classList.toggle('done', i < at);
      if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    updateTabs(name);
    document.title = { start: 'Second Read: your Common App, read twice', reading: 'Reading your PDF | Second Read', results: `${$('res-headline').textContent || 'Your fix list'} | Second Read` }[name];
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  if (document.startViewTransition && !reduced()) await document.startViewTransition(apply).finished.catch(() => {});
  else apply();
}

function goToStart() {
  hideToast();
  run = null;
  $('pdf').value = '';
  face('logo', null);
  setPhase('start');
}

// The phase tabs are buttons once there's somewhere to go: back to the start, back to how the last read went,
// or back to the last fix list. Nothing is reloaded; the last check is still in this tab's memory.
function updateTabs(name) {
  const [start, reading, results] = document.querySelectorAll('#phases button');
  start.disabled = busy || name === 'start';
  reading.disabled = busy || !last || name === 'reading';
  results.disabled = busy || !last || name === 'results';
  $('read-done').hidden = busy || !last || name !== 'reading';
}

function openLastResults() {
  if (!last) return;
  run = last;
  setPhase('results');
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
  $('nano-get').hidden = !note.canDownload;
  return availability;
}

// Chrome downloads Gemini Nano once, and only after a click. The note shows the progress.
async function getNano() {
  const button = $('nano-get');
  button.disabled = true;
  button.textContent = 'Starting the download…';
  try {
    const { models, prepareOnDeviceModel } = await loadAi();
    await prepareOnDeviceModel(models.privateModel, (fraction) => {
      button.textContent = `Downloading Gemini Nano: ${Math.round(fraction * 100)}%`;
    });
    await showNanoStatus();
  } catch (err) {
    console.error('Gemini Nano download stopped:', err);
    $('nano-body').textContent = 'Chrome couldn\'t download Gemini Nano right now. It needs a laptop with enough free space. The code checks still run.';
    button.hidden = true;
  } finally {
    button.disabled = false;
    button.textContent = 'Download Gemini Nano';
  }
}

// ---------- The second read ----------

const LINE_WIDTHS = [92, 78, 100, 64, 88, 96, 70, 84, 58];

function stage(name, state, how = '') {
  const li = document.querySelector(`#read-stages li[data-stage="${name}"]`);
  li.dataset.state = state;
  swapText(li.querySelector('.how'), how);
}

function resetReading(label) {
  face('reading', null);
  $('read-done').hidden = true;
  $('read-title').textContent = 'Reading on this laptop';
  $('read-file').textContent = label ?? 'Your Common App PDF';
  $('read-skip').hidden = true;
  $('read-error').hidden = true;
  document.querySelector('.sr-readcard').classList.remove('finished');
  document.querySelectorAll('#read-stages li').forEach((li) => { li.dataset.state = 'waiting'; li.querySelector('.how').textContent = ''; });
  document.querySelector('.sr-bar-track').hidden = true;
  $('nano-bar').style.transform = 'scaleX(0)';
  // Fresh lines and a fresh reading pencil, so the animation plays again for every PDF.
  const lines = $('read-lines');
  const pencil = lines.querySelector('.sr-reader').cloneNode(true);
  lines.replaceChildren(pencil, ...LINE_WIDTHS.map((w, i) => {
    const line = el('div', undefined, 'sr-line');
    line.style.cssText = `width: ${w}%; --d: ${(i * 0.3).toFixed(1)}s`;
    return line;
  }));
}

function readingError(title, body) {
  $('read-title').textContent = 'That didn\'t work';
  $('read-file').textContent = 'Nothing was sent anywhere. Try another PDF when you\'re ready.';
  // The step that stopped gets a red mark, so it's clear where it stopped.
  document.querySelectorAll('#read-stages li[data-state="active"]').forEach((li) => { li.dataset.state = 'failed'; });
  $('read-error-title').textContent = title;
  $('read-error-body').textContent = body;
  $('read-error').hidden = false;
  $('read-skip').hidden = true;
  document.querySelector('.sr-readcard').classList.add('finished');
  document.querySelectorAll('#read-stages li[data-state="active"]').forEach((li) => { li.dataset.state = 'waiting'; });
  face('reading', 'worried');
  face('logo', 'worried', 2400);
  busy = false;
  updateTabs('reading');
}

async function check(file, label) {
  busy = true;
  resetReading(label);
  await setPhase('reading');
  const started = performance.now();
  stage('pdf', 'active');
  if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) {
    readingError('That isn\'t a PDF.', 'Second Read reads the PDF from Common App\'s Print preview: My Colleges, pick a college, Review and submit, Print preview, then download.');
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    readingError('That PDF is too big to be a Common App preview.', 'A preview is usually under 2 MB. Download it again from Review and submit, Print preview.');
    return;
  }
  try {
    const { pageCount, rows, pages } = await readPdfRows(file);
    if (isImageOnlyPdf(pages)) {
      readingError('This PDF is pictures of text, so there\'s nothing to read.', IMAGE_ONLY_MESSAGE);
      return;
    }
    await wait(220);
    stage('pdf', 'done', `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}, ${seconds(performance.now() - started)}`);

    stage('parts', 'active');
    const result = readCommonApp(rows);
    if (result.activities.length === 0 && !result.personalEssay && result.collegeEssays.length === 0) {
      readingError('This doesn\'t look like a Common App preview.', 'We couldn\'t find activities, honors or essays. Download the PDF from Common App: My Colleges, pick a college, Review and submit, Print preview.');
      return;
    }
    await wait(280);
    const essays = (result.personalEssay ? 1 : 0) + result.collegeEssays.length;
    if (result.college) $('read-file').textContent = label ? `${label}, ${result.college} version` : `Your ${result.college} PDF`;
    stage('parts', 'done', `${result.activities.length} activities, ${result.honors.length} honors, ${essays} ${essays === 1 ? 'essay' : 'essays'}`);

    stage('code', 'active');
    const app = checkInputFromPdf(result);
    const codeFlags = runCodeChecks(app);
    await wait(280);
    stage('code', 'done', `${CODE_CHECK_COUNT} checks`);
    run = { label, pageCount, result, app, codeFlags, aiFlags: [], mentionAnswers: new Map(), nano: 'skipped', comparisons: 0, tossed: 0, decisions: new Map() };

    await askNano(run);

    stage('list', 'active');
    await wait(240);
    stage('list', 'done');
    $('read-title').textContent = 'Done reading';
    document.querySelector('.sr-readcard').classList.add('finished');
    face('reading', 'happy');
    await wait(480);
    busy = false;
    await showResults();
  } catch (err) {
    console.error('Reading stopped:', err);
    readingError('Something went wrong reading this PDF.', 'Try downloading it again from Common App. If it keeps happening, the PDF may be damaged.');
  }
}

// Gemini Nano runs only when it's already on this computer. A student can skip it and see the sure ones now.
async function askNano(current) {
  if ((await onDeviceAvailability().catch(() => 'unavailable')) !== 'available') {
    stage('nano', 'skipped', 'not on this laptop');
    return;
  }
  stage('nano', 'active', 'starting');
  let skipped = false;
  const skip = new Promise((resolve) => {
    $('read-skip').hidden = false;
    $('read-skip').onclick = () => { skipped = true; resolve(null); };
  });
  const track = document.querySelector('.sr-bar-track');
  try {
    const { models, onDeviceAsker, askMentionOnDevice } = await loadAi();
    const work = runAiChecks({
      app: current.app,
      codeFlags: current.codeFlags,
      ask: onDeviceAsker(models),
      design: 'extract',
      askMention: (name, sentence) => askMentionOnDevice(models.mentionModel, name, sentence),
      onProgress: (_message, progress) => {
        if (skipped || !progress) return;
        track.hidden = false;
        $('nano-bar').style.transform = `scaleX(${(progress.done / progress.total).toFixed(3)})`;
        stage('nano', 'active', `${progress.done} of ${progress.total}`);
      },
    });
    const out = await Promise.race([work, skip]);
    if (!out || skipped) {
      current.nano = 'skipped-by-you';
      stage('nano', 'skipped', 'skipped');
      return;
    }
    $('nano-bar').style.transform = 'scaleX(1)';
    current.aiFlags = out.flags;
    current.mentionAnswers = out.mentionAnswers ?? new Map();
    current.comparisons = out.comparisons;
    current.tossed = out.dropped.length;
    current.nano = out.failed ? 'failed' : 'ran';
    stage('nano', 'done', `${out.comparisons} questions`);
  } catch (err) {
    console.error('Gemini Nano stopped:', err);
    current.nano = 'failed';
    stage('nano', 'skipped', 'stopped');
  } finally {
    $('read-skip').hidden = true;
  }
}

// ---------- Fix list ----------

// What each card is, said on the card itself. Sure: code found both quotes word for word. Maybe: Gemini Nano's
// reading of the meaning, which can be wrong.
const SOURCE = {
  pen: { text: 'Sure. Code found both quotes, word for word.', icon: ICONS.check },
  pencil: { text: 'Maybe. Gemini Nano\'s reading, so give it a look.', icon: ICONS.pencil },
};
const NOTES = { fixed: 'nice.', kept: 'your call.' };

function cardFor(card) {
  const article = el('article', undefined, `sr-card ${card.tone}`);
  article.dataset.id = card.id;
  const top = el('div', undefined, 'sr-card-top');
  const tag = el('span', undefined, 'sr-card-src');
  tag.append(icon(SOURCE[card.tone].icon, { size: 15, color: card.tone === 'pen' ? '#2340D9' : '#5B616C' }), SOURCE[card.tone].text);
  const heading = el('h3');
  heading.append(el('span', card.title, 'sr-title'));
  top.append(tag, heading);
  const quotes = el('div', undefined, 'sr-quotes');
  card.quotes.forEach((q, i) => {
    if (i > 0) {
      const vs = el('div', undefined, 'sr-vs');
      vs.setAttribute('aria-hidden', 'true');
      vs.append(icon(['M3 8 H19 M15 4 L19 8 L15 12', 'M21 16 H5 M9 12 L5 16 L9 20'], { size: 28, color: '#8A919E', width: 2.2 }));
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
  parts.push(actions);
  article.append(...parts);
  return article;
}

function paintDecision(id) {
  const article = document.querySelector(`.sr-card[data-id="${CSS.escape(id)}"]`);
  if (!article) return;
  const now = run.decisions.get(id);
  article.classList.toggle('done', Boolean(now));
  article.classList.toggle('fixed', now === 'fixed');
  article.querySelector('.fix').setAttribute('aria-pressed', String(now === 'fixed'));
  article.querySelector('.keep').setAttribute('aria-pressed', String(now === 'kept'));
  article.querySelector('.note').textContent = now ? NOTES[now] : '';
  paintTicks();
}

function decide(id, choice, { fromKeyboard = false } = {}) {
  const { decisions } = run;
  const before = decisions.get(id);
  if (decisions.get(id) === choice) decisions.delete(id); else decisions.set(id, choice);
  if (decisions.has(id)) {
    const at = run.slots.findIndex((n) => n.dataset.id === id);
    toast(choice === 'fixed' ? 'Marked as fixed.' : 'Marked as on purpose.', () => {
      if (before) decisions.set(id, before); else decisions.delete(id);
      clearTimeout(run.advance);
      paintDecision(id);
      updateHeadline();
      updateCount();
      if ($('res-stack').classList.contains('one') && at >= 0) showCard(at, -1);
    });
  }
  paintDecision(id);
  updateHeadline();
  if (decisions.get(id) === 'fixed' && !$('logo-eyes').classList.contains('face-happy')) face('logo', 'happy', 900);
  updateCount();
  // In the one-at-a-time stack, a decision moves on to the next card after a beat, so you see it land.
  if (decisions.has(id) && $('res-stack').classList.contains('one')) {
    clearTimeout(run.advance);
    // Keyboard actions move on at once, with no animation; a click gets a short beat to see it land.
    if (fromKeyboard) showCard(run.at + 1, 0, { instant: true });
    else run.advance = setTimeout(() => showCard(run.at + 1, 1), 380);
  }
}

// The stack holds every card (sure ones, then maybes) plus a closing card. One shows at a time, or all of them.
function buildStack() {
  const { sure, maybes } = run.cards;
  const stack = $('res-stack');
  const items = [...sure.map(cardFor)];
  if (maybes.length) {
    items.push(el('h2', `${maybes.length} ${maybes.length === 1 ? 'maybe' : 'maybes'} from Gemini Nano. Skim ${maybes.length === 1 ? 'this' : 'these'}.`, 'sr-divider'));
    items.push(...maybes.map(cardFor));
  }
  const end = el('div', undefined, 'sr-endcard');
  end.append(el('h3', 'That\'s every card.'), el('p', 'Fixed something in Common App? Download the new PDF and check it here. Second Read will tell you what\'s gone, what\'s still there and what\'s new.'));
  const again = el('button', 'Check the new PDF', 'sr-cta');
  again.type = 'button';
  again.addEventListener('click', goToStart);
  const names = el('button', 'Fact-check the names next', 'sr-textbtn');
  names.type = 'button';
  names.addEventListener('click', () => {
    $('names-panel').scrollIntoView({ behavior: reduced() ? 'instant' : 'smooth', block: 'start' });
    $('names-start').focus({ preventScroll: true });
  });
  const print = el('button', 'Print or save as PDF', 'sr-linkbtn');
  print.type = 'button';
  print.addEventListener('click', () => window.print());
  const buttons = el('div', undefined, 'sr-endactions');
  buttons.append(again, names, print);
  end.append(buttons);
  items.push(end);
  stack.replaceChildren(...items);
  run.slots = items.filter((n) => !n.classList.contains('sr-divider'));
  // Open on the first card still to decide (after a re-check, "on purpose" ones carried over).
  const firstOpen = [...sure, ...maybes].findIndex((c) => !run.decisions.has(c.id));
  run.at = firstOpen === -1 ? 0 : firstOpen;
  // Each card gets a view-transition name, so Show all can move the very same cards (see setStackMode).
  items.forEach((node, i) => { node.dataset.vt = `card-${i}`; });
  // One tick per card: where you are, and which ones you've decided. Click one to jump to it.
  const ticks = [...sure, ...maybes].map((card, i) => {
    const b = el('button');
    b.type = 'button';
    b.dataset.i = String(i);
    if (card.tone === 'pencil') b.classList.add('maybe');
    b.addEventListener('click', () => {
      if ($('res-stack').classList.contains('one')) showCard(i, Math.sign(i - run.at));
      else run.slots[i].scrollIntoView({ behavior: reduced() ? 'instant' : 'smooth', block: 'center' });
    });
    return b;
  });
  $('stack-ticks').replaceChildren(...ticks);
  for (const id of run.decisions.keys()) paintDecision(id);
  $('stackbar').hidden = run.slots.length <= 1;
  setStackMode(run.slots.length > 2 ? 'one' : 'all');
  if ($('stackbar').hidden) $('stack-keys').hidden = true;
}

function setStackMode(mode, animate = false) {
  const stack = $('res-stack');
  const apply = () => {
    stack.classList.toggle('one', mode === 'one');
    stack.classList.toggle('all', mode === 'all');
    $('stack-mode').setAttribute('aria-pressed', String(mode === 'all'));
    $('stack-mode').textContent = mode === 'all' ? 'One at a time' : 'Show all';
    $('stack-prev').hidden = $('stack-next').hidden = mode === 'all';
    $('stack-keys').hidden = mode === 'all';
    if (mode === 'one') showCard(run.at ?? 0, 0); else { run.slots.forEach((n) => { n.inert = false; }); updateCount(); }
  };
  if (!animate || !document.startViewTransition || reduced()) { apply(); return; }
  // Show all deals the cards out of the pile; One at a time gathers them back. Only the cards are named for
  // the transition, and html.vt-stack turns off the whole-page fade, so nothing else on the page moves.
  const named = [...stack.children];
  named.forEach((n) => { n.style.viewTransitionName = n.dataset.vt; });
  document.documentElement.classList.add('vt-stack');
  const done = () => {
    named.forEach((n) => { n.style.viewTransitionName = ''; });
    document.documentElement.classList.remove('vt-stack');
  };
  const t = document.startViewTransition(() => {
    apply();
    // Inside the transition the entrance keyframes would play twice, so the arriving card skips them.
    run.slots[run.at].style.animation = 'none';
  });
  t.finished.catch(() => {}).then(() => { run.slots[run.at].style.animation = ''; done(); });
}

function showCard(index, direction, { instant = false } = {}) {
  const slots = run.slots;
  run.at = Math.max(0, Math.min(slots.length - 1, index));
  slots.forEach((node, i) => {
    node.classList.toggle('current', i === run.at);
    node.classList.toggle('back', i === run.at && direction < 0);
    node.classList.toggle('instant', i === run.at && instant);
    node.inert = i !== run.at && $('res-stack').classList.contains('one');
  });
  // Restart the entrance animation on the card that just arrived.
  const current = slots[run.at];
  if (direction) { current.style.animation = 'none'; void current.offsetWidth; current.style.animation = ''; }
  $('res-stack').classList.toggle('last', run.at >= slots.length - 2);
  $('stack-prev').disabled = run.at === 0;
  $('stack-next').disabled = run.at === slots.length - 1;
  updateCount();
}

function updateCount() {
  const { sure, maybes } = run.cards;
  const total = sure.length + maybes.length;
  const decided = [...sure, ...maybes].filter((c) => run.decisions.has(c.id)).length;
  const one = $('res-stack').classList.contains('one');
  let text;
  if (total === 0) text = 'Nothing to look at';
  else if (!one) text = decided === total ? `All ${total} decided` : `${decided} of ${total} decided`;
  else if (run.at >= total) text = decided === total ? `All ${total} decided` : `${total - decided} still open`;
  else text = `Card ${run.at + 1} of ${total}`;
  swapText($('stack-count'), text);
  paintTicks();
}

function paintTicks() {
  if (!run?.cards) return;
  const cards = [...run.cards.sure, ...run.cards.maybes];
  const one = $('res-stack').classList.contains('one');
  $('stack-ticks').querySelectorAll('button').forEach((b, i) => {
    const choice = run.decisions.get(cards[i].id);
    b.classList.toggle('fixed', choice === 'fixed');
    b.classList.toggle('kept', choice === 'kept');
    b.setAttribute('aria-current', String(one && i === run.at));
    b.setAttribute('aria-label', `Card ${i + 1}: ${cards[i].title}${choice ? (choice === 'fixed' ? ', fixed' : ', on purpose') : ''}`);
  });
}

function updateHeadline() {
  const { cards, decisions } = run;
  const ids = [...cards.sure, ...cards.maybes].map((c) => c.id);
  const nano = ['ran', 'failed', 'skipped-by-you'].includes(run.nano) ? run.nano : 'skipped';
  // What Gemini Nano would add, said once under the headline when it didn't run.
  $('res-nano-tip').hidden = nano === 'ran';
  $('res-nano-tip').textContent = nano === 'skipped-by-you'
    ? 'Gemini Nano also reads hours, titles and awards in your essays. Check this PDF again and let it finish to include those.'
    : nano === 'failed'
      ? 'Check this PDF again to give Gemini Nano another try. It reads hours, titles and awards in your essays.'
      : 'With Gemini Nano (in Chrome on a laptop), Second Read also reads hours, titles and awards in your essays and checks names in your own sentences, so it catches more.';
  const h = headlineFor({ sure: cards.sure.length, maybes: cards.maybes.length }, decisions, ids, { nano });
  swapText($('res-headline'), h.headline);
  if (!$('view-results').hidden) document.title = `${h.headline} | Second Read`;
  swapText($('res-subhead'), h.subhead);
  $('res-stamp').hidden = !(h.state === 'done' || h.state === 'clean');
  $('res-allkept').hidden = h.state !== 'all-kept';
  // Everything handled (or nothing to handle): the logo looks pleased, and stays that way.
  if (h.state === 'done' || h.state === 'clean') face('logo', 'happy');
  else if ($('logo-eyes').classList.contains('face-happy')) face('logo', null);
}

function updateReceipt() {
  const rows = receiptFor({
    pageCount: run.pageCount, codeChecks: CODE_CHECK_COUNT, nano: run.nano, nanoQuestions: run.comparisons, tossed: run.tossed, sentCount: sentLog.entries().length,
  });
  $('receipt-tossed-note').hidden = !(run.tossed > 0);
  const dl = $('receipt-rows');
  dl.replaceChildren();
  for (const [label, value] of rows.slice(0, -1)) dl.append(el('dt', label), el('dd', String(value)));
  const sent = rows.at(-1)[1];
  $('receipt-sent').textContent = String(sent);
}

// Re-check: compare with the previous check in this tab. "On purpose" choices carry over; the summary says
// what's gone, what's still there and what's new.
function applyRecheck() {
  const banner = $('res-recheck');
  banner.hidden = true;
  if (!last) return;
  const comparison = compareChecks([...last.cards.sure, ...last.cards.maybes], [...run.cards.sure, ...run.cards.maybes]);
  for (const [id, choice] of carriedDecisions(comparison, last.decisions)) run.decisions.set(id, choice);
  const summary = recheckSummary(comparison);
  $('res-recheck-line').textContent = summary.allFixed ? 'Everything from your last check is fixed.' : summary.line;
  const sameCollege = last.result.college === run.result.college;
  $('res-recheck-note').textContent = sameCollege
    ? `Compared with the ${last.result.college ?? 'last'} PDF you checked a moment ago. Your "on purpose" choices carried over.`
    : `Compared with your ${last.result.college ?? 'last'} PDF. Shared sections match up across colleges; each college's own questions are new here.`;
  // Said plainly, because a student will wonder: the last check lives only in this tab's memory.
  $('res-recheck-note').textContent += ' The last check is kept only in this tab and is gone when you close it.';
  banner.hidden = false;
}

async function showResults() {
  run.cards = presentFlags({ result: run.result, codeFlags: run.codeFlags, aiFlags: run.aiFlags, mentionAnswers: run.mentionAnswers });
  const { background } = run.cards;
  const college = run.result.college;
  $('res-file').textContent = run.label
    ? `${run.label}, ${college ? `${college} version` : 'Common App PDF'}`
    : `Your ${college ?? 'Common App'} PDF`;
  applyRecheck();
  buildStack();
  $('res-background').hidden = background.length === 0;
  $('res-background-sum').textContent = `${background.length} other college ${background.length === 1 ? 'mention that reads' : 'mentions that read'} like a story, not a slip`;
  $('res-background-list').replaceChildren(...background.map(cardFor));
  resetNamesPanel();
  updateHeadline();
  updateReceipt();
  await setPhase('results');
  $('view-results').focus({ preventScroll: true });
  last = run; // the next check in this tab compares against this one
  updateTabs('results');
}

// ---------- Optional name check (the only thing that can go to the internet) ----------

// The status line under the heading. While something runs, two small eyes read along beside it.
function namesStatus(text, { busy = false } = {}) {
  const line = $('names-status');
  line.hidden = !text;
  line.classList.toggle('busy', busy);
  swapText($('names-status-text'), text);
  // Replay the small pop each time the message changes, so a new step is noticed.
  line.style.animation = 'none'; void line.offsetWidth; line.style.animation = '';
}

function resetNamesPanel() {
  run.questions = [];
  $('names-start').hidden = false;
  $('names-start').disabled = false;
  $('names-pick').hidden = true;
  $('names-send').hidden = false;
  namesStatus('');
  for (const id of ['names-list', 'names-answers', 'names-sources']) $(id).replaceChildren();
  $('names-chips').replaceChildren();
  $('names-google').hidden = true;
}

// Google's suggestions, exactly as Google sent them, as their own small page inside a sandboxed frame (no
// scripts, no access to this page). The frame is light like the rest of the page, so Google's built-in light
// version shows instead of its dark one. Links open in a new tab.
function suggestionsPage(html) {
  return `<!DOCTYPE html><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;background:transparent}</style>${html}`;
}

function updateNamesCount() {
  const n = $('names-list').querySelectorAll('input:checked').length;
  $('names-count').textContent = n ? `${n} ${n === 1 ? 'name' : 'names'} ticked` : 'Nothing ticked yet';
  $('names-send').disabled = n === 0;
}

async function pickNames() {
  $('names-start').disabled = true;
  namesStatus('Finding public names in your application, on this laptop…', { busy: true });
  try {
    let askNames;
    if ((await onDeviceAvailability().catch(() => 'unavailable')) === 'available') {
      const { models, findNamesOnDevice } = await loadAi();
      askNames = (text) => findNamesOnDevice(models.namesModel, text);
    }
    const [out] = await Promise.all([findPublicNames({ result: run.result, askNames }), wait(reduced() ? 0 : 700)]);
    run.questions = cloudQuestions(out.names, { college: run.result.college, sections: run.result.sections });
    if (run.questions.length === 0) {
      namesStatus('No public names worth checking in this PDF. Nothing was sent.');
      $('names-start').hidden = true;
      return;
    }
    const rows = run.questions.map((q, i) => {
      const label = el('label');
      label.style.setProperty('--i', String(i));
      const tick = el('input');
      tick.type = 'checkbox';
      tick.checked = q.defaultOn;
      tick.dataset.id = String(q.id);
      tick.addEventListener('change', updateNamesCount);
      const text = el('span', q.kind === 'partOf' ? `Is ${q.name} part of ${q.college}?` : q.name);
      if (q.kind === 'level') text.append(el('span', 'Is it real, and at what level? Your level isn\'t sent.', 'why'));
      if (q.why) text.append(el('span', `Unticked: ${q.why}`, 'why'));
      label.append(tick, text);
      return label;
    });
    growWhile($('names-panel'), () => {
      $('names-list').replaceChildren(...rows);
      $('names-start').hidden = true;
      $('names-pick').hidden = false;
      updateNamesCount();
      const off = run.questions.filter((q) => !q.defaultOn).length;
      namesStatus(`Found ${run.questions.length} public ${run.questions.length === 1 ? 'name' : 'names'}.${off ? ' Ones that sound like your own school start unticked.' : ''}`);
    });
  } catch (err) {
    console.error('Name finder stopped:', err);
    namesStatus('Couldn\'t list the names. Nothing was sent.');
    $('names-start').disabled = false;
  }
}

async function sendNames() {
  if (cloudChecks >= MAX_CLOUD_CHECKS) {
    namesStatus(`That's ${MAX_CLOUD_CHECKS} name checks this visit, the limit. Reload the page to check again.`);
    return;
  }
  const boxes = [...$('names-list').querySelectorAll('input')];
  const ticked = new Set(boxes.filter((t) => t.checked).map((t) => Number(t.dataset.id)));
  const send = run.questions.filter((q) => ticked.has(q.id)).map((q, i) => ({ ...q, id: i + 1 }));
  if (send.length === 0) { namesStatus('Nothing ticked, so nothing was sent.'); return; }
  $('names-send').disabled = true;
  boxes.forEach((b) => { b.disabled = true; b.closest('label').classList.add(b.checked ? 'asking' : 'leaving'); });
  namesStatus(`Asking Google Search about ${send.length} ${send.length === 1 ? 'name' : 'names'}…`, { busy: true });
  try {
    const { models, checkNamesInCloud } = await loadAi();
    cloudChecks += 1;
    const answer = await checkNamesInCloud(models.publicModel, send, sentLog, { withSearch: true });
    growWhile($('names-panel'), () => {
      $('names-pick').hidden = true;
      drawAnswers(send, answer);
    });
  } catch (err) {
    console.error('Name check stopped:', err);
    namesStatus('The name check didn\'t go through. Your cards above are unchanged.');
    boxes.forEach((b) => { b.disabled = false; b.closest('label').classList.remove('asking', 'leaving'); });
  } finally {
    $('names-send').disabled = false;
    drawSentLog();
    updateReceipt();
  }
}

const VERDICT = {
  look: { text: 'Worth a look', icon: ICONS.flag },
  fine: { text: 'Looks right', icon: ICONS.check },
  unsure: { text: 'Couldn\'t confirm', icon: ICONS.question },
};

function sourceLinks(list) {
  const row = el('span', undefined, 'sr-srcrow');
  for (const source of list) {
    const href = safeLinkUrl(source.uri);
    if (!href) continue; // only https links become clickable
    const link = el('a', source.title);
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    row.append(link);
  }
  return row.childElementCount ? row : null;
}

function drawAnswers(send, answer) {
  const list = el('ul', undefined, 'sr-answers');
  const { byId, other } = sourcesByAnswer(answer.text, answer.supports ?? [], answer.sources);
  let looks = 0;
  send.forEach((q, i) => {
    const a = answer.answers.find((x) => x.id === q.id);
    const conflicts = a ? placeConflicts(q, a, run.result.sections) : [];
    const status = answerStatus(q, a, conflicts);
    if (status === 'look') looks += 1;
    const li = el('li', undefined, status);
    li.dataset.qid = String(q.id);
    li.style.setProperty('--i', String(i));
    const verdict = verdictTag(status);
    const body = el('span', undefined, 'body');
    body.append(el('span', q.kind === 'partOf' ? `Is ${q.name} part of ${q.college}? ` : `${q.name}. `, 'name'));
    if (a) {
      const said = [a.official && a.official !== q.name ? a.official : null, a.place, a.fact].filter(Boolean).join('. ').replace(/[.]+$/, '');
      if (said) body.append(el('span', `${said}.`, 'said'));
    }
    if (conflicts.length) body.append(el('span', `You wrote ${conflicts.map((c) => c.written).join(' and ')} next to it.`, 'clash'));
    const level = levelMismatch(q, a);
    if (level) body.append(el('span', `You listed it as ${level.listed}. Google describes it as ${level.google}.`, 'clash'));
    // The sources Google used for this answer, inside this answer's box.
    const links = sourceLinks(byId.get(q.id) ?? []);
    if (links) { links.prepend(el('span', 'Sources', 'lead')); body.append(links); }
    li.append(verdict, body);
    list.append(li);
  });
  $('names-answers').replaceChildren(list);
  // Google requires the sources and its search suggestions to be shown. Sources that back no single answer go here.
  const rest = sourceLinks(other);
  if (rest) { rest.prepend(el('span', 'Other sources Google used', 'lead')); $('names-sources').replaceChildren(rest); }
  else if (!answer.sources.length) $('names-sources').replaceChildren(el('p', 'Gemini answered from memory this time, so there are no sources. Try again to search.', 'sr-small'));
  else $('names-sources').replaceChildren();
  // A new frame each time, added after its box is showing: Chrome can leave a frame blank for good if it was
  // created while hidden. Sandboxed with no scripts and no same-origin access.
  $('names-google').hidden = !answer.searchSuggestionsHtml;
  $('names-chips').replaceChildren();
  if (answer.searchSuggestionsHtml) {
    const chips = document.createElement('iframe');
    chips.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
    chips.title = 'Google Search suggestions';
    chips.referrerPolicy = 'no-referrer';
    $('names-chips').append(chips);
    chips.srcdoc = suggestionsPage(answer.searchSuggestionsHtml);
  }
  namesStatus(looks
    ? `${looks} ${looks === 1 ? 'name is' : 'names are'} worth a look.`
    : `Checked ${send.length}. Nothing looks off.`);
  if (looks) face('logo', 'worried', 1800);
  checkNamesInContext(send, answer, looks);
}

function verdictTag(status) {
  const verdict = el('span', undefined, 'verdict');
  verdict.append(icon(VERDICT[status].icon, { size: 17 }), VERDICT[status].text);
  return verdict;
}

// Hybrid step: Google's answers came in from the cloud; now Gemini Nano, on this laptop, reads each name in the
// student's own sentences and points at any detail that disagrees. Only runs when Gemini Nano is here.
async function checkNamesInContext(send, answer, looksSoFar) {
  if ((await onDeviceAvailability().catch(() => 'unavailable')) !== 'available') return;
  const jobs = send.map((q) => ({ q, google: googleSays(answer.answers.find((a) => a.id === q.id)) }))
    .filter((j) => j.google).map((j) => ({ ...j, sentences: contextSentences(j.q, run.result.sections) }))
    .filter((j) => j.sentences.length);
  if (jobs.length === 0) return;
  const before = $('names-status-text').textContent;
  namesStatus('Gemini Nano is reading each name in your own sentences, on this laptop…', { busy: true });
  let found = 0;
  try {
    const { models, checkNameContextOnDevice } = await loadAi();
    for (const { q, google, sentences } of jobs) {
      for (const sentence of sentences) {
        const reply = await checkNameContextOnDevice(models.contextModel, q.name, google, sentence.text).catch(() => null);
        const finding = contextFinding(reply, sentence, run.result.sections, q.name);
        if (!finding) continue;
        const li = $('names-answers').querySelector(`li[data-qid="${q.id}"]`);
        if (li) {
          if (!li.classList.contains('look')) found += 1;
          li.classList.remove('fine', 'unsure');
          li.classList.add('look', 'sr-flash');
          li.querySelector('.verdict').replaceWith(verdictTag('look'));
          li.querySelector('.body').append(el('span', `In your own words: "${finding.quote}". Gemini Nano, on this laptop, read that as not matching Google's answer.`, 'clash'));
        }
        break;
      }
    }
  } catch (err) {
    console.error('Name context check stopped:', err);
  }
  const looks = looksSoFar + found;
  namesStatus(found ? `${looks} ${looks === 1 ? 'name is' : 'names are'} worth a look. Gemini Nano also read each name in your own sentences.` : `${before} Gemini Nano read each name in your own sentences too.`);
  if (found) face('logo', 'worried', 1800);
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

addFace($('logo-eyes'), [[56, 56], [174, 56]]);
document.querySelectorAll('.sr-readeyes svg').forEach((svg, i) => addFace(svg, [[56, 56, i === 0 ? 'left' : 'right']]));
addFace($('sr-eye-1'), [[56, 56, 'left']]);
addFace($('sr-eye-2'), [[56, 56, 'right']]);
// The start page eyes brighten when you point at the things that start a check.
for (const id of ['drop-label', 'sample', 'closing-pick']) {
  $(id).addEventListener('mouseenter', () => face('hero', 'happy'));
  $(id).addEventListener('mouseleave', () => face('hero', null));
}

const eyes = startEyes();
const scrolling = startScrolling();
startLogo(() => (document.body.classList.contains('phase-start') ? scrolling.toTop() : goToStart()));
showNanoStatus();
document.body.classList.add('phase-start');

$('pdf').addEventListener('change', (e) => { const file = e.target.files[0]; if (file) check(file, null); });
$('pdf').addEventListener('focus', () => eyes.lookDown());
$('pdf').addEventListener('blur', () => eyes.lookUp());

// Dropping a PDF anywhere on the start page checks it; the browser never opens dropped files.
const drop = $('drop-label');
for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, () => eyes.lookDown());
drop.addEventListener('dragleave', () => eyes.lookUp());
// While a file is dragged anywhere over the start page, the drop sheet opens up to catch it.
let drags = 0;
window.addEventListener('dragenter', () => { if (document.body.classList.contains('phase-start')) { drags += 1; document.body.classList.add('dragging'); } });
window.addEventListener('dragleave', () => { drags = Math.max(0, drags - 1); if (!drags) document.body.classList.remove('dragging'); });
window.addEventListener('drop', () => { drags = 0; document.body.classList.remove('dragging'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  eyes.lookUp();
  const file = e.dataTransfer?.files?.[0];
  if (file && document.body.classList.contains('phase-start')) check(file, null);
});

$('sample').addEventListener('click', async () => {
  try {
    const blob = await (await fetch(SAMPLE.url)).blob();
    check(new File([blob], 'application-michigan.pdf', { type: 'application/pdf' }), SAMPLE.label);
  } catch (err) {
    console.error('Sample stopped:', err);
  }
});

$('read-back').addEventListener('click', () => { goToStart(); $('pdf').click(); });
$('nano-get').addEventListener('click', getNano);
{
  const note = marginNote(new Date());
  if (note) $('margin-note').textContent = note;
}
$('read-done').addEventListener('click', openLastResults);
{
  const [start, reading, results] = document.querySelectorAll('#phases button');
  start.addEventListener('click', goToStart);
  reading.addEventListener('click', () => { if (last) { run = last; setPhase('reading'); } });
  results.addEventListener('click', openLastResults);
}
// The closing section: its "Choose your PDF" is a label for the same file input, so Enter and Space need wiring.
$('closing-pick').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('pdf').click(); } });
$('closing-sample').addEventListener('click', () => $('sample').click());
$('again').addEventListener('click', goToStart);
$('names-start').addEventListener('click', pickNames);
// "Try a sample" in the top links runs the sample, not just scrolls to it.
$('nav-sample').addEventListener('click', (e) => { e.preventDefault(); $('sample').click(); });
$('names-send').addEventListener('click', sendNames);
$('toast-undo').addEventListener('click', () => { const undo = toastUndo; hideToast(); undo?.(); });
$('stack-prev').addEventListener('click', () => showCard(run.at - 1, -1));
$('stack-next').addEventListener('click', () => showCard(run.at + 1, 1));
$('stack-mode').addEventListener('click', () => setStackMode($('res-stack').classList.contains('one') ? 'all' : 'one', true));
// Left and right arrow keys flip cards in the stack (not while typing or using a control).
window.addEventListener('keydown', (e) => {
  if (!run?.slots || !$('res-stack').classList.contains('one') || $('view-results').hidden) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Keyboard is for speed: no slide, the next card is just there.
  if (e.key === 'ArrowRight') { e.preventDefault(); showCard(run.at + 1, 0, { instant: true }); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); showCard(run.at - 1, 0, { instant: true }); }
  const card = run.slots[run.at];
  if (card?.dataset.id && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); decide(card.dataset.id, 'fixed', { fromKeyboard: true }); }
  if (card?.dataset.id && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); decide(card.dataset.id, 'kept', { fromKeyboard: true }); }
});
