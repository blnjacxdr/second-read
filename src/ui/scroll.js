// Smooth scrolling for the start page: links glide to their section, and the fold moves in steps
// (one wheel tick or arrow key plays one whole step). Ported from the approved canvas (Main.dc.html).
// Any wheel, touch, key or click stops a glide, so the page never fights the person.

const reduced = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const STEPS = [0, 0.14, 0.72, 1]; // share of the fold's scroll: start, lines highlighted, folded with the brace, done

export function startScrolling() {
  let gliding = false;
  let stepping = false;
  let glideFrame = 0;
  let lastY = window.scrollY;

  function stopGlide() {
    if (gliding) { gliding = false; lastY = window.scrollY; }
    cancelAnimationFrame(glideFrame);
  }

  // Scrolls to y on an ease-in-out curve, slower for longer trips. With reduced motion it jumps.
  function glide(y, onDone) {
    stopGlide();
    const from = window.scrollY;
    const dist = y - from;
    if (Math.abs(dist) < 2 || reduced()) { window.scrollTo({ top: y, behavior: 'instant' }); lastY = y; onDone?.(); return; }
    const duration = Math.min(1300, 480 + Math.abs(dist) * 0.4);
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const start = performance.now();
    gliding = true;
    const tick = (now) => {
      if (!gliding) return;
      const t = Math.min(1, (now - start) / duration);
      window.scrollTo({ top: from + dist * ease(t), behavior: 'instant' });
      if (t < 1) { glideFrame = requestAnimationFrame(tick); return; }
      gliding = false;
      lastY = y;
      onDone?.();
    };
    glideFrame = requestAnimationFrame(tick);
  }

  // Where the fold is: its scroll range and how far through it we are (0 to 1). Null when it isn't pinned.
  function foldState() {
    const fold = document.querySelector('.sr-fold');
    if (!fold || fold.offsetParent === null || getComputedStyle(fold.querySelector('.sr-fstage')).position !== 'sticky') return null;
    const range = fold.getBoundingClientRect().height - window.innerHeight; // includes CSS zoom, like scrollY
    return range > 0 ? { range, p: -fold.getBoundingClientRect().top / range } : null;
  }

  // Inside the fold, one wheel tick or arrow key moves one whole step right away. While a step plays (and briefly
  // after, so a trackpad's coasting doesn't skip one), extra input is swallowed. Outside the fold, nothing changes.
  function stepFold(e, dir) {
    if (!dir || reduced()) return;
    const f = foldState();
    if (!f) return;
    const { p, range } = f;
    const inside = dir > 0 ? p >= -0.04 && p < 0.998 : p > 0.002 && p <= 1.04;
    if (!inside) return;
    e.preventDefault();
    if (stepping) return;
    const to = dir > 0 ? STEPS.find((q) => q > Math.max(p, 0) + 0.01) : [...STEPS].reverse().find((q) => q < p - 0.01);
    if (to === undefined) return;
    stepping = true;
    glide(window.scrollY + (to - p) * range, () => setTimeout(() => { stepping = false; }, 280));
  }

  // Backup for scrollbar drags: when scrolling stops partway through the fold, finish the step in that direction.
  function settleFold() {
    if (gliding) return;
    const f = foldState();
    if (!f || f.p <= 0.002 || f.p >= 0.998) { lastY = window.scrollY; return; }
    const { p, range } = f;
    const dir = Math.sign(window.scrollY - lastY);
    let to = dir > 0 ? STEPS.find((q) => q > p + 0.01) : dir < 0 ? [...STEPS].reverse().find((q) => q < p - 0.01) : undefined;
    if (to === undefined) to = STEPS.reduce((a, q) => (Math.abs(q - p) < Math.abs(a - p) ? q : a));
    if (Math.abs(to - p) * range < 3) { lastY = window.scrollY; return; }
    glide(window.scrollY + (to - p) * range);
  }

  window.addEventListener('scrollend', settleFold);
  window.addEventListener('wheel', (e) => stepFold(e, Math.sign(e.deltaY)), { passive: false });
  window.addEventListener('keydown', (e) => {
    const dir = { ArrowDown: 1, PageDown: 1, ' ': e.shiftKey ? -1 : 1, ArrowUp: -1, PageUp: -1 }[e.key];
    if (dir && !/INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY/.test(document.activeElement.tagName)) stepFold(e, dir);
  });
  ['touchstart', 'mousedown'].forEach((t) => window.addEventListener(t, () => { if (!stepping) stopGlide(); }, { passive: true }));

  // Links marked .js-goto glide to their target. The fold link lands on its first step.
  document.querySelectorAll('.js-goto').forEach((link) => link.addEventListener('click', (e) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target || target.offsetParent === null) return;
    e.preventDefault();
    const f = target.id === 'fold' ? foldState() : null;
    const y = target.getBoundingClientRect().top + window.scrollY;
    glide(f ? y + 0.14 * f.range : y - 24);
  }));

  // Buttons in the fold: Back and Next play one step, Skip glides past it to the promises.
  function stepBy(dir) {
    const f = foldState();
    if (!f) return;
    const { p, range } = f;
    const to = dir > 0 ? STEPS.find((q) => q > Math.max(p, 0) + 0.01) : [...STEPS].reverse().find((q) => q < p - 0.01);
    if (to === undefined) { if (dir > 0) skipFold(); return; }
    glide(window.scrollY + (to - Math.max(0, Math.min(1, p))) * range + (p < 0 ? -p * range : 0));
  }
  function skipFold() {
    const how = document.getElementById('how');
    if (how) glide(how.getBoundingClientRect().top + window.scrollY - 40);
  }
  document.getElementById('fold-back')?.addEventListener('click', () => stepBy(-1));
  document.getElementById('fold-next')?.addEventListener('click', () => stepBy(1));
  document.getElementById('fold-skip')?.addEventListener('click', skipFold);

  // The fold's own progress line, and the Back to top button once the hero is out of sight.
  const top = document.getElementById('to-top');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const f = foldState();
      if (f) {
        document.getElementById('fold-back').disabled = f.p <= 0.01;
        document.getElementById('fold-next').textContent = f.p >= 0.99 ? 'Keep going' : 'Next';
      }
      // Shown once the top is out of sight, and tucked away again at the very bottom, where it would cover the footer.
      const nearBottom = window.scrollY + window.innerHeight > document.documentElement.scrollHeight - 140;
      document.body.classList.toggle('scrolled', window.scrollY > 8);
      // Back to top shows once the first screen is out of sight, and tucks away at the very bottom, where it
      // would cover the footer.
      if (top) top.classList.toggle('show', document.body.classList.contains('phase-start') && window.scrollY > window.innerHeight * 1.1 && !nearBottom);
    });
  }, { passive: true });
  top?.addEventListener('click', () => glide(0));

  return { toTop: () => glide(0) };
}
