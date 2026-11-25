// Draws the proofreader's marks down both page margins, on every phase. Where they go comes from planMarks
// (src/core/marks.js). Decoration only: hidden from screen readers, never clickable, hidden in print and on phones.
// They sit in the margins outside the 1240px content column, and CSS min() keeps them clear of the red margin line.

import { planMarks } from '../core/marks.js';

const NS = 'http://www.w3.org/2000/svg';
// Each shape: its box, then its pen strokes. Drawn by hand to look like pen marks, not icons.
const SHAPES = {
  check: { w: 44, h: 36, paths: ['M4 19 C 8 23, 11 27, 14 31 C 20 18, 29 9, 40 3'] },
  caret: { w: 34, h: 34, paths: ['M5 29 C 9 21, 13 12, 17 4 C 21 12, 25 21, 29 29'] },
  query: { w: 52, h: 52, paths: ['M26 5 C 14 4, 5 13, 6 26 C 7 39, 17 47, 28 46 C 40 45, 47 35, 46 24 C 45 13, 37 6, 24 6', 'M20 20 C 20 15, 24 13, 27 13 C 31 13, 33 16, 32 20 C 31 24, 26 25, 26 30', 'M26 37 L 26.5 37.5'] },
  transpose: { w: 70, h: 40, paths: ['M4 24 C 10 6, 26 4, 33 18 C 40 32, 56 34, 64 14', 'M57 16 L 64 13 L 66 21'] },
  pilcrow: { w: 34, h: 46, paths: ['M22 4 V 42', 'M29 4 V 42', 'M31 4 H 16 C 6 4, 4 20, 15 21 H 22'] },
  star: { w: 36, h: 36, paths: ['M18 5 C 18 14, 18 22, 18 31', 'M7 11 C 14 15, 22 20, 29 25', 'M29 11 C 22 15, 14 20, 7 25'] },
  stet: { w: 80, h: 44, word: 'stet', paths: ['M8 34 C 24 31, 44 36, 66 32'] },
};
const MARGIN_LINE = 84; // keep left-side marks right of the red margin line (64px) with a little room

function drawMark({ side, top, offset, shape, tilt }) {
  const s = SHAPES[shape];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', `sr-mark${s.word ? ' sr-mark-word' : ''}`);
  svg.setAttribute('width', String(s.w));
  svg.setAttribute('height', String(s.h));
  svg.setAttribute('viewBox', `0 0 ${s.w} ${s.h}`);
  const out = `calc(50% + 620px + ${offset}px)`;
  svg.style.top = `${top}px`;
  svg.style.rotate = `${tilt}deg`;
  if (side === 'left') svg.style.right = `min(${out}, calc(100% - ${MARGIN_LINE + s.w}px))`;
  else svg.style.left = `min(${out}, calc(100% - ${24 + s.w}px))`;
  if (s.word) {
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', '8');
    text.setAttribute('y', '26');
    text.textContent = s.word;
    svg.append(text);
  }
  for (const d of s.paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('pathLength', '1');
    svg.append(path);
  }
  return svg;
}

/** Starts the margin marks for the whole page. They follow the page's height as phases change. */
export function startMarks() {
  const page = document.getElementById('page');
  if (!page) return;
  const layer = document.createElement('div');
  layer.className = 'sr-margin sr-margin-marks';
  layer.setAttribute('aria-hidden', 'true');
  page.prepend(layer);
  // Each mark draws itself once, all the way, when it first scrolls into view (never left half-drawn).
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-drawn');
      watcher.unobserve(entry.target);
    }
  }, { threshold: 0.6 });
  let shown = 0;
  const update = () => {
    // A taller page only adds marks below the ones already there (the plan for a taller page starts the same way),
    // so nothing already on screen moves or redraws.
    const plan = planMarks(page.scrollHeight);
    while (shown > plan.length) { layer.lastChild?.remove(); shown -= 1; }
    for (; shown < plan.length; shown += 1) {
      const mark = drawMark(plan[shown]);
      layer.append(mark);
      watcher.observe(mark);
    }
  };
  let timer = 0;
  new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(update, 150); }).observe(page);
  update();
}
