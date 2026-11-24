// The handwritten note under the eyes on the start page usually says where the read happens. On a few nights it
// says something to the student instead: when it's very late, and in the days before the big deadlines.
// Pure, so it can be tested with any date. Uses the student's own clock, never anything else.

// Common App deadlines most students face: Early (Nov 1, Nov 15) and Regular (Jan 1, Jan 15). Month is 0-based.
const DEADLINES = [
  { month: 10, day: 1, name: 'Nov 1' },
  { month: 10, day: 15, name: 'Nov 15' },
  { month: 0, day: 1, name: 'Jan 1' },
  { month: 0, day: 15, name: 'Jan 15' },
];

const DAY = 24 * 60 * 60 * 1000;

function clock(date) {
  const h = date.getHours() % 12 || 12;
  return `${h}:${String(date.getMinutes()).padStart(2, '0')} am`;
}

/** Days from `date` (local midnight) until the next deadline within 3 days, or null. */
export function nearDeadline(date) {
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (const d of DEADLINES) {
    for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
      const days = Math.round((new Date(year, d.month, d.day) - today) / DAY);
      if (days >= 0 && days <= 3) return { days, name: d.name };
    }
  }
  return null;
}

/** The note to show, or null for the usual one. */
export function marginNote(date) {
  const late = date.getHours() < 5; // midnight to 4:59 am
  const deadline = nearDeadline(date);
  if (deadline && deadline.days === 0) return `it's ${deadline.name}. breathe. one more read, then they submit.`;
  if (late) return `it's ${clock(date)}. the essays will still be here after some sleep.`;
  if (deadline) return `${deadline.days} ${deadline.days === 1 ? 'day' : 'days'} until ${deadline.name}. you've got this.`;
  return null;
}
