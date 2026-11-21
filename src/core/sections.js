// Turns a structured application into sections: { sectionId: text }.
//
// This is the shape every check works on, and the shape quotes are verified
// against. The PDF/paste-in sectioner (Nov 21) must produce the same shape, so
// the same checks and quote rules work whichever way the text came in.

/** Common App field limits, characters (2026-27; unchanged from earlier years). */
export const LIMITS = {
  activityPosition: 50,
  activityOrganization: 100,
  activityDescription: 150,
  honorTitle: 100,
};

/** Text for one activity, one labeled line per field, in Common App order. */
export function activityText(activity) {
  return [
    `Activity type: ${activity.type}`,
    `Position: ${activity.position}`,
    `Organization: ${activity.organization}`,
    `Description: ${activity.description}`,
    `Grades: ${activity.grades.join(', ')}`,
    `Timing: ${activity.timing}`,
    `Hours per week: ${activity.hoursPerWeek}`,
    `Weeks per year: ${activity.weeksPerYear}`,
  ].join('\n');
}

/** Text for one honor. */
export function honorText(honor) {
  return [
    `Title: ${honor.title}`,
    `Grades: ${honor.grades.join(', ')}`,
    `Level of recognition: ${honor.level}`,
  ].join('\n');
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
