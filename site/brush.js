/* Brush: things appear as if painted, in diagonal strokes that sweep back and forth from the
   upper left to the lower right. Used for the first view of the map (a sandy sheet is painted
   away) and for the spot view (its colour world is painted in over the map). */
const Brush = (() => {
  "use strict";
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const easeIO = k => .5 - .5 * Math.cos(Math.PI * clamp(k));
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // A set of strokes for a w×h area: each one runs along the "/" diagonal; one after another they
  // move down the "\" diagonal, alternating direction like a painter's arm. Times are 0…1.
  function plan(w, h, n = w < 700 ? 6 : 8, d = .34) {
    seed = 3;
    const ax = Math.SQRT1_2, ay = Math.SQRT1_2;        // progress direction (towards lower right)
    const bx = Math.SQRT1_2, by = -Math.SQRT1_2;       // stroke direction (along the "/" diagonal)
    const D = (w + h) * Math.SQRT1_2, band = D / n, width = band * 1.75;
    const g = (1 - d) / (n - 1), strokes = [];
    for (let i = 0; i < n; i++) {
      const p = (i + .5) * band + (rnd() - .5) * band * .2;            // distance along the progress axis
      const cx = ax * p, cy = ay * p;                                    // a point on this stroke's line
      // long enough to cross the whole screen, plus a margin for the tapered ends
      const L = (w + h) * .75 + width;
      let a = [cx - bx * L, cy - by * L], b = [cx + bx * L, cy + by * L];
      if (i % 2) [a, b] = [b, a];
      const bend = (rnd() - .5) * width * .8;                            // a slight curve
      const ctl = [(a[0] + b[0]) / 2 + ax * bend, (a[1] + b[1]) / 2 + ay * bend];
      const bristles = Array.from({ length: 22 }, (_, k) => { const e = Math.abs(k / 21 - .5) * 2;   // 0 middle … 1 edge
        return { o: (k / 21 - .5) * 1.22 + (rnd() - .5) * .06,                        // across the stroke
          w: .04 + rnd() * .1 * (1 - e * .5), lag: e * e * .28 + rnd() * .12,          // thin, ragged edges that trail
          start: rnd() * .07 * (1 + e), end: 1 - rnd() * .1 * e, wob: .1 + rnd() * .25, f: 9 + rnd() * 20, alpha: .55 + rnd() * .45 }; });
      strokes.push({ a, b, ctl, width, t0: i * g, dur: d, bristles, nx: ax, ny: ay });
    }
    return { w, h, strokes };
  }
  const at = (s, u) => { const v = 1 - u; return [v * v * s.a[0] + 2 * v * u * s.ctl[0] + u * u * s.b[0], v * v * s.a[1] + 2 * v * u * s.ctl[1] + u * u * s.b[1]]; };

  // Paint the strokes as far as they've got at time t (0…1) into ctx, in opaque black.
  function render(ctx, pl, t, scale = 1) {
    ctx.save(); ctx.scale(scale, scale); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#000"; ctx.fillStyle = "#000";
    for (const s of pl.strokes) {
      const u = easeIO((t - s.t0) / s.dur); if (u <= 0) continue;
      // a solid core, so nothing is left unpainted between bristles
      const cu = clamp(u - .08); ctx.globalAlpha = 1; ctx.lineWidth = s.width * .56; ctx.beginPath();
      for (let k = 0; k <= 24; k++) { const p = at(s, cu * k / 24); k ? ctx.lineTo(...p) : ctx.moveTo(...p); }
      ctx.stroke();
      // bristles: thinner lines across the stroke, the outer ones lagging behind for a dry-brush edge
      for (const br of s.bristles) {
        const hu = Math.min(br.end, clamp(u - br.lag * (1 - u * .5))); if (hu <= br.start) continue;
        ctx.globalAlpha = br.alpha; ctx.lineWidth = s.width * br.w; ctx.beginPath();
        for (let k = 0; k <= 20; k++) { const uu = br.start + (hu - br.start) * k / 20, p = at(s, uu);
          const off = br.o * s.width * (1 + br.wob * .35 * Math.sin(uu * br.f + br.o * 9));
          const x = p[0] + s.nx * off, y = p[1] + s.ny * off; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ---- first view: a sandy sheet over everything, painted away ---- */
  function intro(ms = 2600) {
    const cv = document.getElementById("brush"); if (!cv) return;
    const grain = document.getElementById("grain");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { cv.remove(); return; }
    const w = innerWidth, h = innerHeight, r = Math.min(1.5, devicePixelRatio || 1);
    cv.width = w * r; cv.height = h * r;
    const c = cv.getContext("2d"), pl = plan(w, h);
    grain.style.zIndex = 11;                            // keep the paper grainy while it's showing
    const t0 = performance.now();
    const step = now => {
      const t = (now - t0) / ms;
      c.globalCompositeOperation = "source-over"; c.globalAlpha = 1; c.fillStyle = "#efe6d2"; c.fillRect(0, 0, cv.width, cv.height);
      c.globalCompositeOperation = "destination-out"; render(c, pl, t, r);
      cv.style.background = "none";
      if (t < 1) requestAnimationFrame(step);
      else { cv.style.transition = "opacity .5s"; cv.style.opacity = 0; setTimeout(() => { cv.remove(); grain.style.zIndex = ""; }, 520); }
    };
    requestAnimationFrame(step);
  }

  /* ---- a mask that paints an element in: k = 0 nothing … 1 everything ---- */
  const mk = document.createElement("canvas"), mc = mk.getContext("2d");
  let mplan = null;
  function maskURL(k) {
    const w = innerWidth, h = innerHeight, S = .5;      // a small mask is plenty; its soft edge reads as wet paint
    if (!mplan || mplan.w !== w || mplan.h !== h) { mplan = plan(w, h); mk.width = Math.ceil(w * S); mk.height = Math.ceil(h * S); }
    mc.clearRect(0, 0, mk.width, mk.height); render(mc, mplan, k, S);
    return `url(${mk.toDataURL()})`;
  }
  function mask(els, k) {  // k: 0…1; one mask in viewport coordinates, wherever each element sits
    if (k >= 1) { for (const el of els) el.style.maskImage = el.style.webkitMaskImage = ""; return; }
    const url = maskURL(Math.max(0, k));
    for (const el of els) { const r = el.getBoundingClientRect();
    for (const p of ["mask", "webkitMask"]) {
      el.style[p + "Image"] = url; el.style[p + "Size"] = `${innerWidth}px ${innerHeight}px`;
      el.style[p + "Position"] = `${-r.left}px ${-r.top}px`; el.style[p + "Repeat"] = "no-repeat";
    } }
  }
  return { plan, render, intro, mask, maskURL };
})();
