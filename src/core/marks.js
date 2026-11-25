// Proofreader's marks in the page margins, on every phase. Where they go is decided here (pure, so it's tested and
// lands the same way every time: no marks jumping around when the page grows). src/ui/marks.js draws them.
//
// The marks are the ones a careful second reader makes: a check, an insert caret, a circled question, a transpose
// loop, a paragraph mark, a footnote star, and "stet" (Latin for "let it stand": the proofreader's "It's fine").

export const MARK_SHAPES = ['check', 'caret', 'query', 'transpose', 'pilcrow', 'star', 'stet'];

/**
 * @param {number} height  the page's height in CSS pixels
 * @param {{ spacing?: number, start?: number }} options  spacing: about how far apart marks are, down each side
 * @returns {Array<{ side: 'left'|'right', top: number, offset: number, shape: string, tilt: number }>}
 *   offset: pixels out from the content edge into the margin; tilt: degrees
 */
export function planMarks(height, { spacing = 380, start = 120 } = {}) {
  const marks = [];
  if (!(height > start)) return marks;
  // A small fixed-seed generator: the same page height always gives the same marks.
  let seed = 7;
  const next = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  let i = 0;
  for (let top = start; top < height - 80; top += spacing * (0.75 + next() * 0.5)) {
    const side = i % 2 === 0 ? 'left' : 'right';
    marks.push({
      side,
      top: Math.round(top),
      offset: Math.round(40 + next() * 110),
      shape: MARK_SHAPES[(i * 3 + Math.floor(next() * 2)) % MARK_SHAPES.length],
      tilt: Math.round((next() - 0.5) * 16),
    });
    i += 1;
  }
  return marks;
}
