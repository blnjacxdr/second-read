// Reads a Common App preview PDF (one college's copy) from rows of cells.
//
// Every preview PDF uses the same template, so this reads formatting, not
// wording, and works for any college without knowing its questions:
//   24 pt bold    main section ("Activities and experiences", "Writing",
//                 "<College> questions")
//   16.5 pt bold  subsection ("Personal essay", "Honors", an activity's category)
//   bold, left    a field label or an essay prompt
//   regular       an answer: right column for short answers, full width for essays
//
// Only the parts the checks need are kept: activities, honors, essays and the
// college's own questions. Addresses, family details, grades and test scores
// are read past and never stored.

import { activityText, honorText } from './sections.js';

const LEVEL_1 = 20; // main section heading height (24 pt)
const LEVEL_2 = 15; // subsection heading height (16.5 pt)
const LEVEL_3 = 13; // minor heading height (13.5 pt)
const LEFT_COLUMN_END = 120; // label column; answers start further right
const ANSWER_COLUMN = 150;
const LABEL_COLUMN_END = 176; // wrapped question text ends before the answer column (x = 179)

const COLLEGE_SECTION = /^(.+) questions$/;

/** A heading is a row with a single bold cell at heading size. */
function headingLevel(row) {
  if (row.cells.length !== 1 || !row.cells[0].bold) return 0;
  if (row.height >= LEVEL_1) return 1;
  if (row.height >= LEVEL_2) return 2;
  if (row.height >= LEVEL_3) return 3;
  return 0;
}

/** Joins wrapped lines: no space after a hyphenated word break ("Spanish-" + "speaking"). */
export function joinLines(lines) {
  return lines.reduce((text, line) => {
    if (!text) return line;
    return /\p{L}-$/u.test(text) ? text + line : `${text} ${line}`;
  }, '');
}

/** Vertical distance from one row to the next on the same page; null across a page break. */
function gapBetween(previous, row) {
  return previous && previous.page === row.page ? previous.y - row.y : null;
}

/**
 * Reads a run of rows made of short answers and/or essays.
 *
 * Short answer: question text in the left column, answer in the right column.
 * Usually the question is bold, but some colleges' blocks swap the fonts, so
 * columns and line spacing decide, not boldness. Both sides may wrap: wrapped
 * lines are about 1.2 lines apart, separate questions further apart.
 *
 * Essay: bold prompt line(s), then regular full-width lines; a bigger gap
 * between lines starts a new paragraph.
 *
 * @returns {{ fields: Array<{ label: string, values: string[] }>, essays: Array<{ prompt: string|null, text: string }> }}
 */
export function readQuestions(rows) {
  const fields = [];
  const essays = [];
  let field = null; // { labelLines: string[], columns: string[][], xs: number[] }
  let essay = null; // { promptLines: string[], paragraphs: string[][] }
  let previous = null;
  let previousKind = null;

  const finishField = () => {
    if (!field) return;
    fields.push({ label: joinLines(field.labelLines), values: field.columns.map(joinLines) });
    field = null;
  };
  const finishEssay = () => {
    if (!essay) return;
    const text = essay.paragraphs.map(joinLines).filter(Boolean).join('\n\n');
    essays.push({ prompt: essay.promptLines.length ? joinLines(essay.promptLines) : null, text });
    essay = null;
  };
  const addToColumns = (cells) => {
    for (const cell of cells) {
      const column = field.xs.reduce((best, x, i) => (Math.abs(x - cell.x) < Math.abs(field.xs[best] - cell.x) ? i : best), 0);
      field.columns[column].push(cell.text);
    }
  };

  for (const row of rows) {
    const left = row.cells.filter((c) => c.x < LEFT_COLUMN_END);
    const right = row.cells.filter((c) => c.x >= ANSWER_COLUMN);
    const leftText = left.map((c) => c.text).join(' ');
    const gap = gapBetween(previous, row);
    const wrapsFromPrevious = gap !== null && gap <= row.height * 1.4;
    const inField = field && previousKind === 'field';
    // Question text stays inside the left column; essay lines run across the page.
    const narrowLeft = left.length > 0 && left.every((c) => c.end < LABEL_COLUMN_END);

    if (left.length > 0 && right.length > 0) {
      if (inField && wrapsFromPrevious) {
        field.labelLines.push(leftText); // question and answer both wrap onto this line
        addToColumns(right);
      } else {
        finishField();
        finishEssay();
        field = { labelLines: [leftText], columns: right.map((c) => [c.text]), xs: right.map((c) => c.x) };
        previousKind = 'field';
      }
    } else if (right.length > 0 && field) {
      addToColumns(right); // only the answer wraps
    } else if (left.length > 0 && inField && narrowLeft && (gap === null || wrapsFromPrevious)) {
      field.labelLines.push(leftText); // only the question wraps (also across a page break)
    } else if (left.length > 0 && left.every((c) => c.bold)) {
      finishField();
      if (essay && essay.paragraphs.some((p) => p.length)) finishEssay();
      if (!essay) essay = { promptLines: [], paragraphs: [[]] };
      essay.promptLines.push(leftText);
      previousKind = 'prompt';
    } else if (left.length > 0) {
      finishField();
      if (!essay) essay = { promptLines: [], paragraphs: [[]] };
      const newParagraph = previousKind === 'essay' && gap !== null && gap > row.height * 1.6;
      if (newParagraph) essay.paragraphs.push([]);
      essay.paragraphs.at(-1).push(row.cells.map((c) => c.text).join(' '));
      previousKind = 'essay';
    }
    previous = row;
  }
  finishField();
  finishEssay();
  return { fields, essays };
}

