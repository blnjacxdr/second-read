// Builds one PDF per college from sample/application.json, copying the layout
// of Common App's preview PDF: the shared Common App sections, then that
// college's own questions. Same font sizes, columns and footer as the real
// thing, so the reader is tested on realistic input.
//   sample/application-<college id>.pdf
// Run: npm install, then npm run sample:pdf
//
// Layout facts (measured from real preview PDFs, Nov 21, 2026; US Letter, points):
//   main section 24 pt bold, subsection 16.5 pt bold, minor heading 13.5 pt bold
//   labels 12 pt bold at x=36; answers 12 pt regular at x=179
//   activities: details at x=36, "Organization, Position" bold and description at x=176
//   honors: title bold at x=36, level at x=179, grades at x=286
//   footer 9 pt on every page; applicant header top right of page 1
// Every page is marked SAMPLE / fictional applicant.
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const app = JSON.parse(readFileSync(new URL('../sample/application.json', import.meta.url), 'utf8'));

const PAGE = { width: 612, height: 792, bottom: 50, contentTop: 740 };
const X = { left: 36, answer: 179, activityRight: 176, honorGrades: 286, right: 560 };
const SIZE = { h1: 24, h2: 16.5, h3: 13.5, body: 12, chrome: 9 };
const LINE = 14.5; // line spacing for 12 pt text
const BANNER = 'SAMPLE - fictional applicant made up for testing Second Read. Not a real person or application.';

function wrap(text, font, size, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const attempt = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(attempt, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = attempt;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function buildFor(supplement) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Second Read sample application for ${supplement.college} (fictional)`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const name = app.personalInfo.name;

  let page;
  let y;
  let pageNumber = 0;

  function newPage() {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    pageNumber += 1;
    const red = rgb(0.7, 0.1, 0.1);
    page.drawText(BANNER, { x: X.left, y: 776, size: SIZE.chrome, font: bold, color: red });
    page.drawText(`CA ${name}   Fall 2027   ${pageNumber}   SAMPLE`, { x: X.left, y: 22, size: SIZE.chrome, font: regular, color: red });
    y = PAGE.contentTop;
  }
  function ensureRoom(height) {
    if (y - height < PAGE.bottom) newPage();
  }
  function text(str, x, size, font) {
    page.drawText(str, { x, y, size, font });
  }

  function heading(str, level) {
    const size = { 1: SIZE.h1, 2: SIZE.h2, 3: SIZE.h3 }[level];
    if (y < PAGE.contentTop) y -= { 1: 30, 2: 14, 3: 4 }[level]; // space above, except at the top of a page
    ensureRoom(size + 2 * LINE);
    text(str, X.left, size, bold);
    y -= level === 1 ? 26 : level === 2 ? 24 : 16;
  }

  /** Bold label at the left, answer(s) to the right; both wrap, row by row. */
  function field(label, values, columns = [X.answer]) {
    const labelLines = wrap(label, bold, SIZE.body, X.answer - X.left - 10);
    const valueLines = values.map((value, i) => {
      const end = columns[i + 1] ? columns[i + 1] - 10 : X.right;
      return wrap(String(value), regular, SIZE.body, end - columns[i]);
    });
    const rows = Math.max(labelLines.length, ...valueLines.map((l) => l.length));
    for (let r = 0; r < rows; r++) {
      ensureRoom(LINE);
      if (labelLines[r]) text(labelLines[r], X.left, SIZE.body, bold);
      valueLines.forEach((lines, i) => lines[r] && text(lines[r], columns[i], SIZE.body, regular));
      y -= LINE;
    }
    y -= 6;
  }

  /** Bold prompt, then paragraphs of regular full-width text. */
  function essay(prompt, body) {
    for (const line of wrap(prompt, bold, SIZE.body, X.right - X.left)) {
      ensureRoom(LINE);
      text(line, X.left, SIZE.body, bold);
      y -= LINE;
    }
    y -= 18;
    for (const paragraph of body.split('\n\n')) {
      for (const line of wrap(paragraph, regular, SIZE.body, X.right - X.left)) {
        ensureRoom(LINE);
        text(line, X.left, SIZE.body, regular);
        y -= LINE;
      }
      y -= 14;
    }
  }

  function activity(a) {
    heading(a.type, 2);
    const left = [`${a.grades.join(', ')} (${a.timing})`, `${a.hoursPerWeek} hr/wk, ${a.weeksPerYear} wk/yr`, a.plans];
    const width = X.right - X.activityRight;
    const right = [
      ...wrap(`${a.organization}, ${a.position}`, bold, SIZE.body, width).map((t) => ({ t, font: bold })),
      // Athletics: the PDF prints the sport before the description.
      ...wrap(a.sport ? `${a.sport}, ${a.description}` : a.description, regular, SIZE.body, width).map((t) => ({ t, font: regular })),
    ];
    for (let r = 0; r < Math.max(left.length, right.length); r++) {
      ensureRoom(LINE);
      if (left[r]) text(left[r], X.left, SIZE.body, regular);
      if (right[r]) text(right[r].t, X.activityRight, SIZE.body, right[r].font);
      y -= LINE;
    }
    y -= 10;
  }

  newPage();
  // Applicant header block, top right of page 1 (above the first heading).
  page.drawText(name, { x: 420, y: 760, size: SIZE.body, font: bold });
  page.drawText('FY, EA, Fall 2027 (sample)', { x: 420, y: 745, size: SIZE.body, font: regular });
  y = 677;

  heading('Profile', 1);
  heading('Personal information', 2);
  field('Name', [name]);
  heading('Contact details', 2);
  field('Email, Phone', [app.personalInfo.email]);

  heading('Family', 1);
  heading('Household', 2);
  field('Parents', ['Married']);

  heading('Education', 1);
  heading('Current or most recent secondary school', 2);
  heading(app.personalInfo.school, 3);
  field('Graduation Date', [`06/${app.personalInfo.graduationYear}`]);
  heading('Honors', 2);
  for (const h of app.honors) field(h.title, [h.level, h.grades.join(', ')], [X.answer, X.honorGrades]);
  heading('Future plans', 2);
  field('Career interest', ['Engineer']);

  heading('Activities and experiences', 1);
  for (const a of app.activities) activity(a);
  heading('Responsibilities and circumstances', 2);
  field('Household responsibilities', ['None of these']);

  heading('Writing', 1);
  heading('Personal essay', 2);
  essay(app.personalEssay.prompt, app.personalEssay.text);

  newPage();
  heading(`${supplement.college} questions`, 1);
  heading('General', 2);
  for (const answer of supplement.answers) field(answer.label, [answer.value]);
  heading(supplement.group, 2);
  essay(supplement.prompt, supplement.text);
  heading('Affirmations', 2);
  field('Affirmation', ['Yes (sample)']);

  return pdf;
}

for (const supplement of app.supplements) {
  const pdf = await buildFor(supplement);
  const file = `application-${supplement.id.replace('supplement-', '')}.pdf`;
  writeFileSync(new URL(`../sample/${file}`, import.meta.url), await pdf.save());
  console.log(`wrote sample/${file} (${pdf.getPageCount()} pages)`);
}
