// Expressions for the pencil eyes. No mouth on purpose: the eyes are the brand, and the lids can say enough.
//   happy:   a cheek rises from below each eye, so the open part is an upturned arch (like ^ ^)
//   worried: the top lids come down at a tilt, higher on the inside
// Lids are yellow shapes clipped to each wood circle, the same trick as the start page's blink.
// Built with DOM calls, never HTML strings.

const NS = 'http://www.w3.org/2000/svg';
let ids = 0;

function node(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/**
 * Adds a top and bottom lid over each eye in an SVG.
 * @param {SVGSVGElement} svg
 * @param {Array<[number, number, string?]>} centers  each eye's wood-circle center in the SVG's own units (radius 31),
 *   and which side it is ('left' or 'right'; by default the first is left and the rest right)
 */
export function addFace(svg, centers) {
  if (!svg || svg.dataset.face) return;
  svg.dataset.face = 'on';
  svg.classList.add('sr-face');
  const defs = svg.querySelector('defs') ?? svg.insertBefore(node('defs', {}), svg.firstChild);
  centers.forEach(([cx, cy, side], i) => {
    const id = `sr-face-clip-${(ids += 1)}`;
    const clip = node('clipPath', { id });
    clip.append(node('circle', { cx, cy, r: 31 }));
    defs.append(clip);
    const g = node('g', { 'clip-path': `url(#${id})` });
    // The worried lid: its bottom edge sits at the top of the eye until it's needed. Its turn is set per eye in CSS,
    // the inner side higher, so the pair reads as worried and not angry.
    const top = node('rect', { class: `sr-ltop ${side ?? (i === 0 ? 'left' : 'right')}`, x: cx - 40, y: cy - 75, width: 80, height: 44, fill: '#FFC21A' });
    top.style.transformOrigin = `${cx}px ${cy - 31}px`;
    // The happy cheek: a hill whose top edge follows the top of the eye, leaving a thin upturned arch (^ ^).
    const bottom = node('path', { class: 'sr-lbot', d: `M${cx - 40} ${cy + 40} V${cy - 2} Q${cx} ${cy - 44} ${cx + 40} ${cy - 2} V${cy + 40} Z`, fill: '#FFC21A' });
    g.append(top, bottom);
    svg.append(g);
    // The ink arch for happy: drawn over the cheek's edge, outside the clip so its round ends show.
    svg.append(node('path', { class: 'sr-smile', d: `M${cx - 21} ${cy - 2} Q${cx} ${cy - 30} ${cx + 21} ${cy - 2}`, fill: 'none', stroke: '#16181D', 'stroke-width': 7, 'stroke-linecap': 'round', pathLength: 1 }));
  });
}

const timers = new WeakMap();

/** Shows a mood ('happy', 'worried' or null for neutral). With ms, it goes back to neutral after that long. */
export function setFace(svg, mood, ms = 0) {
  if (!svg) return;
  clearTimeout(timers.get(svg));
  svg.classList.toggle('face-happy', mood === 'happy');
  svg.classList.toggle('face-worried', mood === 'worried');
  if (mood && ms) timers.set(svg, setTimeout(() => setFace(svg, null), ms));
}
