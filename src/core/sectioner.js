// Splits an application's lines into sections: activities, honors, the
// personal essay and the college's supplement.
//
// Everything specific to one PDF format (headings, field labels) lives in a
// "layout" object, so supporting a new format means writing a new layout, not
// changing this logic. SAMPLE_LAYOUT matches our fictional sample PDFs.
// TODO(Nov 21): add COMMON_APP_LAYOUT once we know the real preview PDF's headings.

import { activityText, honorText } from './sections.js';

/** The layout of sample/application-*.pdf (built by tools/make-sample-pdf.js). */
export const SAMPLE_LAYOUT = {
  name: 'Second Read sample',
  headings: {
    activities: /^Activities and Experiences$/,
    honors: /^Honors$/,
    personalEssay: /^Personal Essay$/,
    supplement: /^Questions and Writing for (.+)$/, // capture group 1 = college name
  },
  itemStarts: {
    activities: /^Activity (\d+)$/,
    honors: /^Honor (\d+)$/,
  },
  activityFields: {
    'Activity type': 'type',
    Position: 'position',
    Organization: 'organization',
    Description: 'description',
    Grades: 'grades',
    Timing: 'timing',
    'Hours per week': 'hoursPerWeek',
    'Weeks per year': 'weeksPerYear',
  },
  honorFields: {
    Title: 'title',
    Grades: 'grades',
    'Level of recognition': 'level',
  },
  // The first line under these headings is the prompt, not the student's writing.
  essayPrompt: /^Personal essay \(/,
  supplementPrompt: /\(Made-up prompt, up to \d+ words\.\)$/,
};

/**
 * Reads "Label: value" lines into an object, joining wrapped lines onto the
 * field they continue. Only labels listed in `fieldMap` start a new field, so
 * a colon inside a description doesn't break it.
 *
 * @param {string[]} lines
 * @param {Record<string, string>} fieldMap  label as printed -> property name
 * @returns {Record<string, string>}
 */
export function parseFields(lines, fieldMap) {
  const fields = {};
  let currentKey = null;
  for (const line of lines) {
    const colon = line.indexOf(': ');
    const label = colon > 0 ? line.slice(0, colon) : null;
    if (label && Object.hasOwn(fieldMap, label)) {
      currentKey = fieldMap[label];
      fields[currentKey] = line.slice(colon + 2).trim();
    } else if (currentKey) {
      fields[currentKey] += ' ' + line.trim();
    }
  }
  return fields;
}

/** Splits lines into numbered items ("Activity 1", "Activity 2", …). Lines before the first item are ignored. */
function splitItems(lines, startPattern) {
  const items = [];
  for (const line of lines) {
    const match = line.match(startPattern);
    if (match) items.push({ number: Number(match[1]), lines: [] });
    else if (items.length > 0) items.at(-1).lines.push(line);
  }
  return items;
}

/** Turns "9, 10, 11, 12" into [9, 10, 11, 12]; numbers stay numbers where the sample JSON has numbers. */
function toActivity(id, fields) {
  return {
    id,
    ...fields,
    grades: fields.grades ? fields.grades.split(',').map((g) => Number(g.trim())) : [],
    hoursPerWeek: fields.hoursPerWeek === undefined ? undefined : Number(fields.hoursPerWeek),
    weeksPerYear: fields.weeksPerYear === undefined ? undefined : Number(fields.weeksPerYear),
  };
}

function toHonor(id, fields) {
  return { id, ...fields, grades: fields.grades ? fields.grades.split(',').map((g) => Number(g.trim())) : [] };
}

/** Joins prose lines into one string, dropping the prompt line if the layout marks one. */
function proseText(lines, promptPattern) {
  const body = lines.length > 0 && promptPattern && promptPattern.test(lines[0]) ? lines.slice(1) : lines;
  return {
    prompt: body === lines ? null : lines[0],
    text: body.join(' ').replace(/\s+/g, ' ').trim(),
  };
}

/**
 * @param {string[]} lines  all lines of the application, headers and footers removed
 * @param {typeof SAMPLE_LAYOUT} layout
 * @returns {{
 *   activities: object[], honors: object[],
 *   personalEssay: { id: string, prompt: string|null, text: string } | null,
 *   supplement: { id: string, college: string, prompt: string|null, text: string } | null,
 *   sections: Record<string, string>,
 *   unmatchedHeadings: string[],
 * }}
 */
export function splitApplication(lines, layout = SAMPLE_LAYOUT) {
  // 1. Cut the lines into blocks at each heading.
  const blocks = { activities: [], honors: [], personalEssay: [], supplement: [] };
  let college = null;
  let current = null;
  for (const line of lines) {
    const headingKey = Object.keys(layout.headings).find((key) => layout.headings[key].test(line));
    if (headingKey) {
      current = headingKey;
      if (headingKey === 'supplement') college = line.match(layout.headings.supplement)[1].trim();
      continue;
    }
    if (current) blocks[current].push(line);
  }

  // 2. Parse each block.
  const activities = splitItems(blocks.activities, layout.itemStarts.activities)
    .map((item) => toActivity(`activity-${item.number}`, parseFields(item.lines, layout.activityFields)));
  const honors = splitItems(blocks.honors, layout.itemStarts.honors)
    .map((item) => toHonor(`honor-${item.number}`, parseFields(item.lines, layout.honorFields)));
  const personalEssay = blocks.personalEssay.length
    ? { id: 'personal-essay', ...proseText(blocks.personalEssay, layout.essayPrompt) }
    : null;
  const supplement = blocks.supplement.length
    ? { id: 'supplement', college, ...proseText(blocks.supplement, layout.supplementPrompt) }
    : null;

  // 3. Build the { sectionId: text } map that checks and quote verification use.
  // Activities and honors use the same labeled-line text as the sample JSON, so
  // a quote like "Hours per week: 6" works whichever way the application came in.
  const sections = {};
  for (const activity of activities) sections[activity.id] = activityText(activity);
  for (const honor of honors) sections[honor.id] = honorText(honor);
  if (personalEssay) sections[personalEssay.id] = personalEssay.text;
  if (supplement) sections[supplement.id] = supplement.text;

  // Headings we expected but never saw: shown to the user so a format change is noticed, not silent.
  const unmatchedHeadings = Object.keys(layout.headings).filter((key) => blocks[key].length === 0);

  return { activities, honors, personalEssay, supplement, sections, unmatchedHeadings };
}
