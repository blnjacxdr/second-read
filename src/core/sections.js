// Turns a structured application into sections: { sectionId: text }.
//
// This is the shape every check works on, and the shape quotes are verified
// against. The PDF reader (src/core/common-app.js) produces the same shape, so
// the same checks and quote rules work whichever way the text came in.

/** Common App field limits, characters (2026-27; unchanged from earlier years). */
export const LIMITS = {
  activityPosition: 50,
  activityOrganization: 100,
  activityDescription: 150,
  honorTitle: 100,
};

/**
 * Text for one activity, laid out the way the Common App preview PDF shows it,
 * so quotes look like the student's own application:
 *   Computer or technology
 *   Juniper Ridge Robotics (FIRST Robotics Competition), Lead Programmer
 *   Write autonomous code in Java…
 *   10, 11, 12 (School)
 *   6 hr/wk, 30 wk/yr
 *   Will continue
 * Accepts an activity read from a PDF (category, heading, details) or one from
 * the sample JSON (type, organization, position, grades, timing, hours, plans).
 */
export function activityText(activity) {
  const heading = activity.heading ?? [activity.organization, activity.position].filter(Boolean).join(', ');
  const details = activity.details ?? [
    `${activity.grades.join(', ')} (${activity.timing})`,
    `${activity.hoursPerWeek} hr/wk, ${activity.weeksPerYear} wk/yr`,
    activity.plans,
  ];
  return [activity.category ?? activity.type, heading, activity.description, ...details].filter(Boolean).join('\n');
}

/** Text for one honor, in the PDF's order: title, level of recognition, grades. */
export function honorText(honor) {
  return [honor.title, honor.level, honor.grades.join(', ')].filter(Boolean).join('\n');
}

/**
 * @param {object} application  see sample/application.json for the shape
 * @returns {Record<string, string>}
 */
export function applicationSections(application) {
  const sections = {};
  for (const activity of application.activities) sections[activity.id] = activityText(activity);
  for (const honor of application.honors) sections[honor.id] = honorText(honor);
  sections[application.personalEssay.id] = application.personalEssay.text;
  for (const supplement of application.supplements) sections[supplement.id] = supplement.text;
  return sections;
}

/** Words as Common App counts them closely enough for a warning: runs of non-space characters. */
export function countWords(text) {
  const words = text.trim().split(/\s+/);
  return words[0] === '' ? 0 : words.length;
}
