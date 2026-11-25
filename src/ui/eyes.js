// The pencil eyes on the start page: they wake up, follow the cursor on a spring, look down at a file
// dragged over the drop sheet, and doze off after 20 seconds of no mouse movement.
// Ported from the approved canvas (Main.dc.html). Moves only SVG transforms; nothing re-renders.

const reduced = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export function startEyes() {
  const eyes = [0, 1].map(() => ({ yaw: 0, pitch: 0, vy: 0, vp: 0, ty: 0, tp: 0 }));
  const wrap = document.getElementById('eyes-wrap');
  let following = false;
  let cursor = null;
  let asleep = false;
  let looking = false; // looking down at the drop sheet
  let frame = 0;
  let last = 0;
  let nap = 0;

  // Moves each pupil in the SVG: 28 degrees of gaze = 9 units, the edge of the wood. The card leans the same way.
  function paint() {
    eyes.forEach((e, i) => {
      const g = document.querySelector(`#sr-eye-${i + 1} .sr-pupil`);
      if (g) g.setAttribute('transform', `translate(${(e.yaw * 9 / 28).toFixed(2)} ${(e.pitch * 9 / 28).toFixed(2)})`);
    });
    const yaw = (eyes[0].yaw + eyes[1].yaw) / 2;
    const pitch = (eyes[0].pitch + eyes[1].pitch) / 2;
    const lean = document.getElementById('sr-lean');
    if (lean) lean.style.transform = `translate(${(yaw * 0.15).toFixed(2)}px, ${(pitch * 0.12).toFixed(2)}px) rotate(${(yaw * 0.07).toFixed(2)}deg)`;
  }

  // One frame of a damped spring, a little underdamped so the eyes overshoot a hair and settle.
  // The loop stops itself at rest, so an idle page costs nothing.
  function step(now) {
    const dt = Math.min(0.032, Math.max(0, (now - last) / 1000));
    last = now;
    let moving = false;
    for (const e of eyes) {
      e.vy += (220 * (e.ty - e.yaw) - 21 * e.vy) * dt;
      e.vp += (220 * (e.tp - e.pitch) - 21 * e.vp) * dt;
      e.yaw += e.vy * dt;
      e.pitch += e.vp * dt;
      if (Math.abs(e.ty - e.yaw) > 0.03 || Math.abs(e.tp - e.pitch) > 0.03 || Math.hypot(e.vy, e.vp) > 0.05) moving = true;
    }
    paint();
    frame = moving ? requestAnimationFrame(step) : 0;
  }

  function aim(i, yaw, pitch) {
    eyes[i].ty = yaw; eyes[i].tp = pitch;
    if (reduced()) { eyes[i].yaw = yaw; eyes[i].pitch = pitch; paint(); return; }
    if (!frame) { last = performance.now(); frame = requestAnimationFrame(step); }
  }
  const aimBoth = (yaw, pitch) => { aim(0, yaw, pitch); aim(1, yaw, pitch); };

  // Each eye turns toward the cursor from its own spot, so up close they go a little cross-eyed.
  function lookAt(x, y) {
    if (!following || looking || asleep) return;
    const DEPTH = 420, MAX = 28;
    const clamp = (v) => Math.max(-MAX, Math.min(MAX, v));
    [1, 2].forEach((n, i) => {
      const el = document.getElementById(`sr-eye-${n}`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      aim(i, clamp(Math.atan2(x - (r.left + r.width / 2), DEPTH) * 180 / Math.PI), clamp(Math.atan2(y - (r.top + r.height / 2), DEPTH) * 180 / Math.PI));
    });
  }

  // Easter egg: 20 seconds without the mouse moving and the eyes doze off, tipped down. Any movement wakes them.
  function napLater() {
    clearTimeout(nap);
    nap = setTimeout(() => { asleep = true; wrap?.classList.add('sr-asleep'); aimBoth(0, 22); }, 20000);
  }

  document.addEventListener('mousemove', (e) => {
    cursor = [e.clientX, e.clientY];
    if (asleep) { asleep = false; wrap?.classList.remove('sr-asleep'); }
    napLater();
    lookAt(e.clientX, e.clientY);
  });
  napLater();

  if (!reduced()) {
    // Waking up: the eyes pop in and open (CSS), look left, look right, then find the cursor.
    setTimeout(() => aimBoth(-22, 4), 1750);
    setTimeout(() => aimBoth(22, -6), 2350);
    setTimeout(() => { following = true; if (cursor) lookAt(...cursor); else aimBoth(0, 0); }, 2950);
  }

  // Easter egg: click Loomis and he goes googly. Both eyes look at each other, roll around in opposite directions,
  // blink once, then find the cursor again. The springs above do the bouncing; this only moves the targets.
  let goofing = false;
  function blink(delay = 0) {
    // The Web Animations API, not a class: a class that turns the CSS blink loop off and on restarts that loop, so
    // the lid sat shut for a second and then snapped open. A script animation plays over the CSS one and hands back.
    document.querySelectorAll('.sr-eye .sr-lidg').forEach((lid) => lid.animate?.(
      [{ translate: '0 -72px' }, { translate: '0 0', offset: 0.45 }, { translate: '0 0', offset: 0.55 }, { translate: '0 -72px' }],
      { duration: 340, delay, easing: 'cubic-bezier(.4,0,.2,1)' },
    ));
  }
  function goGoogly() {
    if (reduced() || goofing || asleep) { blink(); return; }
    goofing = true;
    following = false;
    aim(0, 26, 6); aim(1, -26, 6); // cross-eyed: each looks at the other
    const start = performance.now() + 520;
    const roll = (now) => {
      const t = (now - start) / 1000;
      if (t < 0) { requestAnimationFrame(roll); return; }
      if (t < 1.1) {
        // Opposite directions, a little out of step, like loose googly eyes.
        aim(0, Math.cos(t * 13) * 24, Math.sin(t * 13) * 24);
        aim(1, Math.cos(-t * 13 + 1.6) * 24, Math.sin(-t * 13 + 1.6) * 24);
        requestAnimationFrame(roll);
        return;
      }
      aimBoth(0, 0);
      blink(120);
      setTimeout(() => { goofing = false; following = true; if (cursor) lookAt(...cursor); }, 520);
    };
    requestAnimationFrame(roll);
  }
  document.getElementById('sr-eyes')?.addEventListener('click', goGoogly);

  // A file dragged over the drop sheet (or keyboard focus on it): both eyes look down at it, pupils wide.
  const pupils = () => document.querySelectorAll('.sr-eye .sr-pupil circle:first-child');
  return {
    lookDown() {
      if (looking) return;
      looking = true;
      pupils().forEach((c) => c.setAttribute('r', '17'));
      aimBoth(-6, 24);
    },
    lookUp() {
      looking = false;
      pupils().forEach((c) => c.setAttribute('r', '14'));
      if (cursor) setTimeout(() => lookAt(...cursor)); else aimBoth(0, 0);
    },
  };
}

/** The logo is the way home: from any phase it goes back to the start page; on the start page it scrolls up. */
export function startLogo(onClick) {
  document.getElementById('logo')?.addEventListener('click', onClick);
}
