// Builds one PDF per college from sample/application.json, the way Common App
// does it: each college's preview PDF holds the shared Common App sections plus
// that college's own questions and writing supplement.
//   sample/application-<college id>.pdf
// Run: npm install, then npm run sample:pdf
//
// The layout is a plain stand-in, NOT a copy of Common App's preview PDF.
// Once we've looked at a real preview PDF's headings and field order, change
// the headings here to match, so the Nov 21 sectioner is tested on realistic
// input. Every page says SAMPLE / fictional applicant.
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { activityText, honorText } from '../src/core/sections.js';

const app = JSON.parse(readFileSync(new URL('../sample/application.json', import.meta.url), 'utf8'));

const PAGE = { width: 612, height: 792, margin: 60 };
const SIZE = { body: 11, heading: 14, title: 18, banner: 9 };
const LINE = 1.4;
const BANNER = 'SAMPLE - Fictional applicant made up for testing Second Read. Not a real person or application.';

/** Splits text into lines that fit the page width. */
function wrap(text, font, size) {
  const maxWidth = PAGE.width - 2 * PAGE.margin;
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const attempt = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(attempt, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = attempt;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** One college's PDF: the shared Common App sections, then that college's supplement. */
async function buildFor(supplement) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Second Read sample application for ${supplement.college} (fictional)`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page;
  let y; // current baseline; pdf-lib measures from the bottom of the page

  function newPage() {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    const banner = { x: PAGE.margin, size: SIZE.banner, font: bold, color: rgb(0.7, 0.1, 0.1) };
    page.drawText(BANNER, { ...banner, y: PAGE.height - 36 });
    page.drawText(BANNER, { ...banner, y: 30 });
    y = PAGE.height - PAGE.margin - 20;
  }

  function write(text, { font = regular, size = SIZE.body, gapAfter = 4 } = {}) {
    for (const paragraph of text.split('\n')) {
      for (const line of wrap(paragraph, font, size)) {
        if (y < PAGE.margin + 20) newPage();
        page.drawText(line, { x: PAGE.margin, y, size, font });
        y -= size * LINE;
      }
    }
    y -= gapAfter;
  }

  function heading(text) {
    y -= 8;
    write(text, { font: bold, size: SIZE.heading, gapAfter: 6 });
  }

  newPage();
  write(`Application preview for ${supplement.college} (sample)`, { font: bold, size: SIZE.title, gapAfter: 10 });
  const info = app.personalInfo;
  write(`Name: ${info.name}\nSchool: ${info.school}\nGraduation year: ${info.graduationYear}\nEmail: ${info.email}`);

  heading('Activities and Experiences');
  app.activities.forEach((activity, i) => {
    write(`Activity ${i + 1}`, { font: bold, gapAfter: 2 });
    write(activityText(activity), { gapAfter: 10 });
  });

  heading('Honors');
  app.honors.forEach((honor, i) => {
    write(`Honor ${i + 1}`, { font: bold, gapAfter: 2 });
    write(honorText(honor), { gapAfter: 10 });
  });

  heading('Personal Essay');
  write(app.personalEssay.prompt, { font: bold, gapAfter: 6 });
  for (const paragraph of app.personalEssay.text.split('\n\n')) write(paragraph, { gapAfter: 8 });

  newPage();
  heading(`Questions and Writing for ${supplement.college}`);
  write(supplement.prompt, { font: bold, gapAfter: 6 });
  for (const paragraph of supplement.text.split('\n\n')) write(paragraph, { gapAfter: 8 });

  return pdf;
}

for (const supplement of app.supplements) {
  const pdf = await buildFor(supplement);
  const name = `application-${supplement.id.replace('supplement-', '')}.pdf`;
  writeFileSync(new URL(`../sample/${name}`, import.meta.url), await pdf.save());
  console.log(`wrote sample/${name} (${pdf.getPageCount()} pages)`);
}
