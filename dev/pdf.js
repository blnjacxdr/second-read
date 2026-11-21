// Nov 21: read a Common App preview PDF and show what was found. Dev only.
// Works with any college's PDF: the reader goes by the template's formatting.
import { readPdfRows } from '../src/pdf.js';
import { readCommonApp } from '../src/core/common-app.js';
import { countWords } from '../src/core/sections.js';
import { runCodeChecks, checkInputFromPdf } from '../src/core/checks.js';

const $ = (id) => document.getElementById(id);

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
  const essay = result.collegeEssays.find((e) => e.id === sectionId);
  if (essay) return `${result.college} essay (${essay.group})`;
  return { 'personal-essay': 'Personal essay', 'additional-information': 'Additional information' }[sectionId] ?? sectionId;
}

function flagCard(result, flag) {
  const box = el('div', undefined, 'card flag');
  const quotes = el('div', undefined, 'quotes');
  for (const citation of flag.citations) {
    const q = el('figure', undefined, 'quote');
    q.append(el('figcaption', sectionLabel(result, citation.sectionId)), el('blockquote', citation.quote));
    quotes.append(q);
  }
  box.append(el('h3', flag.title), el('p', flag.detail, 'muted'), quotes);
  return box;
}

function essayCard(title, essay) {
  const paragraphs = essay.text.split('\n\n').map((p) => el('p', p, 'prose'));
  return card(`${title} (${countWords(essay.text)} words)`, el('p', essay.prompt ?? '(no prompt)', 'muted'), ...paragraphs);
}

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

    const out = $('out');
    out.replaceChildren();

    const flags = runCodeChecks(checkInputFromPdf(result));
    out.append(el('h2', `Things to check (${flags.length})`));
    if (flags.length === 0) out.append(el('p', 'The code checks found nothing to check.', 'ok'));
    for (const flag of flags) out.append(flagCard(result, flag));

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
