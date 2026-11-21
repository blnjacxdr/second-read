// Nov 21: read a sample PDF and show how it was split into sections. Dev only.
import { readPdfLines } from '../src/pdf.js';
import { splitApplication, SAMPLE_LAYOUT } from '../src/core/sectioner.js';
import { countWords } from '../src/core/sections.js';

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

$('file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $('status').textContent = `Reading ${file.name}…`;
  $('status').className = 'muted';
  const started = performance.now();
  try {
    const { pageCount, lines } = await readPdfLines(file);
    const result = splitApplication(lines, SAMPLE_LAYOUT);
    const ms = Math.round(performance.now() - started);

    const missing = result.unmatchedHeadings;
    $('status').textContent = missing.length
      ? `Read ${pageCount} pages in ${ms} ms, but these sections were not found: ${missing.join(', ')}. This PDF may use a different layout.`
      : `Read ${pageCount} pages in ${ms} ms. Found ${result.activities.length} activities, ${result.honors.length} honors, the personal essay and the ${result.supplement.college} supplement.`;
    $('status').className = missing.length ? 'bad' : 'ok';

    const out = $('out');
    out.replaceChildren();

    out.append(el('h2', `Activities (${result.activities.length})`));
    for (const a of result.activities) {
      out.append(card(a.id, fieldList([
        ['Type', a.type], ['Position', a.position], ['Organization', a.organization],
        ['Description', `${a.description} (${a.description?.length ?? 0} characters)`],
        ['Grades', a.grades.join(', ')], ['Timing', a.timing],
        ['Hours per week', a.hoursPerWeek], ['Weeks per year', a.weeksPerYear],
      ])));
    }

    out.append(el('h2', `Honors (${result.honors.length})`));
    for (const h of result.honors) {
      out.append(card(h.id, fieldList([['Title', h.title], ['Grades', h.grades.join(', ')], ['Level', h.level]])));
    }

    if (result.personalEssay) {
      out.append(el('h2', `Personal essay (${countWords(result.personalEssay.text)} words)`));
      out.append(card(result.personalEssay.prompt ?? 'Prompt not found', el('p', result.personalEssay.text, 'prose')));
    }

    if (result.supplement) {
      out.append(el('h2', `${result.supplement.college} supplement (${countWords(result.supplement.text)} words)`));
      out.append(card(result.supplement.prompt ?? 'Prompt not found', el('p', result.supplement.text, 'prose')));
    }

    const raw = el('details');
    raw.append(el('summary', `All ${lines.length} lines as read (for debugging)`), el('pre', lines.join('\n')));
    out.append(raw);
  } catch (err) {
    $('status').textContent = `Could not read this PDF: ${err.message}`;
    $('status').className = 'bad';
  }
});