/** "10, 11, 12 (School)" -> { grades: [10, 11, 12], timing: 'School' }; "K" and "PG" stay as text. */
function parseGradesAndTiming(text) {
  const match = text.match(/^(.+?)\s*\((School|Break|Year)\)$/);
  if (!match) return null;
  const grades = match[1].split(',').map((g) => g.trim()).filter(Boolean).map((g) => (/^\d+$/.test(g) ? Number(g) : g));
  return { grades, timing: match[2] };
}

/** One activity block: left column details, right column bold heading and regular description. */
function readActivity(id, category, rows) {
  const details = [];
  const headingLines = [];
  const descriptionLines = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.x < LEFT_COLUMN_END) details.push(cell.text);
      else if (cell.bold) headingLines.push(cell.text);
      else descriptionLines.push(cell.text);
    }
  }
  const activity = { id, category, heading: joinLines(headingLines), description: joinLines(descriptionLines), details };
  for (const detail of details) {
    const gradesAndTiming = parseGradesAndTiming(detail);
    const hours = detail.match(/^(\d+) hr\/wk, (\d+) wk\/yr$/);
    if (gradesAndTiming) Object.assign(activity, gradesAndTiming);
    else if (hours) Object.assign(activity, { hoursPerWeek: Number(hours[1]), weeksPerYear: Number(hours[2]) });
    else activity.plans = detail;
  }
  return activity;
}

/** Cuts rows into { level-1 title, level-2 title, rows } blocks. */
function blocksOf(rows) {
  const blocks = [];
  let section = null;
  let block = null;
  for (const row of rows) {
    const level = headingLevel(row);
    if (level === 1) {
      section = row.cells[0].text;
      block = { section, subsection: null, rows: [] };
      blocks.push(block);
    } else if (level === 2) {
      block = { section, subsection: row.cells[0].text, rows: [] };
      blocks.push(block);
    } else if (block) {
      block.rows.push(row); // level-3 headings stay in the block as plain rows
    }
  }
  return blocks;
}

/**
 * @param {ReturnType<import('./pdf-lines.js').buildRows>} rows
 * @returns {{
 *   college: string|null,
 *   activities: object[], honors: object[],
 *   personalEssay: { prompt: string|null, text: string }|null,
 *   additionalInformation: { prompt: string|null, text: string }|null,
 *   collegeEssays: Array<{ id: string, group: string, prompt: string|null, text: string }>,
 *   collegeAnswers: Array<{ group: string, label: string, values: string[] }>,
 *   sections: Record<string, string>,
 *   missing: string[],
 * }}
 */
export function readCommonApp(rows) {
  const result = {
    college: null, activities: [], honors: [], personalEssay: null, additionalInformation: null,
    collegeEssays: [], collegeAnswers: [], sections: {}, missing: [],
  };

  for (const block of blocksOf(rows)) {
    const { section, subsection } = block;
    const collegeMatch = section && section.match(COLLEGE_SECTION);

    if (section === 'Activities and experiences' && subsection && subsection !== 'Responsibilities and circumstances') {
      result.activities.push(readActivity(`activity-${result.activities.length + 1}`, subsection, block.rows));
    } else if (section === 'Education' && subsection === 'Honors') {
      for (const { label, values } of readQuestions(block.rows).fields) {
        const [level = '', grades = ''] = values;
        result.honors.push({
          id: `honor-${result.honors.length + 1}`,
          title: label,
          level,
          grades: grades.split(',').map((g) => g.trim()).filter(Boolean).map((g) => (/^\d+$/.test(g) ? Number(g) : g)),
        });
      }
    } else if (section === 'Writing' && (subsection === 'Personal essay' || subsection === 'Additional information')) {
      const essay = readQuestions(block.rows).essays[0] ?? null;
      if (subsection === 'Personal essay') result.personalEssay = essay;
      else result.additionalInformation = essay;
    } else if (collegeMatch && subsection === 'Affirmations') {
      // Common App's signed statement, the same for everyone: nothing to check.
    } else if (collegeMatch && subsection) {
      result.college = collegeMatch[1].trim();
      const { fields, essays } = readQuestions(block.rows);
      for (const field of fields) result.collegeAnswers.push({ group: subsection, ...field });
      for (const essay of essays) {
        if (!essay.text) continue;
        result.collegeEssays.push({ id: `college-essay-${result.collegeEssays.length + 1}`, group: subsection, ...essay });
      }
    } else if (collegeMatch) {
      result.college = collegeMatch[1].trim();
    }
  }

  // The { sectionId: text } map that checks and quote verification use.
  for (const activity of result.activities) result.sections[activity.id] = activityText(activity);
  for (const honor of result.honors) result.sections[honor.id] = honorText(honor);
  if (result.personalEssay) result.sections['personal-essay'] = result.personalEssay.text;
  if (result.additionalInformation) result.sections['additional-information'] = result.additionalInformation.text;
  for (const essay of result.collegeEssays) result.sections[essay.id] = essay.text;

  // Missing parts are reported to the user, never silently skipped.
  if (result.activities.length === 0) result.missing.push('activities');
  if (!result.personalEssay) result.missing.push('personal essay');
  if (!result.college) result.missing.push("the college's own questions");
  return result;
}
