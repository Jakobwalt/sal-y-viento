/* Beach view: from the spot detail, dive down onto the beach and look along it.
   The scene is drawn on one canvas and follows the forecast at the timeline's hour:
   sun and moon from their real positions, sky, clouds, rain, wind and waves from the data.
   Uses the page's globals (FC, curT, N, T0, selected, cam, P, tween, applyCam, barCol, ramp…). */
(() => {
"use strict";
const R = Math.PI / 180;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const mix = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mixc = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/* ---------- sky mechanics: sun and moon positions (low-precision, plenty for a picture) ---------- */
function body(date, lat, lon, raShift = 0) {
  const d = date / 864e5 - 10957.5;                                  // days since J2000
  const g = (357.529 + 0.98560028 * d) * R, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * R, e = (23.439 - 3.6e-7 * d) * R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) + raShift;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const H = (gmst * 15 + lon) * R - ra, la = lat * R;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(H));
  return { el: el / R, az: (az / R + 360) % 360 };
}
// moon: same machinery, shifted east by its phase (good to a few degrees, ignoring its tilt)
const moonPhase = date => (((date - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) / 29.530589 % 1 + 1) % 1;

/* ---------- forecast at a fractional hour ---------- */
function at(o, key, t) {
  const a = Math.floor(t), b = Math.min(N - 1, a + 1), k = t - a, va = o[key][a], vb = o[key][b];
  if (va == null) return vb ?? null; if (vb == null) return va;
  return va + (vb - va) * k;
}
function dirAt(o, t) {   // direction-from, blended as vectors
  const a = Math.floor(t), b = Math.min(N - 1, a + 1), k = t - a, da = o.dir[a], db = o.dir[b];
  if (da == null) return db; if (db == null) return da;
  const x = mix(Math.sin(da * R), Math.sin(db * R), k), y = mix(Math.cos(da * R), Math.cos(db * R), k);
  return (Math.atan2(x, y) / R + 360) % 360;
}

/* ---------- scenes: one per spot, added one by one ---------- */
// Coordinates are fractions of the screen: x of the width, y of the height (hz = horizon).
const SCENES = {
  valde: {
    name: "Valdevaqueros",
    lat: 36.07, lon: -5.70,
    bearing: 283,          // looking west along the beach towards Punta Paloma, sea on the left
    fov: 124,              // degrees across the screen
    // water's edge, from the far point to the bottom-left corner (traced from the view off the boardwalk)
    shore: [[.45, .005], [.55, .014], [.65, .028], [.685, .05], [.665, .088], [.6, .135], [.45, .22], [.3, .295], [.15, .355], [-.02, .415]],
    // where sand meets scrub, from the far point down to the bottom
    scrub: [[.45, .003], [.6, .0], [.73, -.003], [.8, .05], [.785, .14], [.755, .235], [.72, .33], [.69, .42], [.67, .52], [.66, .64]],
    hills: [   // the far ridge (Sierra de la Plata, San Bartolomé), then the nearer, greener slope
      { c: "#7f9690", p: [[.43, .002], [.46, -.004], [.53, -.014], [.6, -.028], [.68, -.046], [.75, -.064], [.81, -.082], [.86, -.1], [.9, -.122], [.94, -.13], [.97, -.127], [1.02, -.118], [1.02, .002]] },
      { c: "#5f7d4c", p: [[.66, -.006], [.72, -.018], [.78, -.03], [.85, -.046], [.92, -.058], [1.02, -.06], [1.02, .002], [.66, .002]] },
    ],
    dune: [[.56, .003], [.59, -.014], [.62, -.026], [.655, -.036], [.69, -.04], [.72, -.03], [.75, -.012], [.77, .003]],
    boardwalk: { from: [.51, .46], to: [.79, .64], w: .016 },
    flag: [.83, .25],
    palm: [.905, .31],      // a palm on the dunes, right of the boardwalk (base point)
    pineWood: true,
    lights: [[.83, -.12], [.87, -.135], [.91, -.11], [.76, -.07], [.95, -.14], [.715, -.035]],
  },
};
/* Balneario, Tarifa: standing on the sand, looking west out to sea. Isla de Tarifa with its fort
   on the left, the boulders of the causeway running out to it along the left edge, the open
   Atlantic ahead, and far right the hazy ridge with the Punta Paloma dune at its foot.
   Swell comes straight at us from the west; with levante (offshore here) the big ones throw
   spray back off their crests, and they burst against the rocks. */
SCENES.balneario = {
  name: "Balneario", lat: 36.017, lon: -5.61, bearing: 268, fov: 104,
  out: true, hz: .46, hzP: .36, seaSpan: .24, shallow: .4, seaRef: [.6, .02],
  shore: [[-.03, .138], [.14, .13], [.3, .122], [.5, .114], [.68, .108], [.85, .103], [1.03, .1]],
  // the breakwater runs from the island to the left edge as one long wall of boulders: its foot
  // in the water and on the sand, and its top, which hides the promenade entirely
  rockEdge: [[.3, .011], [.26, .028], [.2, .05], [.13, .075], [.06, .1], [-.03, .13]],
  rockTop: [[.3, .006], [.22, .002], [.14, -.002], [.06, -.006], [-.03, -.01]],
  // a rock outcrop in the surf on the right
  outcrop: [.9, .084],
  hills: [{ c: "#8ea2b0", p: [[.64, .002], [.7, -.004], [.76, -.011], [.82, -.022], [.87, -.033], [.91, -.039], [.95, -.038], [1.03, -.03], [1.03, .002]] }],
  dune: [[.79, .002], [.815, -.006], [.845, -.009], [.87, -.006], [.89, .002]],
  lights: [[.035, -.058]],
  layers: {},
};
{
  const B = SCENES.balneario;
  const along = (pts, key, v) => {   // interpolate along a screen polyline by x or y
    const i0 = key === "x" ? 0 : 1, i1 = 1 - i0, sorted = pts[0][i0] <= pts[pts.length - 1][i0] ? pts : [...pts].reverse();
    if (v <= sorted[0][i0]) return sorted[0][i1];
    for (let i = 0; i < sorted.length - 1; i++) { const a = sorted[i], b = sorted[i + 1]; if (v <= b[i0]) return a[i1] + (b[i1] - a[i1]) * (v - a[i0]) / ((b[i0] - a[i0]) || 1); }
    return sorted[sorted.length - 1][i1];
  };
  B.build = () => {
    B.edgeP = curve(B.rockEdge, 8); B.topP = curve(B.rockTop, 8);
    const rock = new Path2D(); rock.moveTo(...B.edgeP[0]); B.topP.forEach(p => rock.lineTo(...p));
    [...B.edgeP].reverse().forEach(p => rock.lineTo(...p)); rock.closePath(); B.rockPath = rock;
    B.boulders = [];
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 4000 && B.boulders.length < 150; i++) {
      const y = mix(Y(-.02), Y(.14), rand()), x = mix(-W * .05, X(.31), rand());
      if (!g.isPointInPath(rock, x, y)) continue;
      const d = depth(y), r = (3 + d * 70) * (.55 + rand() * .7), n = 7 + (rand() * 3 | 0);
      B.boulders.push({ x, y, r, c: rand(), v: Array.from({ length: n }, (_, k) => [Math.cos(k / n * 6.283) * (.75 + rand() * .4), Math.sin(k / n * 6.283) * (.55 + rand() * .3)]) });
    }
    B.boulders.sort((a, b) => a.y - b.y);
    // the outcrop: a cluster of dark, wet rocks
    const [ox, oy] = B.outcrop; B.rocksR = Array.from({ length: 11 }, (_, i) => { const d = depth(Y(oy)), r = (6 + d * 70) * (.5 + rand() * .7);
      return { x: X(ox + (rand() - .5) * .09), y: Y(oy) - rand() * r * .4, r, c: rand(), v: Array.from({ length: 8 }, (_, k) => [Math.cos(k / 8 * 6.283) * (.75 + rand() * .4), Math.sin(k / 8 * 6.283) * (.5 + rand() * .3) - (k > 4 ? .15 : 0)]) }; })
      .sort((a, b) => a.y - b.y);
    B.sandMarks = Array.from({ length: 70 }, () => ({ x: rand(), y: rand(), l: .3 + rand() * .7 }));
  };
  B.shoreY = x => along(shoreP, "x", x);
  B.edgeX = y => along(B.edgeP, "y", y);

  // the island, its fort and lighthouse
  B.layers.hills = t => {
    drawHills(t); drawDune();
    const s = S;
    g.fillStyle = css(mixc(lit("#5d564b"), s.hor, .18));
    g.fill(polyPath([[-.03, .014], [-.03, -.03], [.02, -.034], [.08, -.033], [.12, -.036], [.165, -.032], [.2, -.027], [.235, -.02], [.262, -.009], [.285, .004], [.29, .014]]));
    g.fillStyle = css(mixc(lit("#8a7d68"), s.hor, .2), .8);      // the lighter rock band along its top
    g.fill(polyPath([[-.03, -.026], [-.03, -.03], [.02, -.034], [.08, -.033], [.12, -.036], [.165, -.032], [.2, -.027], [.235, -.02], [.25, -.014], [.2, -.02], [.12, -.028], [.05, -.027]]));
    g.fillStyle = css(mixc(lit("#efe5cf"), s.hor, .2));          // the little pale beach at its foot
    g.fill(polyPath([[.215, .006], [.26, .002], [.285, .009], [.25, .012]]));
    // the fort: long low pale buildings with dark windows
    for (const [x0, x1, top, base] of [[.0, .07, -.046, -.033], [.082, .118, -.042, -.033], [.135, .178, -.048, -.034], [.185, .205, -.04, -.029]]) {
      g.fillStyle = css(mixc(lit("#ddd4c1"), s.hor, .15)); g.fillRect(X(x0), Y(top), X(x1) - X(x0), Y(base) - Y(top));
      g.fillStyle = css(mixc(lit("#9c8f7a"), s.hor, .15)); g.fillRect(X(x0), Y(top), X(x1) - X(x0), Math.max(1, (Y(base) - Y(top)) * .18));
      g.fillStyle = css(lit("#4a453d"), .7);
      for (let x = x0 + .006; x < x1 - .004; x += .011) g.fillRect(X(x), Y(top + (base - top) * .45), Math.max(1, W * .0025), Math.max(1, (Y(base) - Y(top)) * .25));
    }
    // the lighthouse at the island's tip, flashing at night every 15 s like on the map
    const lx = X(.035), ly = Y(-.046), lh = H * .02;
    g.fillStyle = css(lit("#f1ece0")); g.fillRect(lx - W * .003, ly - lh, W * .006, lh);
    g.fillStyle = css(lit("#c9573a")); g.fillRect(lx - W * .004, ly - lh - H * .004, W * .008, H * .004);
    const night = 1 - smooth(-6, 1, s.sun.el), ph = (performance.now() / 1000) % 15, flash = ph < .9 ? Math.sin(ph / .9 * Math.PI) : 0;
    if (night > 0) { const r = H * (.01 + flash * .06), gl = g.createRadialGradient(lx, ly - lh, 0, lx, ly - lh, r);
      gl.addColorStop(0, `rgba(255,240,200,${night * (.5 + flash * .5)})`); gl.addColorStop(1, "rgba(255,240,200,0)"); g.fillStyle = gl; g.fillRect(lx - r, ly - lh - r, r * 2, r * 2); }
  };

  // the sand: pale and wide, darker where it's wet, with wind ripples
  B.layers.land = t => {
    const s = S, top = B.shoreY(W / 2);
    const gr = g.createLinearGradient(0, top, 0, H);
    gr.addColorStop(0, css(lit("#d9c49d"))); gr.addColorStop(.12, css(lit("#ead9b6"))); gr.addColorStop(1, css(lit("#f0e3c6", .03)));
    g.fillStyle = gr; g.fill(B.sandPath || sc.sandPath);
    if (s.wet > 0) { g.fillStyle = css(lit("#8f7b5a"), s.wet * .3); g.fill(sc.sandPath); }
    g.save(); g.clip(sc.sandPath);
    const shore = new Path2D(); shore.moveTo(...shoreP[0]); shoreP.forEach(p => shore.lineTo(...p));
    g.strokeStyle = css(lit("#c9b086"), .75); g.lineWidth = H * .012; g.stroke(shore);
    g.strokeStyle = css(lit("#c7b18b"), .35); g.lineWidth = 1;
    for (const m of B.sandMarks) { const y = mix(top + H * .03, H, Math.pow(m.y, 1.3)), d = depth(y), x = m.x * W, l = (20 + d * 160) * m.l;
      g.beginPath(); g.moveTo(x - l / 2, y); g.quadraticCurveTo(x, y - 2 - d * 4, x + l / 2, y); g.stroke(); }
    g.restore();
  };

  // waves coming straight in from the west
  B.layers.waves = t => {
    const s = S, h = clamp(s.wh ?? .6, .1, 5), period = clamp(s.wp || 8, 3, 20), LIVE = 4;
    const lightF = mix(.25, 1, s.day) * (1 - s.grey * .25);
    const sb = clamp(.95 - h * .075, .55, .92);                     // where they break: 0 horizon … 1 the sand
    const easterly = s.dir != null && s.dir >= 35 && s.dir <= 145;            // levante
    const offshore = easterly ? clamp(s.wz * 1.5) : 0;
    const sprayAmt = smooth(10, 28, s.kn) * smooth(.8, 2.6, h) * offshore;
    const foamC = `rgba(251,249,242,`;
    B.hits = [];
    g.save(); g.lineJoin = "round"; g.lineCap = "round";
    for (let i = 0; i < LIVE; i++) {
      const cyc = t / (period * LIVE) + i / LIVE, id = Math.floor(cyc) * LIVE + i, p = cyc % 1;
      const sp = mix(.1, 1.03, p);                                   // how far in this wave has come
      const stand = smooth(sb - .32, sb, sp), broke = smooth(sb, sb + .05, sp), fade = 1 - smooth(.95, 1.03, sp);
      const yAt = x => HZ + (B.shoreY(x) - HZ) * sp * sp;
      const x0 = -4, N = 54, pts = [];          // runs behind the breakwater, which is drawn on top
      for (let k = 0; k <= N; k++) {
        const x = mix(x0, W + 4, k / N), y = yAt(x);
        const sect = .62 + .38 * Math.sin(x / W * 6.5 + id * 1.9) * Math.sin(x / W * 2.2 + id * .7 + 1);
        const face = H * .017 * h * (.1 + .9 * sp * sp) * sect * stand * (1 - broke * .85);
        pts.push([x, y, y - face, sect]);
      }
      // the swell line far out, before it stands up
      g.strokeStyle = css(lit("#86c7bd"), .22 * (1 - stand) * fade); g.lineWidth = 1;
      g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
      if (stand > .02) {
        // the face: darker water between the crest and the trough
        g.fillStyle = css(lit("#1d5d61"), .55 * stand * fade);
        g.beginPath(); pts.forEach(([x, , c], k) => k ? g.lineTo(x, c) : g.moveTo(x, c)); [...pts].reverse().forEach(([x, y]) => g.lineTo(x, y + 1)); g.closePath(); g.fill();
        g.strokeStyle = css(lit("#7cc6b9"), .7 * stand * (1 - broke) * fade); g.lineWidth = 1 + sp;
        g.beginPath(); pts.forEach(([x, , c], k) => k ? g.lineTo(x, c) : g.moveTo(x, c)); g.stroke();
        // feathering lip just before it goes
        const lip = clamp((stand - .6) * 2.5) * (1 - broke);
        if (lip > 0) { g.strokeStyle = foamC + (lip * .85 * lightF) + ")"; g.lineWidth = 1 + h * .7 * sp;
          g.beginPath(); pts.forEach(([x, , c, sct], k) => { const yy = c + (1 - sct) * 2; k ? g.lineTo(x, yy) : g.moveTo(x, yy); }); g.stroke(); }
      }
      if (broke > 0) {
        // white water rolling in
        // white water: thick where the wave was biggest, thin and broken where it was small
        const foamH = H * .0045 * Math.sqrt(h) * (.2 + .8 * sp * sp) * (1 + (sp - sb) * 6);
        g.fillStyle = foamC + (.85 * broke * fade * lightF) + ")";
        g.beginPath(); pts.forEach(([x, , c, sct], k) => { const yy = c - foamH * .3 * sct + Math.sin(k * 2.7 + id) * foamH * .15; k ? g.lineTo(x, yy) : g.moveTo(x, yy); });
        [...pts].reverse().forEach(([x, y, , sct], k) => g.lineTo(x, y + foamH * (.25 + .75 * sct * sct) * (.8 + .2 * Math.sin(k * 1.9 + id)))); g.closePath(); g.fill();
        g.fillStyle = css(lit("#2f7f80"), .35 * broke * fade);    // gaps where the foam has thinned
        for (let k = 0; k < pts.length; k += 3) { const [x, y, , sct] = pts[k]; if (sct > .7) continue; g.beginPath(); g.ellipse(x, y + foamH * .3, 6 + sp * 18, 1 + foamH * .25, 0, 0, 7); g.fill(); }
        g.fillStyle = css(lit("#c9ddd6"), .5 * broke * fade);
        for (let k = 0; k < pts.length; k += 2) { const [x, y] = pts[k]; g.fillRect(x + Math.sin(k * 3.1 + id) * 6, y + foamH * .2, 2 + sp * 6, 1); }
      }
      // levante blows the tops off: mist streaming back off the crests, up and away from us
      if (sprayAmt > .02 && stand > .35 && broke < .95) {
        const amt = sprayAmt * (stand - .35) / .65 * (1 - broke * .8) * fade;
        for (let k = 0; k < pts.length - 1; k++) {
          const [xa, , ca, sct] = pts[k], [xb, , cb] = pts[k + 1]; if (sct < .5) continue;
          for (let m = 0; m < 3; m++) {                                  // several wisps between samples, jittered
            const u = (m + .5 + Math.sin(k * 7.3 + m * 3.1 + id) * .4) / 3, x = mix(xa, xb, u), c = mix(ca, cb, u);
            const flick = .5 + .5 * Math.sin(t * (2.2 + m * .7) + k * 1.9 + m * 2.3 + id);
            const len = H * .016 * h * (.25 + .75 * sp * sp) * (1 + 3 * sprayAmt) * flick * (sct - .3) * 1.6;
            const sz = (2 + sp * 10) * (.6 + .4 * sct);
            for (let q = 0; q < 4; q++) {                                // puffs along the plume: dense at the crest, thinning as it streams off
              const f = q / 3, px = x + s.wx * len * .45 * f + Math.sin(t * 3 + k + q) * sz * .3 * f, py = c - len * f * (.85 + .15 * Math.sin(k + m));
              const r = sz * (.6 + f * 1.6), al = .32 * amt * lightF * (1 - f * .75);
              const gl = g.createRadialGradient(px, py, 0, px, py, r);
              gl.addColorStop(0, foamC + al + ")"); gl.addColorStop(1, foamC + "0)");
              g.fillStyle = gl; g.fillRect(px - r, py - r, r * 2, r * 2);
            }
          }
        }
      }
      if (stand > .3 || broke > 0) { const pw = h * Math.max(stand, broke) * fade;
        B.hits.push({ x: B.edgeX(yAt(W * .3)) + 3, y: yAt(B.edgeX(yAt(W * .3))), sp, power: pw, id });
        const ox = X(B.outcrop[0]), oy = yAt(ox); if (Math.abs(oy - Y(B.outcrop[1])) < H * .02) B.hits.push({ x: ox, y: Y(B.outcrop[1]), sp, power: pw * 1.1, id: id + 7 }); }
    }
    // the swash sliding up the sand
    const sw = Math.sin(t * 2 * Math.PI / period) * .5 + .5;
    g.beginPath(); shoreP.forEach(([x, y], k) => { const yy = y + (2 + sw * (3 + h * 3)) * (1 + Math.sin(k * .3) * .2); k ? g.lineTo(x, yy) : g.moveTo(x, yy); });
    g.strokeStyle = foamC + (.6 * lightF) + ")"; g.lineWidth = 1.4; g.stroke();
    g.restore();
  };

  // the boulders of the causeway, and the sea bursting against them
  B.layers.scrub = t => {
    const s = S;
    g.fillStyle = css(lit("#5e4f3f")); g.fill(B.rockPath);
    for (const b of B.boulders) {
      const base = b.c < .33 ? "#b19675" : b.c < .66 ? "#9c8164" : "#c2a883", r = b.r;
      const gr = g.createLinearGradient(b.x, b.y - r * .6, b.x, b.y + r * .6);
      gr.addColorStop(0, css(lit(base, .06))); gr.addColorStop(.55, css(lit(base))); gr.addColorStop(1, css(lit("#6b5946")));
      g.fillStyle = gr; g.beginPath(); b.v.forEach(([vx, vy], k) => k ? g.lineTo(b.x + vx * r, b.y + vy * r) : g.moveTo(b.x + vx * r, b.y + vy * r)); g.closePath(); g.fill();
      if (r > 8) { g.strokeStyle = css(lit("#e2cfa9"), .35); g.lineWidth = 1; g.beginPath();
        b.v.slice(Math.floor(b.v.length * .55)).forEach(([vx, vy], k) => k ? g.lineTo(b.x + vx * r, b.y + vy * r) : g.moveTo(b.x + vx * r, b.y + vy * r)); g.stroke(); }
    }
    // wet, darker rock where the water reaches
    g.save(); g.clip(B.rockPath); g.strokeStyle = css(lit("#3e3428"), .35); g.lineWidth = H * .01;
    g.beginPath(); B.edgeP.forEach((p, k) => { if (p[1] > B.shoreY(p[0]) + 4) return; k ? g.lineTo(...p) : g.moveTo(...p); }); g.stroke(); g.restore();
    // the outcrop in the surf on the right, wet and dark, a ring of foam around its foot
    { const [ox, oy] = B.outcrop, d = depth(Y(oy)), sw = .5 + .5 * Math.sin(t * 1.3);
      g.fillStyle = `rgba(251,249,242,${(.35 + sw * .3) * mix(.25, 1, s.day)})`; g.beginPath(); g.ellipse(X(ox), Y(oy) + 2, W * .045, 3 + d * 10, 0, 0, 7); g.fill();
      for (const b of B.rocksR) { const r = b.r, gr = g.createLinearGradient(b.x, b.y - r * .6, b.x, b.y + r * .5);
        gr.addColorStop(0, css(lit(b.c > .5 ? "#7d6c58" : "#6a5b4a", .04))); gr.addColorStop(1, css(lit("#3f362d")));
        g.fillStyle = gr; g.beginPath(); b.v.forEach(([vx, vy], k) => k ? g.lineTo(b.x + vx * r, b.y + vy * r) : g.moveTo(b.x + vx * r, b.y + vy * r)); g.closePath(); g.fill(); } }
    // spray bursting up where the waves hit the rocks
    const lightF = mix(.25, 1, s.day) * (1 - s.grey * .25);
    for (const hit of B.hits || []) {
      if (hit.power < .25) continue;
      const x = hit.x, R = H * .012 * hit.power * (.25 + .75 * hit.sp * hit.sp) * (1 + s.kn / 45);
      for (let j = 0; j < 6; j++) {
        const rise = R * (j * .55) * (.6 + .4 * Math.sin(t * 2.4 + j + hit.id)), rr = R * (.6 + j * .25), cx = x - j * R * .12 + s.wx * rise * .4;
        const gl = g.createRadialGradient(cx, hit.y - rise, 0, cx, hit.y - rise, rr);
        gl.addColorStop(0, `rgba(251,249,242,${.45 * (1 - j / 6) * lightF})`); gl.addColorStop(1, "rgba(251,249,242,0)");
        g.fillStyle = gl; g.fillRect(cx - rr, hit.y - rise - rr, rr * 2, rr * 2);
      }
    }
  };
  B.layers.things = () => {};
}
/* El Palmar: on the glossy wet sand at low tide, looking west-north-west along the beach.
   The sea on the left with the surf breaking in lines along the shore, the white Torre de
   El Palmar on the right with the low building beside it, the dark reef at the water's edge,
   the dune line and white houses beyond, two palms that answer the wind, and a surfer
   watching the waves: longboard for small days, shortboard when it's over a metre, and
   jumping about when it's really big. The wet sand mirrors the sky and the tower. */
SCENES.palmar = {
  name: "El Palmar", lat: 36.23, lon: -6.075, bearing: 292, fov: 112,
  hz: .52, hzP: .38, seaRef: [.08, .03], shallow: .55, seaSpan: .4,
  // the water's edge, from far up the beach down to the near left
  shore: [[.52, .004], [.47, .018], [.39, .045], [.29, .085], [.17, .135], [.05, .19], [-.04, .23]],
  hills: [{ c: "#9aa7a8", p: [[.86, .002], [.92, -.004], [.97, -.006], [1.03, -.005], [1.03, .002]] }],
  palms: [{ at: [.83, .075], size: .82 }, { at: [.94, .1], size: 1 }],
  lights: [[.88, -.02], [.93, -.022], [.97, -.019], [.665, -.05]],
  layers: {},
};
{
  const E = SCENES.palmar;
  E.build = () => {
    // sea up and to the left of the shore line, sand everywhere else below the horizon
    const sea = new Path2D(); sea.moveTo(-2, HZ); sea.lineTo(...shoreP[0]); shoreP.forEach(p => sea.lineTo(...p)); sea.lineTo(-2, shoreP[shoreP.length - 1][1]); sea.closePath(); sc.seaPath = sea;
    const sand = new Path2D(); sand.moveTo(...shoreP[0]); shoreP.forEach(p => sand.lineTo(...p)); sand.lineTo(-2, H + 2); sand.lineTo(W + 2, H + 2); sand.lineTo(W + 2, HZ); sand.closePath(); sc.sandPath = sand;
    E.marks = Array.from({ length: 50 }, () => ({ x: rand(), y: rand(), l: .3 + rand() * .7 }));
    E.reef = Array.from({ length: 14 }, () => ({ x: .47 + rand() * .12, y: .002 + rand() * .01, r: .4 + rand() * .8 }));
  };
  // dune line, tower, houses (behind the beach, on the right)
  E.layers.hills = t => {
    const s = S; drawHills(t);
    g.fillStyle = css(mixc(lit("#6d6a4c"), s.hor, .15));                         // the low dark dune and scrub line
    g.fill(polyPath([[.53, .004], [.6, -.002], [.7, -.006], [.8, -.009], [.9, -.012], [1.03, -.014], [1.03, .02], [.53, .012]]));
    g.fillStyle = css(mixc(lit("#4f5a3c"), s.hor, .1));
    for (let i = 0; i < 22; i++) { const x = .72 + i * .015, y = -.008 - (i % 3) * .002; g.beginPath(); g.ellipse(X(x), Y(y), W * .009, H * .006, 0, 0, 7); g.fill(); }
    // white houses far right, and little palms among them
    for (const [x0, x1, top] of [[.85, .9, -.026], [.905, .945, -.03], [.95, 1.0, -.027], [.79, .82, -.018]]) {
      g.fillStyle = css(mixc(lit("#f3efe6"), s.hor, .15)); g.fillRect(X(x0), Y(top), X(x1) - X(x0), Y(-.009) - Y(top));
      g.fillStyle = css(lit("#9a8f80"), .5); g.fillRect(X(x0), Y(top), X(x1) - X(x0), 1.5);
    }
    // the low building beside the tower
    g.fillStyle = css(mixc(lit("#efe8da"), s.hor, .12)); g.fillRect(X(.675), Y(-.02), X(.745) - X(.675), Y(-.004) - Y(-.02));
    g.fillStyle = css(mixc(lit("#b9a58c"), s.hor, .12)); g.fill(polyPath([[.672, -.02], [.71, -.027], [.748, -.02]]));
    // Torre de El Palmar: a white round watchtower, slightly tapered, with a dark doorway high up
    const tx = X(.655), tb = Y(-.004), th = H * .085, tw = W * .022;
    g.fillStyle = css(mixc(lit("#f5f1e7"), s.hor, .1));
    g.beginPath(); g.moveTo(tx - tw / 2, tb); g.lineTo(tx - tw * .42, tb - th); g.lineTo(tx + tw * .42, tb - th); g.lineTo(tx + tw / 2, tb); g.closePath(); g.fill();
    g.fillStyle = css(lit("#c9c2b4"), .7); g.beginPath(); g.moveTo(tx + tw * .12, tb); g.lineTo(tx + tw * .1, tb - th); g.lineTo(tx + tw * .42, tb - th); g.lineTo(tx + tw / 2, tb); g.closePath(); g.fill();
    g.fillStyle = css(mixc(lit("#e8e2d4"), s.hor, .1)); g.fillRect(tx - tw * .48, tb - th - H * .004, tw * .96, H * .004);
    g.fillStyle = css(lit("#4a443c")); g.fillRect(tx - tw * .08, tb - th * .62, tw * .16, th * .12);
    E.tower = { x: tx, b: tb, h: th, w: tw };
    // the reef at the water's edge
    for (const r of E.reef) { g.fillStyle = css(lit("#3f3a33")); g.beginPath(); g.ellipse(X(r.x), Y(r.y), W * .012 * r.r, H * .004 * r.r, 0, 0, 7); g.fill(); }
  };
  // the wet sand: a mirror for the sky and the tower, drier and paler further back
  E.layers.land = t => {
    const s = S;
    g.save(); g.clip(sc.sandPath);
    const gr = g.createLinearGradient(0, HZ, 0, H);
    gr.addColorStop(0, css(lit("#e6d6b4"))); gr.addColorStop(.12, css(mixc(lit("#cdb08a"), s.hor, .35)));
    gr.addColorStop(.45, css(mixc(lit("#b39370"), s.top, .3))); gr.addColorStop(1, css(mixc(lit("#9d7c5e"), s.top, .22)));
    g.fillStyle = gr; g.fillRect(0, HZ, W, H - HZ);
    // a sheen of sky on the wet sand, strongest near the water
    const sh = g.createLinearGradient(0, HZ, W * .7, H);
    sh.addColorStop(0, css(s.hor, .45)); sh.addColorStop(.6, css(mixc(s.top, s.hor, .4), .25)); sh.addColorStop(1, css(s.top, .05));
    g.fillStyle = sh; g.fillRect(0, HZ, W, H - HZ);
    // dry sand behind, on the right
    g.fillStyle = css(lit("#e8d8b6"), .85); g.fill(polyPath([[.53, .012], [.7, .016], [.85, .03], [1.03, .045], [1.03, .004], [.53, .004]]));
    // the tower's reflection
    if (E.tower) { const { x, b, h, w } = E.tower, rb = b + H * .03;
      const rg = g.createLinearGradient(0, rb, 0, rb + h * 1.1); rg.addColorStop(0, css(lit("#f5f1e7"), .45)); rg.addColorStop(1, css(lit("#f5f1e7"), 0));
      g.fillStyle = rg; g.fillRect(x - w * .45 + Math.sin(t * 1.3) * .6, rb, w * .9, h * 1.1); }
    // ripple marks and tracks
    g.strokeStyle = css(lit("#8c6f55"), .18); g.lineWidth = 1;
    for (const m of E.marks) { const y = mix(HZ + H * .04, H, Math.pow(m.y, 1.2)), d = depth(y), x = mix(W * .25, W, m.x), l = (16 + d * 150) * m.l;
      g.beginPath(); g.moveTo(x - l / 2, y); g.quadraticCurveTo(x, y - 1 - d * 3, x + l / 2, y); g.stroke(); }
    g.restore();
  };
  // surf: several lines of white water along the shore; faces, breaking and white water by the swell
  E.layers.waves = t => {
    const s = S, h = clamp(s.wh ?? .8, .1, 5), period = clamp(s.wp || 9, 3, 20), LIVE = 5;
    const lightF = mix(.25, 1, s.day) * (1 - s.grey * .25), foamC = "rgba(251,249,242,";
    const reach = H * (.04 + h * .065), sb = clamp(.5 - h * .07, .15, .45);
    const persp = q => depth(q[1]) * .8 + .2;
    g.save(); g.clip(sc.seaPath); g.lineJoin = "round"; g.lineCap = "round";
    for (let i = 0; i < LIVE; i++) {
      const cyc = t / (period * LIVE) + i / LIVE, id = Math.floor(cyc) * LIVE + i, p = cyc % 1;
      const off = (1 - p) * reach, stand = smooth(sb - .3, sb, p), broke = smooth(sb, sb + .06, p), fade = smooth(0, .08, p) * (1 - smooth(.9, 1, p));
      const pts = shoreP.map((q, j) => { const d = persp(q), sect = .55 + .45 * Math.sin(j * .19 + id * 1.7) * Math.sin(j * .07 + id);
        const x = q[0] + q.n[0] * off * d, y = q[1] + q.n[1] * off * d, face = H * .02 * h * d * sect * stand * (1 - broke * .8);
        return [x, y, y - face, sect, d]; });
      if (stand > .02) {
        g.fillStyle = css(lit("#1e5e62"), .5 * stand * fade);
        g.beginPath(); pts.forEach(([x, , c], k) => k ? g.lineTo(x, c) : g.moveTo(x, c)); [...pts].reverse().forEach(([x, y]) => g.lineTo(x, y + 1)); g.closePath(); g.fill();
        g.strokeStyle = css(lit("#86cbbd"), .6 * stand * (1 - broke) * fade); g.lineWidth = 1.2;
        g.beginPath(); pts.forEach(([x, , c], k) => k ? g.lineTo(x, c) : g.moveTo(x, c)); g.stroke();
      } else { g.strokeStyle = css(lit("#86c7bd"), .25 * fade); g.lineWidth = 1; g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); }
      if (broke > 0) {   // white water rolling in, in broken sections
        for (let k = 0; k < pts.length - 1; k++) {
          const [x, , c, sect, d] = pts[k], [x2, , c2] = pts[k + 1]; if (sect < .3) continue;
          g.strokeStyle = foamC + (.85 * broke * fade * lightF * Math.min(1, sect * 1.3)) + ")"; g.lineWidth = (1.5 + h * 3) * (.3 + d) * (1 + (p - sb) * 2) * (.5 + sect * .5);
          g.beginPath(); g.moveTo(x, c); g.lineTo(x2, c2); g.stroke();
        }
      }
    }
    // the swash, and a thin film of water sliding over the flat sand
    const sw = Math.sin(t * 2 * Math.PI / period) * .5 + .5;
    g.restore(); g.save(); g.lineJoin = "round";
    g.beginPath(); shoreP.forEach((q, k) => { const d = persp(q), o = -(3 + sw * (6 + h * 8)) * d; const x = q[0] + q.n[0] * o, y = q[1] + q.n[1] * o; k ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.strokeStyle = foamC + (.65 * lightF) + ")"; g.lineWidth = 1.5; g.stroke();
    g.restore();
  };
  E.layers.scrub = () => {};
  E.layers.things = (t, dt) => { drawPalm(t, dt); drawSurfer(t); };

  /* The surfer: tanned, long brown curly hair blowing downwind, blue-and-white shirt over a dark
     blue wetsuit, standing on the wet sand watching the waves (facing the sea, on our left). */
  const surfer = { curls: Array.from({ length: 16 }, (_, i) => ({ a: i / 16, r: .5 + ((i * 7) % 5) / 8, ph: i * 1.3 })) };
  function drawSurfer(t) {
    const s = S, h = s.wh ?? .5, x = X(.6), feet = Y(.155), Hs = H * .2, u = Hs;     // u: his height in px
    const big = h >= 2, kind = h < .5 ? "flat" : h < 1 ? "long" : "short";
    const hop = big ? Math.abs(Math.sin(t * 5)) * u * .06 : 0, y = feet - hop;
    const skin = lit("#a86a43"), suit = lit("#1f2b4d"), suitHi = lit("#34457a"), blue = lit("#3f74b8"), white = lit("#f2efe7"), hair = lit("#5b3a22"), hairHi = lit("#7a4f2e");
    const board = lit("#f4f0e6"), stripe = lit("#2f6fa8");
    const side = Math.abs(s.wx) < .05 ? 1 : Math.sign(s.wx), blow = clamp(s.kn / 30) * Math.max(.4, Math.abs(s.wx));
    g.save(); g.lineCap = "round"; g.lineJoin = "round";
    // shadow on the wet sand
    g.fillStyle = "rgba(40,30,20,.18)"; g.beginPath(); g.ellipse(x + u * .05, feet + 2, u * .16, u * .025, 0, 0, 7); g.fill();
    // board: on the sand when it's flat, standing beside him otherwise (long or short)
    const drawBoard = (bx, by, len, wid, ang) => { g.save(); g.translate(bx, by); g.rotate(ang);
      g.fillStyle = css(board); g.beginPath(); g.ellipse(0, -len / 2, wid / 2, len / 2, 0, 0, 7); g.fill();
      g.strokeStyle = css(stripe); g.lineWidth = Math.max(1, wid * .12); g.beginPath(); g.moveTo(0, -len * .92); g.lineTo(0, -len * .08); g.stroke();
      g.strokeStyle = css(lit("#c9c2b3")); g.lineWidth = 1; g.beginPath(); g.ellipse(0, -len / 2, wid / 2, len / 2, 0, 0, 7); g.stroke(); g.restore(); };
    if (kind === "flat") {   // the longboard lying on the sand beside him
      const cx = x + u * .42, cy = feet - u * .01;
      g.fillStyle = css(board); g.beginPath(); g.ellipse(cx, cy, u * .62, u * .045, -.03, 0, 7); g.fill();
      g.strokeStyle = css(stripe); g.lineWidth = Math.max(1, u * .012); g.beginPath(); g.moveTo(cx - u * .55, cy); g.lineTo(cx + u * .55, cy - u * .01); g.stroke();
      g.strokeStyle = css(lit("#c9c2b3")); g.lineWidth = 1; g.beginPath(); g.ellipse(cx, cy, u * .62, u * .045, -.03, 0, 7); g.stroke(); }
    const bx = x + u * .2, boardLen = kind === "short" ? u * .92 : u * 1.38, bw = kind === "short" ? u * .13 : u * .16;
    if (kind !== "flat") drawBoard(bx, feet + 1, boardLen, bw, .06);
    // legs in the wetsuit
    g.strokeStyle = css(suit); g.lineWidth = u * .075;
    g.beginPath(); g.moveTo(x - u * .04, y - u * .46); g.lineTo(x - u * .06, feet - u * .02); g.moveTo(x + u * .04, y - u * .46); g.lineTo(x + u * .07, feet - u * .02); g.stroke();
    g.fillStyle = css(skin); for (const fx of [-.07, .08]) { g.beginPath(); g.ellipse(x + u * fx, feet - u * .01, u * .035, u * .014, 0, 0, 7); g.fill(); }
    // torso: wetsuit, with the blue-and-white striped shirt over it
    g.fillStyle = css(suit); g.beginPath(); g.ellipse(x, y - u * .52, u * .1, u * .09, 0, 0, 7); g.fill();
    const tx0 = x - u * .1, ty0 = y - u * .8, tw = u * .2, th = u * .3;
    g.save(); g.beginPath(); g.moveTo(tx0 + tw * .08, ty0); g.lineTo(tx0 + tw * .92, ty0); g.lineTo(tx0 + tw, ty0 + th); g.lineTo(tx0, ty0 + th); g.closePath(); g.clip();
    for (let k = 0; k < 8; k++) { g.fillStyle = css(k % 2 ? white : blue); g.fillRect(tx0, ty0 + k * th / 8, tw, th / 8 + .5); }
    g.restore();
    // arms: one resting on the board, the other at his side, or waving when it's big
    g.strokeStyle = css(skin); g.lineWidth = u * .05;
    if (kind !== "flat") { g.beginPath(); g.moveTo(x + u * .08, y - u * .76); g.quadraticCurveTo(x + u * .16, y - u * .66, bx - u * .02, feet - boardLen * .62); g.stroke(); }
    else { g.beginPath(); g.moveTo(x + u * .08, y - u * .76); g.lineTo(x + u * .12, y - u * .52); g.stroke(); }
    if (big) { const w = Math.sin(t * 9) * u * .05; g.beginPath(); g.moveTo(x - u * .08, y - u * .76); g.lineTo(x - u * .18, y - u * 1.0); g.lineTo(x - u * .2 + w, y - u * 1.16); g.stroke(); }
    else { g.beginPath(); g.moveTo(x - u * .08, y - u * .76); g.quadraticCurveTo(x - u * .14, y - u * .64, x - u * .11, y - u * .52); g.stroke(); }
    g.strokeStyle = css(blue); g.lineWidth = u * .06; g.beginPath(); g.moveTo(x - u * .08, y - u * .79); g.lineTo(x - u * .1, y - u * .72); g.moveTo(x + u * .08, y - u * .79); g.lineTo(x + u * .1, y - u * .72); g.stroke();
    // neck and head, turned towards the waves (to our left)
    g.fillStyle = css(skin); g.fillRect(x - u * .025, y - u * .86, u * .05, u * .07);
    const hx = x - u * .01, hy = y - u * .93, hr = u * .07;
    g.beginPath(); g.ellipse(hx - u * .012, hy, hr * .9, hr, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(hx - hr * .85, hy - hr * .1); g.lineTo(hx - hr * 1.12, hy + hr * .18); g.lineTo(hx - hr * .82, hy + hr * .3); g.closePath(); g.fill();   // nose: he's looking left, out to sea
    g.fillStyle = css(lit("#8f5636")); g.beginPath(); g.ellipse(hx + hr * .1, hy + hr * .1, hr * .2, hr * .28, 0, 0, 7); g.fill();   // ear
    // long brown curly hair, streaming downwind
    for (const c of surfer.curls) {
      const k = c.a, along = k * .9 + .1, wob = Math.sin(t * (3 + s.kn * .12) + c.ph) * u * .012 * (1 + blow * 2);
      const cx = hx + hr * .25 + side * along * u * .16 * blow + Math.cos(k * 5 + c.ph) * hr * .5 * (1 - blow * .5);
      const cy = hy - hr * .55 + along * u * .17 * (1 - blow * .6) + Math.sin(k * 7 + c.ph) * hr * .25 + wob;
      g.fillStyle = css(k % .25 < .12 ? hairHi : hair); g.beginPath(); g.arc(cx, cy, hr * .32 * c.r * (1 - along * .3), 0, 7); g.fill();
    }
    g.fillStyle = css(hair); g.beginPath(); g.ellipse(hx + hr * .3, hy - hr * .4, hr * .9, hr * .62, .2, 0, 7); g.fill();
    g.restore();
  }
}
const has = id => !!SCENES[id];

/* ---------- canvas & layout ---------- */
const wrap = document.createElement("div");
wrap.id = "beach"; wrap.setAttribute("aria-hidden", "true");
wrap.innerHTML = '<canvas id="beach-cv"></canvas>';
document.getElementById("grain").before(wrap);
const cv = wrap.firstChild, main = cv.getContext("2d");
let g = main;                       // the context being drawn into (swapped while a layer paints in)
const hud = document.createElement("div");
hud.id = "beach-hud"; hud.className = "ui"; hud.setAttribute("aria-live", "polite");
hud.innerHTML = '<h2 id="bh-name"></h2><p id="bh-now"></p>';
const panel = document.createElement("section");
panel.id = "beach-fc"; panel.className = "ui"; panel.setAttribute("aria-label", "Hourly forecast");
document.body.append(hud, panel);

let W = 0, H = 0, dpr = 1, HZ = 0, sc = null, open = false, shoreP = [], scrubP = [], tufts = [], bushes = [], tracks = [], clouds = [], rain = [], drift = [], ripples = [], stars = [];
const X = x => x * W, Y = y => HZ + y * H;
function resize() {
  W = innerWidth; H = innerHeight; dpr = Math.min(1.5, devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
  HZ = H * (W / H < .8 ? (sc?.hzP ?? .3) : (sc?.hz ?? .4));
  if (sc) build();
}
addEventListener("resize", resize);

// smooth a polyline (Catmull-Rom) into screen points
function curve(pts, n = 10) {
  const p = pts.map(([x, y]) => [X(x), Y(y)]), out = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(j => .5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(p[p.length - 1]);
  return out;
}
const depth = y => clamp((y - HZ) / (H - HZ));            // 0 at the horizon, 1 at the bottom edge
let rnd = 1; const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);

function build() {
  rnd = 7;
  shoreP = curve(sc.shore, 14);
  scrubP = sc.scrub ? curve(sc.scrub, 10) : [];
  // seaward normals along the shore, for the lines of breaking waves
  const ref = [X((sc.seaRef || [.25, .06])[0]), Y((sc.seaRef || [.25, .06])[1])];
  shoreP.forEach((p, i) => {
    const a = shoreP[Math.max(0, i - 1)], b = shoreP[Math.min(shoreP.length - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if (nx * (ref[0] - p[0]) + ny * (ref[1] - p[1]) < 0) { nx = -nx; ny = -ny; }
    p.n = [nx, ny];
  });
  tufts = []; bushes = [];
  if (sc.out) {   // looking out to sea: water above the shore line, sand below it
    const sea = new Path2D(); sea.moveTo(-2, HZ); sea.lineTo(W + 2, HZ); [...shoreP].reverse().forEach(p => sea.lineTo(...p)); sea.lineTo(-2, shoreP[0][1]); sea.closePath(); sc.seaPath = sea;
    const sand = new Path2D(); sand.moveTo(-2, shoreP[0][1]); shoreP.forEach(p => sand.lineTo(...p)); sand.lineTo(W + 2, H + 2); sand.lineTo(-2, H + 2); sand.closePath(); sc.sandPath = sand;
  } else if (sc.scrub) {
  const scrub = new Path2D(); scrub.moveTo(...scrubP[0]); scrubP.forEach(p => scrub.lineTo(...p));
  scrub.lineTo(X(.68), H + 2); scrub.lineTo(W + 2, H + 2); scrub.lineTo(W + 2, Y(-.06)); scrub.closePath();
  sc.scrubPath = scrub;
  const sea = new Path2D(); sea.moveTo(-2, HZ); sea.lineTo(shoreP[0][0], HZ); shoreP.forEach(p => sea.lineTo(...p));
  sea.lineTo(-2, shoreP[shoreP.length - 1][1]); sea.closePath(); sc.seaPath = sea;
  const sand = new Path2D(); sand.moveTo(...shoreP[0]); shoreP.forEach(p => sand.lineTo(...p)); sand.lineTo(-2, H + 2);
  sand.lineTo(X(.66), H + 2); [...scrubP].reverse().forEach(p => sand.lineTo(...p)); sand.closePath(); sc.sandPath = sand;
  }
  for (let i = 0; i < 2600 && sc.scrubPath && !sc.out && tufts.length < 190; i++) {
    const x = X(.45 + rand() * .6), y = Y(-.02 + rand() * (1 - HZ / H + .05));
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (g.isPointInPath(sc.scrubPath, x, y)) {
      (rand() < .22 ? bushes : tufts).push({ x, y, s: .4 + depth(y) * 1.6, ph: rand() * 6.28, f: .8 + rand() * .8, c: rand() });
    }
  }
  tufts.sort((a, b) => a.y - b.y); bushes.sort((a, b) => a.y - b.y);
  // pine wood on the lower slopes to the right (in the photo: dark crowns above the scrub)
  if (sc.build) sc.build();
  if (sc.pineWood) sc.pines = Array.from({ length: 70 }, () => { const x = .74 + rand() * .3, top = -.012 - (x - .7) * .19;
    return { x, y: top + rand() * (.03 - top) * .55, r: .5 + rand() * .7 }; }).sort((a, b) => a.y - b.y);
  tracks = Array.from({ length: 9 }, () => ({ x: X(.25 + rand() * .45), y: Y(.12 + rand() * .45), r: 40 + rand() * 160, a0: rand() * 6.28, a1: 1 + rand() * 2.2 }));
  clouds = Array.from({ length: 22 }, (_, i) => ({ x: rand() * 1.4 - .2, y: .04 + rand() * .3, s: .5 + rand() * 1.1, k: i / 22, puffs: Array.from({ length: 5 + (rand() * 4 | 0) }, () => [rand() * 2 - 1, rand() * .5 - .25, .4 + rand() * .6]) }));
  ripples = Array.from({ length: 420 }, () => ({ u: rand(), v: Math.pow(rand(), 1.6), ph: rand() * 6.28, cap: rand() }));
  stars = Array.from({ length: 140 }, () => ({ x: rand(), y: Math.pow(rand(), 1.4), b: rand(), ph: rand() * 6.28 }));
  rain = Array.from({ length: 900 }, () => ({ x: rand(), y: rand(), l: .6 + rand() * .8, s: .7 + rand() * .6 }));
  drift = Array.from({ length: 90 }, () => ({ x: rand(), y: rand(), l: rand() }));
}

/* ---------- light ---------- */
// sky colours by sun elevation: [elevation, top, horizon]
const SKY = [[-18, "#0a1222", "#141f35"], [-9, "#121c37", "#2f3757"], [-4, "#283766", "#8c6a7c"], [0, "#47629a", "#f0a27a"],
  [4, "#6386b6", "#f5c393"], [10, "#7aa3cc", "#ecdcc0"], [25, "#7eaad2", "#e6ece9"], [90, "#7aa8d2", "#e3ebec"]];
function skyAt(el) {
  for (let i = 0; i < SKY.length - 1; i++) {
    const [a, ta, ha] = SKY[i], [b, tb, hb] = SKY[i + 1];
    if (el <= b) { const k = clamp((el - a) / (b - a)); return [mixc(hex(ta), hex(tb), k), mixc(hex(ha), hex(hb), k)]; }
  }
  return [hex(SKY[7][1]), hex(SKY[7][2])];
}

let S = null;   // the state of the world for this frame
function state(t) {
  const o = FC && FC.spots[selected?.id || "valde"], date = new Date(T0.getTime() + t * 3600e3);
  const sun = body(date, sc.lat, sc.lon), ph = moonPhase(date), moon = body(date, sc.lat, sc.lon, ph * 2 * Math.PI);
  const v = k => (o ? at(o, k, t) : null);
  const kn = v("kn") ?? 0, gust = Math.max(kn, v("gust") ?? kn), dir = o ? dirAt(o, t) : null;
  const cloud = clamp((v("cloud") ?? 20) / 100), rainmm = Math.max(0, v("rain") ?? 0);
  const wh = v("wh"), wp = v("wp") ?? 8;
  // wind as seen on screen: x = to the right, z = away from us
  let wx = 0, wz = 0;
  if (dir != null) { const to = (dir + 180) * R, right = (sc.bearing + 90) * R, fwd = sc.bearing * R;
    wx = Math.sin(to) * Math.sin(right) + Math.cos(to) * Math.cos(right); wz = Math.sin(to) * Math.sin(fwd) + Math.cos(to) * Math.cos(fwd); }
  const day = smooth(-7, 6, sun.el), golden = clamp(1 - Math.abs(sun.el - 2.5) / 9) * smooth(-5, 0, sun.el);
  const wet = clamp(rainmm / 2.5), grey = clamp(cloud * .75 + wet * .5);
  const [top, hor] = skyAt(sun.el);
  const greyTop = mixc(hex("#8b979e"), hex("#2a313b"), 1 - day), greyHor = mixc(hex("#c4c8c6"), hex("#3a4049"), 1 - day);
  return { date, sun, moon, ph, kn, gust, dir, cloud, rainmm, wh, wp, wx, wz, day, golden, wet, grey, temp: v("temp"),
    top: mixc(top, greyTop, grey * .85), hor: mixc(hor, greyHor, grey * .75), ec: FC && FC.model[Math.round(t)] === "ecmwf" };
}
// how the land and sea are lit: night is dark and blue, golden hour warm, overcast flat
function lit(h, extra = 0) {
  let c = hex(h); const s = S;
  c = mixc(c, [c[0] * 1.06 + 8, c[1] * .93, c[2] * .8], s.golden * .55);
  const avg = (c[0] + c[1] + c[2]) / 3;
  c = mixc(c, [avg * .92, avg * .94, avg * .97], s.grey * .5);
  const dark = mix(.34, 1, s.day) * (1 - s.grey * .18) + extra;
  c = c.map(x => x * dark);
  return mixc(c, [c[0] * .7 + 6, c[1] * .8 + 10, c[2] * 1.1 + 26], (1 - s.day) * .8);
}

/* ---------- drawing ---------- */
function polyPath(pts) { const p = new Path2D(); p.moveTo(X(pts[0][0]), Y(pts[0][1])); for (const [x, y] of pts.slice(1)) p.lineTo(X(x), Y(y)); p.closePath(); return p; }
const screenOf = (az, el) => { let d = ((az - sc.bearing + 540) % 360) - 180; const ppd = W / sc.fov; return [W / 2 + d * ppd, HZ - el * ppd]; };

function drawSky(t) {
  const s = S, gr = g.createLinearGradient(0, 0, 0, HZ);
  gr.addColorStop(0, css(s.top)); gr.addColorStop(.75, css(mixc(s.top, s.hor, .6))); gr.addColorStop(1, css(s.hor));
  g.fillStyle = gr; g.fillRect(0, 0, W, HZ + 2);
  // stars and moon
  const night = 1 - smooth(-14, -3, s.sun.el);
  if (night > 0) {
    for (const st of stars) { const a = night * (1 - s.cloud * .9) * (.35 + .65 * st.b) * (.75 + .25 * Math.sin(t * 1.3 + st.ph));
      if (a < .03) continue; g.fillStyle = `rgba(250,246,230,${a})`; g.fillRect(st.x * W, st.y * HZ * .92, st.b > .8 ? 1.6 : 1, st.b > .8 ? 1.6 : 1); }
  }
  if (s.moon.el > -2) {
    const [mx, my] = screenOf(s.moon.az, Math.max(s.moon.el, -1)), r = Math.max(7, W * .009), vis = (1 - s.day * .7) * (1 - s.cloud * .7);
    if (mx > -40 && mx < W + 40 && vis > .05) {
      g.save(); g.globalAlpha = vis;
      const glow = g.createRadialGradient(mx, my, r, mx, my, r * 7); glow.addColorStop(0, "rgba(240,236,214,.22)"); glow.addColorStop(1, "rgba(240,236,214,0)");
      g.fillStyle = glow; g.fillRect(mx - r * 7, my - r * 7, r * 14, r * 14);
      g.fillStyle = "#f2ecd6"; g.beginPath(); g.arc(mx, my, r, 0, 7); g.fill();
      // shadow side by phase
      const p = s.ph, k = Math.cos(p * 2 * Math.PI);          // 1 new … -1 full
      g.fillStyle = css(s.top, .92); g.beginPath();
      if (p < .5) { g.arc(mx, my, r, Math.PI / 2, -Math.PI / 2); g.ellipse(mx, my, Math.abs(k) * r, r, 0, -Math.PI / 2, Math.PI / 2, k < 0); }
      else { g.arc(mx, my, r, -Math.PI / 2, Math.PI / 2); g.ellipse(mx, my, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, k < 0); }
      g.fill(); g.restore();
    }
  }
  // sun
  if (s.sun.el > -4) {
    const [sx, sy] = screenOf(s.sun.az, s.sun.el), r = Math.max(10, W * .014), clear = 1 - s.grey * .85;
    if (sx > -W * .3 && sx < W * 1.3) {
      const warm = s.golden;
      const glow = g.createRadialGradient(sx, sy, 0, sx, sy, r * (9 + warm * 6));
      glow.addColorStop(0, `rgba(255,${mix(250, 214, warm) | 0},${mix(232, 160, warm) | 0},${.85 * clear})`);
      glow.addColorStop(.12, `rgba(255,${mix(246, 196, warm) | 0},${mix(220, 140, warm) | 0},${.35 * clear})`);
      glow.addColorStop(1, "rgba(255,240,220,0)");
      g.fillStyle = glow; g.fillRect(sx - r * 16, sy - r * 16, r * 32, r * 32);
      if (sy < HZ + r) { g.save(); g.beginPath(); g.rect(0, 0, W, HZ); g.clip();
        g.fillStyle = `rgba(255,${mix(252, 220, warm) | 0},${mix(240, 170, warm) | 0},${clear})`; g.beginPath(); g.arc(sx, sy, r, 0, 7); g.fill(); g.restore(); }
    }
  }
}

function drawClouds(t, dt) {
  const s = S, n = Math.round(clouds.length * clamp(s.cloud * 1.05 + s.wet * .3));
  const speed = (.004 + s.kn * .0009) * (Math.abs(s.wx) > .15 ? Math.sign(s.wx) : 1) * (s.wx === 0 ? 1 : Math.max(.3, Math.abs(s.wx)));
  const lightTop = mixc(mixc([255, 252, 246], [255, 214, 186], s.golden), [70, 80, 100], (1 - s.day) * .85);
  const shade = mixc(mixc([196, 202, 210], [176, 150, 160], s.golden), [36, 42, 56], (1 - s.day) * .85);
  const dark = mixc(shade, [120, 128, 138], s.wet * .6);
  for (let i = 0; i < n; i++) {
    const c = clouds[i];
    c.x += speed * dt * (.6 + c.s * .4); if (c.x > 1.35) c.x = -.35; if (c.x < -.35) c.x = 1.35;
    const cx = c.x * W, cy = c.y * HZ * (s.cloud > .7 ? .9 : 1), size = c.s * W * .07 * (1 + s.cloud * .6);
    for (const [dx, dy, r] of c.puffs) {
      const px = cx + dx * size, py = cy + dy * size * .55, pr = r * size * .7;
      const gr = g.createRadialGradient(px, py - pr * .3, 0, px, py, pr);
      gr.addColorStop(0, css(mixc(lightTop, dark, s.wet * .7), .9 * (.55 + s.cloud * .45)));
      gr.addColorStop(.6, css(dark, .55 * (.5 + s.cloud * .5)));
      gr.addColorStop(1, css(dark, 0));
      g.fillStyle = gr; g.beginPath(); g.ellipse(px, py, pr * 1.6, pr, 0, 0, 7); g.fill();
    }
  }
  // overcast / rain: a soft veil over the sky
  if (s.grey > .45) { g.fillStyle = css(mixc(dark, s.hor, .4), (s.grey - .45) * .6); g.fillRect(0, 0, W, HZ); }
}

function drawHills(t) {
  const s = S;
  sc.hills.forEach((h, i) => { g.fillStyle = css(mixc(lit(h.c), s.hor, i ? .12 : .32)); g.fill(polyPath(h.p)); });
  for (const p of sc.pines || []) { const x = X(p.x), y = Y(p.y), r = (2.2 + depth(y) * 30) * p.r;
    g.fillStyle = css(lit("#33502f")); g.beginPath(); g.ellipse(x, y, r * 1.5, r, 0, 0, 7); g.fill();
    g.fillStyle = css(lit("#4c6a3d"), .7); g.beginPath(); g.ellipse(x - r * .3, y - r * .3, r * .8, r * .45, 0, 0, 7); g.fill(); }
  // little lights at night in the houses on the hill
  const night = 1 - smooth(-6, 1, s.sun.el);
  if (night > 0) (sc.lights || []).forEach(([x, y], i) => { const a = night * (.6 + .4 * Math.sin(t * .7 + i * 2.1));
    g.fillStyle = `rgba(255,206,130,${a})`; g.beginPath(); g.arc(X(x), Y(y), 1.4, 0, 7); g.fill(); });
}

function drawSea(t) {
  const s = S, far = mixc(lit("#4f8a9a"), s.hor, .45), mid = lit("#2f8189"), near = lit("#3e9b98");
  const gr = g.createLinearGradient(0, HZ, 0, H);
  gr.addColorStop(0, css(far)); gr.addColorStop(.18, css(mixc(far, mid, .7))); gr.addColorStop(.5, css(mid)); gr.addColorStop(1, css(near));
  g.fillStyle = gr; g.fillRect(0, HZ, W, H - HZ);
  // shallow turquoise band along the shore
  g.save(); g.clip(sc.seaPath); g.lineJoin = "round";
  const shore = new Path2D(); shore.moveTo(...shoreP[0]); shoreP.forEach(p => shore.lineTo(...p));
  for (const [w, a] of [[.11, .25], [.07, .3], [.035, .35]]) {
    g.strokeStyle = css(lit("#6fc0b0"), a * (1 - s.grey * .4)); g.lineWidth = H * w * (sc.shallow ?? 1); g.stroke(shore);
  }
  // sun or moon glitter on the water
  const glit = (b, alpha) => { if (b.el < -1) return; const [sx] = screenOf(b.az, b.el); if (sx < -W * .2 || sx > W * 1.2) return;
    for (let i = 0; i < 160; i++) { const v = (i / 160), y = HZ + 2 + v * v * (H - HZ) * .6, spread = 4 + v * W * .09 * (1 + b.el / 30);
      const x = sx + Math.sin(i * 12.9898 + Math.floor(t * 2.2 + i) * 4.1) * spread, a = alpha * (1 - v) * (.4 + .6 * Math.abs(Math.sin(t * 3 + i * 1.7)));
      g.fillStyle = `rgba(255,248,226,${a})`; g.fillRect(x, y, 2 + v * 14, 1 + v * 1.5); } };
  glit(S.sun, .75 * (1 - s.grey * .9) * smooth(-1, 6, s.sun.el));
  glit(S.moon, .45 * (1 - s.cloud * .8) * (1 - s.day) * (1 - Math.abs(Math.cos(s.ph * 2 * Math.PI))));
  // ripples and, with wind, whitecaps
  const caps = clamp((s.kn - 11) / 22), storm = clamp((s.kn - 25) / 15), seaH = H - HZ, lightF = (1 - s.grey * .3) * mix(.2, 1, s.day);
  // foam streaks lying along the wind once it really blows
  if (storm > 0) { g.strokeStyle = `rgba(250,248,240,${.22 * storm * lightF})`; g.lineCap = "round";
    for (let i = 0; i < 70 * storm; i++) { const r = ripples[i], y = HZ + 4 + r.v * seaH * (sc.seaSpan ?? .7), d = depth(y), L = (30 + r.cap * 140) * (.2 + d);
      const x = ((r.u * W + t * (s.wx || .3) * (20 + s.kn) * (.3 + d)) % (W + L) + W + L) % (W + L) - L;
      g.lineWidth = .6 + d * 1.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + L, y + s.wz * L * .05); g.stroke(); } }
  for (const r of ripples) {
    const y = HZ + 3 + r.v * seaH * (sc.seaSpan ?? .62), d = depth(y), x = r.u * W + Math.sin(t * .5 + r.ph) * 6 * d + (t * s.wx * (2 + s.kn * .3) * d) % W;
    const xx = ((x % W) + W) % W, w = 3 + d * 26;
    if (r.cap < caps * .5 + storm * .45 && Math.sin(t * (1.2 + s.kn * .04) + r.ph) > .6 - storm * .55) {
      g.fillStyle = `rgba(250,248,240,${(.55 + storm * .4) * lightF})`; g.fillRect(xx, y, w * (.8 + storm * 1.4), 1 + d * (2.5 + storm * 2.5));
      if (storm > .3) { g.fillStyle = `rgba(250,248,240,${.25 * storm * lightF})`; g.fillRect(xx - w * .3, y + 1 + d * 3, w * 1.6, 1 + d); } }
    else { g.fillStyle = css(lit("#a9dad3"), .14 + .12 * Math.sin(t * .8 + r.ph)); g.fillRect(xx, y, w, 1 + d); }
  }
  g.restore();
}

function drawLand(t) {
  const s = S;
  // the beach: everything right of the water's edge
  const beach = new Path2D(); beach.moveTo(...shoreP[0]); shoreP.forEach(p => beach.lineTo(...p));
  beach.lineTo(-2, H + 2); beach.lineTo(W + 2, H + 2); beach.lineTo(W + 2, Y(-.002)); beach.lineTo(...shoreP[0]); beach.closePath();
  const sand = g.createLinearGradient(0, HZ, 0, H);
  sand.addColorStop(0, css(mixc(lit("#eadbb8"), s.hor, .2))); sand.addColorStop(.4, css(lit("#e6d2a8"))); sand.addColorStop(1, css(lit("#dcc497", .03)));
  g.fillStyle = sand; g.fill(beach);
  // rain darkens the sand
  if (s.wet > 0) { g.fillStyle = css(lit("#8f7b5a"), s.wet * .35); g.fill(beach); }
  // tracks in the sand
  g.save(); g.clip(beach); g.strokeStyle = css(lit("#b9a27a"), .22); g.lineWidth = 1;
  for (const k of tracks) { const d = depth(k.y); g.beginPath(); g.ellipse(k.x, k.y, k.r * (.3 + d), k.r * (.08 + d * .25), 0, k.a0, k.a0 + k.a1); g.stroke(); }
  // wet sand by the water
  const shore = new Path2D(); shore.moveTo(...shoreP[0]); shoreP.forEach(p => shore.lineTo(...p));
  g.strokeStyle = css(lit("#c7ae84"), .7); g.lineWidth = H * .022; g.stroke(shore);
  g.restore();
}

function drawWaves(t) {
  // A new wave reaches the sand every `period` seconds (the forecast period, in real time).
  // Bigger waves stand up and break further out, so they appear further from the shore.
  const s = S, h = clamp(s.wh ?? .6, .1, 4), period = clamp(s.wp || 8, 3, 20), LIVE = 3;
  const reach = H * (.03 + h * .075), foam = mix(.2, 1, s.day) * (1 - s.grey * .25);
  const breakAt = clamp(.55 - h * .1, .2, .5);              // big waves break earlier on their way in
  g.save(); g.beginPath(); g.rect(0, HZ + 1, W, H); g.clip(); g.lineJoin = "round"; g.lineCap = "round";
  // a wave breaks in uneven sections along the beach, and shrinks into the distance
  const persp = q => { const d = depth(q[1]); return Math.pow(d, 1.25) * .95 + .05; };
  const SEG = 5;
  for (let i = 0; i < LIVE; i++) {
    const n = Math.floor(t / period + i / LIVE * LIVE);       // which wave this is, so each one breaks differently
    const p = ((t / (period * LIVE)) + i / LIVE) % 1;         // 0 standing up far out → 1 on the sand
    const off = (1 - p) * reach, show = smooth(0, .15, p) * (1 - smooth(.9, 1, p));
    const white = smooth(breakAt, breakAt + .12, p), thick = (.8 + h * .9) * (1 + p);
    for (let j0 = 0; j0 < shoreP.length - 1; j0 += SEG) {
      const seg = shoreP.slice(j0, j0 + SEG + 1), q0 = seg[0], far = smooth(.02, .14, depth(q0[1]));
      const part = .35 + .65 * (.5 + .5 * Math.sin(j0 * .21 + i * 2.3 + n * 1.7 + Math.sin(j0 * .07 + n) * 2));
      const A = show * far * part; if (A < .02) continue;
      const line = o => { g.beginPath(); seg.forEach((q, k) => { const d = persp(q);
        const x = q[0] + q.n[0] * o * d, y = q[1] + q.n[1] * o * d; k ? g.lineTo(x, y) : g.moveTo(x, y); }); };
      const tk = thick * (.3 + persp(q0) * .9);
      line(off + 2 + tk * 1.4); g.strokeStyle = css(lit("#1f6667"), A * .38 * (1 - white * .4)); g.lineWidth = tk * 1.8; g.stroke();
      line(off); g.strokeStyle = `rgba(251,249,240,${A * foam * mix(.12, .9, white * part)})`; g.lineWidth = tk * mix(.5, 1, white); g.stroke();
      if (white > 0) { line(off - tk * 2.5 * white); g.strokeStyle = `rgba(251,249,240,${A * foam * white * .3})`; g.lineWidth = tk * 2.2; g.stroke(); }
    }
  }
  // the swash: foam sliding up the sand and back
  const sw = Math.sin(t * 2 * Math.PI / period) * .5 + .5;
  g.beginPath();
  shoreP.forEach((q, j) => { const d = depth(q[1]) * .9 + .1, o = -(sw * 6 + 2) * d;
    const x = q[0] + q.n[0] * o, y = q[1] + q.n[1] * o; j ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.strokeStyle = `rgba(251,249,240,${.7 * foam})`; g.lineWidth = 1.5; g.stroke();
  // spray blown off the crests in strong wind (over the water only)
  g.save(); g.clip(sc.seaPath);
  if (s.kn > 18) { const n = Math.round((s.kn - 18) * 3);
    for (let i = 0; i < n; i++) { const q = shoreP[(i * 7 + Math.floor(t * 3)) % shoreP.length], d = depth(q[1]) + .1, k = (t * 1.7 + i * .37) % 1;
      g.fillStyle = `rgba(251,249,240,${(1 - k) * .45 * foam})`;
      g.fillRect(q[0] + q.n[0] * reach * .5 * d + s.wx * k * 40 * d, q[1] + q.n[1] * reach * .5 * d - k * 10 * d, 2 * d + 1, 1); } }
  g.restore();
  g.restore();
}

function drawScrub(t) {
  const s = S; if (!sc.scrubPath) return;
  const gr = g.createLinearGradient(0, HZ, 0, H);
  gr.addColorStop(0, css(mixc(lit("#8d9a5e"), s.hor, .2))); gr.addColorStop(.5, css(lit("#9b9461"))); gr.addColorStop(1, css(lit("#8a7f50")));
  g.fillStyle = gr; g.fill(sc.scrubPath);
  // sandy edge where the scrub starts
  g.beginPath(); scrubP.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p));
  g.strokeStyle = css(lit("#c9b486"), .8); g.lineWidth = H * .012; g.stroke();
  const sway = clamp(s.kn / 30) * (Math.abs(s.wx) > .1 ? Math.sign(s.wx) : 0) + (s.wx === 0 ? 0 : s.wx * .3);
  const gusty = clamp((s.gust - s.kn) / 12);
  for (const b of bushes) { const r = 3 + b.s * 9;
    g.fillStyle = css(lit(b.c > .5 ? "#3f5a35" : "#4d6a3c")); g.beginPath(); g.ellipse(b.x, b.y, r * 1.5, r, 0, 0, 7); g.fill();
    g.fillStyle = css(lit("#6f8a4c"), .6); g.beginPath(); g.ellipse(b.x - r * .3, b.y - r * .35, r * .8, r * .45, 0, 0, 7); g.fill(); }
  g.lineCap = "round";
  for (const k of tufts) {
    const h = 4 + k.s * 12, bend = (sway * (.6 + .4 * Math.sin(t * k.f * (1 + s.kn * .05) + k.ph)) + gusty * .3 * Math.sin(t * 5 + k.ph)) * h * .7;
    g.strokeStyle = css(lit(k.c > .5 ? "#7d8a4a" : "#a29a5c")); g.lineWidth = .7 + k.s * .5;
    for (let j = -1; j <= 1; j++) { g.beginPath(); g.moveTo(k.x + j * 2, k.y); g.quadraticCurveTo(k.x + j * 3 + bend * .4, k.y - h * .6, k.x + j * 4 + bend, k.y - h + Math.abs(bend) * .3); g.stroke(); }
  }
}

function drawBoardwalk() {
  if (!sc.boardwalk) return;
  const { from, to, w } = sc.boardwalk, [ax, ay] = [X(from[0]), Y(from[1])], [bx, by] = [X(to[0]), Y(to[1])];
  const wa = W * w * .6, wb = W * w * 4.2, nx = -(by - ay), ny = bx - ax, l = Math.hypot(nx, ny), ux = nx / l, uy = ny / l;
  const deck = [[ax - ux * wa, ay - uy * wa], [ax + ux * wa, ay + uy * wa], [bx + ux * wb, by + uy * wb], [bx - ux * wb, by - uy * wb]];
  g.fillStyle = css(lit("#b98f5e")); g.beginPath(); deck.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.fill();
  g.strokeStyle = css(lit("#8a643c"), .55); g.lineWidth = 1;
  for (let i = 1; i < 40; i++) { const k = Math.pow(i / 40, 1.5), x = ax + (bx - ax) * k, y = ay + (by - ay) * k, ww = mix(wa, wb, k);
    g.beginPath(); g.moveTo(x - ux * ww, y - uy * ww); g.lineTo(x + ux * ww, y + uy * ww); g.stroke(); }
  // railings with posts
  for (const side of [-1, 1]) {
    g.strokeStyle = css(lit("#7d5a35")); g.lineWidth = 1.2;
    const pts = []; for (let i = 0; i <= 14; i++) { const k = Math.pow(i / 14, 1.5), ww = mix(wa, wb, k), x = ax + (bx - ax) * k + side * ux * ww, y = ay + (by - ay) * k + side * uy * ww, ph = 3 + k * 26;
      pts.push([x, y - ph]); g.lineWidth = .8 + k * 2.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - ph); g.stroke(); }
    g.lineWidth = 1.2; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.stroke();
  }
}

/* ---------- the palm ----------
   Stands straight in calm air. From 10 kn the leaves stir; 15–20 kn the trunk starts to lean;
   20–30 kn more lean and livelier leaves; 30–45 kn a hard lean with the leaves streaming like a
   flag; above 45 kn it bends right over and leaves tear off one by one, fly away downwind,
   and slowly grow back. */
const lerpKn = (kn, pts) => { if (kn <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) { const [a, va] = pts[i], [b, vb] = pts[i + 1]; if (kn <= b) return va + (vb - va) * (kn - a) / (b - a); }
  return pts[pts.length - 1][1]; };
const BEND = [[0, 0], [10, 0], [15, .06], [20, .16], [30, .38], [45, .7], [60, .85]];   // trunk lean, as a share of its height
const FLUT = [[0, 0], [6, .01], [10, .03], [15, .07], [20, .12], [30, .24], [45, .5], [60, .6]];  // how wildly the leaves move
const STREAM = [[0, 0], [12, .08], [15, .2], [20, .42], [30, .75], [40, .95], [60, 1]];               // how far the leaves swing downwind
const newPalm = k => ({ fronds: Array.from({ length: 14 }, (_, i) => ({ rest: -Math.PI / 2 + (i - 6.5) * .235 + (i % 2 ? .06 : -.04), len: .82 + ((i + k * 3) * 37 % 10) / 40,
  ph: i * 1.7 + k * 2.9, grow: 1, droop: .55 + ((i + k) * 13 % 7) / 20 })), flying: [], nextTear: k * 1.3, gustPh: 0, off: k * 3.7 });
const palmStates = [];
function drawPalm(t, dt) {   // every palm in the scene: sc.palm (one) or sc.palms [{at, size}]
  const list = sc.palms || (sc.palm ? [{ at: sc.palm, size: 1 }] : []);
  list.forEach((cfg, i) => drawOnePalm(t + (i ? 3.7 * i : 0), dt, cfg, palmStates[i] || (palmStates[i] = newPalm(i))));
}
function drawOnePalm(t, dt, cfg, palm) {
  const s = S, P = cfg.at;
  const bx = X(P[0]), by = Y(P[1]), Ht = H * .3 * cfg.size, leafL = Math.min(H * .12, W * .2) * cfg.size;
  const side = Math.abs(s.wx) < .05 ? 1 : Math.sign(s.wx);                 // which way downwind looks on screen
  const across = Math.max(.55, Math.abs(s.wx));                            // wind blowing away from us still bends it, foreshortened
  // gusts arrive as slow pulses on top of the mean wind
  const gusty = Math.max(0, s.gust - s.kn), pulse = .5 + .5 * Math.sin(t * .9) * Math.sin(t * .37 + 1);
  const kn = s.kn + gusty * pulse * .8;
  const lean = lerpKn(kn, BEND) * across, flut = lerpKn(kn, FLUT), stream = lerpKn(kn, STREAM);
  // trunk: a curve from the base up to the crown, leaning downwind, a little sway of its own
  const sway = flut * .04 * Math.sin(t * (1.1 + kn * .03));
  const tx = bx + side * (lean + sway) * Ht * 1.05, ty = by - Ht * (1 - lean * lean * .38);
  const cx = bx - side * lean * .06 * Ht + Ht * .03, cy = by - Ht * .62;          // stays upright low down, bows near the top
  const trunkC = lit("#8b7558"), ringC = lit("#6d5a43");
  g.save(); g.lineCap = "round";
  const seg = 22, wBase = Ht * .045, wTop = Ht * .028;
  const pt = u => [(1 - u) * (1 - u) * bx + 2 * (1 - u) * u * cx + u * u * tx, (1 - u) * (1 - u) * by + 2 * (1 - u) * u * cy + u * u * ty];
  for (let i = 0; i < seg; i++) {
    const a = pt(i / seg), b = pt((i + 1) / seg);
    g.strokeStyle = css(trunkC); g.lineWidth = mix(wBase, wTop, i / seg); g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
    g.strokeStyle = css(ringC, .55); g.lineWidth = 1; const w = mix(wBase, wTop, i / seg) * .5, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    g.beginPath(); g.moveTo(a[0] - dy / l * w, a[1] + dx / l * w); g.lineTo(a[0] + dy / l * w, a[1] - dx / l * w); g.stroke();
  }
  // tears at storm strength: a leaf at a time, now and then
  if (kn > 45 && dt > 0) {
    palm.nextTear -= dt;
    if (palm.nextTear <= 0) {
      const ready = palm.fronds.filter(f => f.grow >= .98);
      if (ready.length > 3) { const f = ready[(Math.random() * ready.length) | 0]; f.grow = 0;
        palm.flying.push({ x: tx, y: ty, a: f.ang ?? f.rest, len: leafL * f.len, vx: side * (120 + kn * 5) * across, vy: -40 - Math.random() * 60,
          spin: (Math.random() - .5) * 6, life: 0, shrink: Math.max(0, s.wz) }); }
      palm.nextTear = 1.6 + Math.random() * 2.4 - clamp((kn - 45) / 20) * 1.2;
    }
  }
  // leaves grow back slowly (about half a minute)
  for (const f of palm.fronds) if (f.grow < 1) f.grow = Math.min(1, f.grow + dt / 30);
  const leafC = lit("#4e6a37"), leafHi = lit("#728c47");
  const drawFrond = (x0, y0, ang, L, droop, ph, flt, alpha = 1) => {
    // the midrib: out along the angle, sagging under gravity unless the wind holds it out straight
    const hold = clamp(stream * 1.1), sag = droop * (1 - hold) * L * .55;
    const ex = x0 + Math.cos(ang) * L, ey = y0 + Math.sin(ang) * L + sag * .9;
    const mx = x0 + Math.cos(ang) * L * .55, my = y0 + Math.sin(ang) * L * .55 - sag * .15;
    g.strokeStyle = css(leafC, alpha); g.lineWidth = 2; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
    // leaflets on both sides; the wind combs them back along the rib and makes them shiver
    const n = 26;
    for (let k = 1; k <= n; k++) {
      const u = k / n, q = [(1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mx + u * u * ex, (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * my + u * u * ey];
      const d = [2 * (1 - u) * (mx - x0) + 2 * u * (ex - mx), 2 * (1 - u) * (my - y0) + 2 * u * (ey - my)], dl = Math.hypot(...d) || 1;
      const tx2 = d[0] / dl, ty2 = d[1] / dl, ll = L * .4 * Math.sin(Math.PI * Math.min(1, u * 1.05)) * (1 - u * .3) * (1 - hold * .25);
      const rip = flt * Math.sin(t * (4 + flt * 40) - u * 9 + ph) * (.5 + hold * .4);
      for (const sd of [-1, 1]) {
        const back = .6 + hold * .75 + rip * .35 * sd, nx = -ty2 * sd, ny = tx2 * sd;
        const lx = q[0] + (nx * Math.cos(back) - tx2 * Math.sin(back) * .9) * ll, ly = q[1] + (ny * Math.cos(back) - ty2 * Math.sin(back) * .9) * ll + ll * .35 * (1 - hold);
        g.strokeStyle = css(sd > 0 ? leafC : leafHi, alpha); g.lineWidth = 1.9; g.beginPath(); g.moveTo(...q); g.lineTo(lx, ly); g.stroke();
      }
    }
  };
  // crown: each leaf swings from its resting angle towards downwind, and flutters
  const down = side > 0 ? 0 : Math.PI;
  for (const f of palm.fronds) {
    if (f.grow <= .02) continue;
    const spread = mix(.35, .1, stream);                                              // the bundle tightens as the wind rises
    let target = down + side * .12 + (f.rest + Math.PI / 2) * spread;                 // swept downwind, drooping slightly
    let a0 = f.rest, d = ((target - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    // a slow swing in light air; in strong wind they're pinned and only shiver, harder in the gusts
    const swing = flut * (1 - stream * .85) * Math.sin(t * (1.4 + kn * .09) + f.ph) * (.6 + .4 * Math.sin(t * .7 + f.ph * 2));
    const shiver = stream * (.04 + gusty * pulse * .004) * Math.sin(t * (14 + kn * .3) + f.ph * 3);
    const ang = a0 + d * stream + swing + shiver;
    f.ang = ang;
    drawFrond(tx, ty, ang, leafL * f.len * (.15 + .85 * f.grow), f.droop, f.ph, flut, .4 + .6 * f.grow);
  }
  // the crown's heart and a few coconuts
  g.fillStyle = css(lit("#5b4a33")); for (const [dx, dy] of [[-3, 3], [3, 4], [0, 6]]) { g.beginPath(); g.arc(tx + dx, ty + dy, Ht * .012, 0, 7); g.fill(); }
  // leaves torn off, tumbling away downwind and getting smaller as they go
  for (const L of palm.flying) {
    L.life += dt; L.vy += 30 * dt; L.x += L.vx * dt; L.y += L.vy * dt + Math.sin(L.life * 4) * 20 * dt; L.a += L.spin * dt;
    const k = Math.max(.15, 1 - L.life * (.08 + L.shrink * .35));
    drawFrond(L.x, L.y, L.a, L.len * k, .3, L.life * 3, .6, Math.max(0, 1 - L.life / 6));
  }
  palm.flying = palm.flying.filter(L => L.life < 6 && L.x > -W * .3 && L.x < W * 1.3 && L.y < H * 1.2);
  g.restore();
}

function drawFlag(t) {
  if (!sc.flag) return;
  const s = S, [fx, fy] = [X(sc.flag[0]), Y(sc.flag[1])], ph = H * .07;
  g.strokeStyle = css(lit("#4b4038")); g.lineWidth = 1.6; g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx, fy - ph); g.stroke();
  const calm = s.kn < 4, len = H * .028 * (calm ? .6 : (.35 + .65 * Math.min(1, Math.abs(s.wx) + .15)) * Math.min(1.25, .85 + s.kn / 50));
  const dirx = calm ? 0 : (s.wx >= 0 ? 1 : -1), hh = H * .016, flap = calm ? 0 : Math.sin(t * (6 + s.kn * .25) + 1) * hh * .18;
  g.fillStyle = css(lit("#d9573a"));
  g.beginPath(); g.moveTo(fx, fy - ph);
  if (calm) { g.quadraticCurveTo(fx + 3, fy - ph + hh, fx + 1, fy - ph + hh * 1.6); g.lineTo(fx, fy - ph + hh * 1.2); }
  else { g.quadraticCurveTo(fx + dirx * len * .5, fy - ph + hh * .5 + flap, fx + dirx * len, fy - ph + hh * .5 + flap * 1.5);
    g.quadraticCurveTo(fx + dirx * len * .5, fy - ph + hh + flap, fx, fy - ph + hh); }
  g.closePath(); g.fill();
}

function drawWeather(t, dt) {
  const s = S;
  // sand blowing over the beach
  if (s.kn > 14) { const a = clamp((s.kn - 14) / 16) * .45, v = (s.wx || .2) * (60 + s.kn * 6);
    g.save(); g.clip(sc.sandPath); g.strokeStyle = css(lit("#d9c398"), a); g.lineWidth = 1;
    for (const d of drift) { d.x += v * dt / W; if (d.x > 1.1) d.x = -.1; if (d.x < -.1) d.x = 1.1;
      const y = mix(Y(.12), H, d.y), dd = depth(y), x = d.x * W; if (sc.scrub && x > X(.72) + (y - HZ) * .1) continue;
      const vz = s.wz * (4 + dd * 14) * (.5 + d.l);   // wind blowing away from us drags the streaks up the picture
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.sign(v) * (8 + dd * 30) * (.5 + d.l) * Math.max(.3, Math.abs(s.wx)), y + vz); g.stroke(); }
    g.restore(); }
  // rain, slanted by the wind
  if (s.rainmm >= .1) {
    const n = Math.min(rain.length, Math.round(30 + s.rainmm * 200)), slant = clamp(s.wx * s.kn / 22, -1.4, 1.4), fall = 1.2 + s.kn * .01;
    g.strokeStyle = css(mixc([214, 222, 230], [120, 130, 150], 1 - s.day), .35 + clamp(s.rainmm / 6) * .25); g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < n; i++) { const r = rain[i];
      r.y += fall * r.s * dt; r.x += slant * fall * r.s * dt * (H / W); if (r.y > 1) { r.y -= 1; r.x = Math.random() * 1.4 - .2; }
      if (r.x > 1.2) r.x -= 1.4; if (r.x < -.2) r.x += 1.4;
      const x = r.x * W, y = r.y * H, L = 10 + r.l * 16; g.moveTo(x, y); g.lineTo(x - slant * L, y - L); }
    g.stroke();
    g.fillStyle = css(mixc([150, 160, 170], [30, 36, 48], 1 - s.day), clamp(s.rainmm / 5) * .25); g.fillRect(0, 0, W, H);
  }
  // night: a blue hush over everything
  if (s.day < 1) { g.fillStyle = `rgba(12,20,44,${(1 - s.day) * .12})`; g.fillRect(0, 0, W, H); }
}

/* ---------- loop ---------- */
let last = 0, raf = 0, clockT = 0, sceneHidden = false;
function frame(now) {
  if (!open) return;
  const dt = Math.min(.1, (now - last) / 1000 || 0); last = now; clockT += dt;
  if (!sceneHidden) try { draw(clockT, dt); } catch (e) { console.warn("beach", e); }
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) raf = requestAnimationFrame(frame);
}
/* When the gull brings us down, the picture paints itself in, one part after another, each with a
   soft brushed edge: sky, clouds, sea, hills, sand, waves and dune, scrub, then the small things. */
const PAINT = [   // [start, end] within the reveal, and the direction the brush moves
  ["sky", 0, .3, "down"], ["clouds", .14, .44, "right"], ["sea", .2, .5, "right"], ["hills", .3, .6, "left"],
  ["land", .4, .7, "up"], ["waves", .52, .8, "right"], ["scrub", .58, .86, "up"], ["things", .74, .94, "up"], ["weather", .84, 1, "fade"],
];
const off = document.createElement("canvas"), oc = off.getContext("2d");
let reveal = 1;
const easeOut = x => 1 - Math.pow(1 - x, 3);
function paint(name, fn) {
  const [, a, b, dir] = PAINT.find(p => p[0] === name), pr = clamp((reveal - a) / (b - a));
  if (pr <= 0) return;
  if (pr >= 1) { fn(); return; }
  if (off.width !== cv.width || off.height !== cv.height) { off.width = cv.width; off.height = cv.height; }
  const e = easeOut(pr);
  oc.setTransform(1, 0, 0, 1, 0, 0); oc.clearRect(0, 0, off.width, off.height);
  g = oc; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.save(); g.translate(0, (1 - e) * (dir === "up" ? 14 : dir === "down" ? -10 : 0)); fn(); g.restore();
  // the brushed edge: a wide feather that sweeps across
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "destination-in";
  const w = off.width, h = off.height, F = .45, x = mix(-F, 1, e);
  let gr;
  if (dir === "right") gr = g.createLinearGradient(x * w, 0, (x + F) * w, 0);
  else if (dir === "left") gr = g.createLinearGradient((1 - x) * w, 0, (1 - x - F) * w, 0);
  else if (dir === "down") gr = g.createLinearGradient(0, x * h, 0, (x + F) * h);
  else if (dir === "up") gr = g.createLinearGradient(0, (1 - x) * h, 0, (1 - x - F) * h);
  if (gr) { gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  g.globalCompositeOperation = "source-over";
  g = main; g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = smooth(0, .6, pr); g.drawImage(off, 0, 0); g.globalAlpha = 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function drawDune() {   // the big pale dune at Punta Paloma, at the far end of the beach
  if (!sc.dune) return;
  g.fillStyle = css(mixc(lit("#f4ead2"), S.hor, .15)); g.fill(polyPath(sc.dune));
  const dz = sc.dune, mid = Math.floor(dz.length / 2);
  g.fillStyle = css(mixc(lit("#d8c49c"), S.hor, .2), .7); g.fill(polyPath([...dz.slice(mid), [dz[mid][0] - .02, .002]]));
}
function draw(t, dt) {
  S = state(curT);
  g = main; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (reveal < 1) { g.fillStyle = "#efe6d2"; g.fillRect(0, 0, W, H); }       // a blank sheet to paint on
  const L = sc.layers || {};   // a scene can replace any layer with its own
  paint("sky", () => drawSky(t)); paint("clouds", () => drawClouds(t, dt)); paint("sea", () => drawSea(t));
  paint("hills", () => (L.hills || drawHills)(t, dt)); paint("land", () => (L.land || drawLand)(t, dt));
  paint("waves", () => (L.waves || (() => { drawWaves(t); drawDune(); }))(t, dt));
  paint("scrub", () => (L.scrub || drawScrub)(t, dt)); paint("things", () => (L.things || (() => { drawBoardwalk(); drawFlag(t); drawPalm(t, dt); }))(t, dt));
  paint("weather", () => drawWeather(t, dt));
}

/* ---------- forecast readout and the 24-hour table ---------- */
const arrow = deg => `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1v12M3 9l4 4 4-4" stroke="currentColor" stroke-width="1.8" fill="none" transform="rotate(${deg} 7 7)"/></svg>`;
const cardinal = d => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
const WINDNAME = d => d == null ? "" : (d >= 50 && d <= 130 ? " · levante" : d >= 230 && d <= 310 ? " · poniente" : "");
let lastHourShown = -1;
function fillHud() {
  const s = S || state(curT), h = Math.round(curT), d = Math.floor(h / 24), hh = String(hourOf(h)).padStart(2, "0");
  document.getElementById("bh-name").textContent = sc.name;
  const sky = s.sun.el < -3 ? "night" : s.rainmm >= .3 ? "rain" : s.cloud > .65 ? "cloudy" : s.cloud > .3 ? "some cloud" : "clear";
  document.getElementById("bh-now").innerHTML =
    `<span>${dayName(d)} · ${hh}:00${s.ec ? ' <b class="ectag">ECMWF</b>' : ""}</span>` +
    `<span class="bk">${Math.round(s.kn)} <small>kn</small>${s.dir != null ? arrow(s.dir) : ""}<small>${s.dir != null ? cardinal(s.dir) : ""}${WINDNAME(s.dir)} · gusts ${Math.round(s.gust)}</small></span>` +
    `<span>${s.temp != null ? Math.round(s.temp) + "°" : ""} · ${sky}${s.rainmm >= .1 ? ` ${s.rainmm.toFixed(1)} mm` : ""}</span>` +
    (s.wh != null ? `<span>${s.wh.toFixed(1)} m · ${Math.round(s.wp)} s</span>` : "");
}
function fillPanel() {
  const o = FC && FC.spots[selected.id]; if (!o) { panel.innerHTML = ""; return; }
  const cur = Math.round(curT), days = Math.ceil(N / 24);
  const gx = Math.max(30, ...o.gust.filter(v => v != null));
  let html = '<div class="bf-scroll"><div class="bf-grid"><div class="bf-row bf-hd"><span></span>' +
    Array.from({ length: 24 }, (_, h) => `<span class="${h === cur % 24 ? "cur" : ""}">${String(h).padStart(2, "0")}</span>`).join("") + "</div>";
  for (let d = 0; d < days; d++) {
    const cells = Array.from({ length: 24 }, (_, h) => {
      const T = d * 24 + h; if (T >= N || o.kn[T] == null) return '<span class="na">·</span>';
      const kn = Math.round(o.kn[T]), gu = Math.round(Math.max(o.gust[T] ?? kn, kn)), ec = FC.model[T] === "ecmwf", wh = o.wh[T];
      return `<button type="button" data-t="${T}" class="${T === cur ? "cur" : ""}${ec ? " ec" : ""}" aria-label="${dayName(d)} ${h}:00, ${kn} knots">` +
        `<i class="g">${gu}</i><b>${kn}</b><em style="height:${Math.round(2 + kn / gx * 11)}px;background:${barCol(gu)}"></em>` +
        `${o.dir[T] != null ? arrow(o.dir[T]) : ""}<i class="w">${wh != null ? wh.toFixed(1) : ""}</i></button>`;
    }).join("");
    html += `<div class="bf-row${d === Math.floor(cur / 24) ? " now" : ""}" data-d="${d}"><span class="bf-day">${dayName(d)}</span>${cells}</div>`;
  }
  panel.innerHTML = html + '</div></div><p class="bf-key">knots · gusts above · waves in metres below</p>';
}
panel.addEventListener("click", e => { const b = e.target.closest("button[data-t]"); if (b) { setPlaying(false); setTime(+b.dataset.t); } });
function scrollToDay() { const r = panel.querySelector(".bf-row.now"), sc2 = panel.querySelector(".bf-scroll"); if (r && sc2) sc2.scrollTop = r.offsetTop - sc2.querySelector(".bf-hd").offsetHeight - 2;
  const c = panel.querySelector("button.cur"); if (c && sc2) sc2.scrollLeft = Math.max(0, c.offsetLeft - sc2.clientWidth / 2); }

window.beachTime = () => {   // called by the page whenever the time moves
  if (!open) return;
  S = state(curT); fillHud();
  const h = Math.round(curT);
  if (h !== lastHourShown) { const day = Math.floor(h / 24) !== Math.floor(lastHourShown / 24); lastHourShown = h; fillPanel(); if (day) scrollToDay(); }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) draw(clockT, 0);
};

/* ---------- in and out ---------- */
// Going down: a gull glides in from the side of the screen and the camera follows it down; the
// map zooms in behind it, softens into blur and fades to a blank sheet; the beach then paints
// itself in while the gull glides on and out of the other side. Coming back runs it in reverse.
let camBefore = null, camTarget = null, busy = false, anim = 0;
window.beachHas = has;
window.beachOpen = () => open;
const LAYERS = ["map", "detail", "heat", "wind"].map(id => document.getElementById(id));
const sky = document.createElement("canvas");
sky.id = "gull"; sky.setAttribute("aria-hidden", "true"); document.getElementById("grain").before(sky);
const gc = sky.getContext("2d");
const ease3 = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const easeIO = k => .5 - .5 * Math.cos(Math.PI * clamp(k));                      // gentle sine in-out
const setWill = on => [...LAYERS, wrap].forEach(el => el.style.willChange = on ? "filter, opacity, transform" : "");

// the map side of things, m: 0 = spot view, 1 = gone
function mapPose(m) {
  const z = easeIO(m);
  cam.x = mix(camBefore.x, camTarget.x, z); cam.y = mix(camBefore.y, camTarget.y, z);
  cam.z = Math.exp(mix(Math.log(camBefore.z), Math.log(camTarget.z), z)); applyCam();
  const blur = easeIO(clamp((m - .2) / .55)), fade = easeIO(clamp((m - .55) / .45));
  for (const el of LAYERS) {
    el.style.filter = blur > 0 ? `blur(${(blur * 14).toFixed(1)}px)` : "";
    el.style.transform = blur > 0 ? `scale(${(1 + blur * .05).toFixed(3)})` : "";
    el.style.opacity = fade > 0 ? (1 - fade).toFixed(3) : "";
  }
  wrap.style.opacity = fade.toFixed(3);
  window.beachFull = m > .35;           // the map is blurred past seeing: stop animating its wind
}

/* The gull, after a photo of a herring gull in flight, kept flat and simple like the rest:
   white head and body, pale grey wings with black tips, yellow bill and legs tucked back.
   x/y in px, s = size, dir = 1 flying right / -1 left, lift = wing position (-1 down … 1 up). */
function wing(c, sh, wr, tp, chord, fill, dark) {
  // leading edge shoulder → wrist → tip, trailing edge back along a broader inner wing
  const px = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
  let n1 = px(sh, wr), n2 = px(wr, tp); if (n1[1] < 0) n1 = n1.map(v => -v); if (n2[1] < 0) n2 = n2.map(v => -v);   // chord hangs below the leading edge
  const shB = [sh[0] + n1[0] * chord, sh[1] + n1[1] * chord], wrB = [wr[0] + n2[0] * chord * .95, wr[1] + n2[1] * chord * .95];
  const tipB = [tp[0] + n2[0] * chord * .12, tp[1] + n2[1] * chord * .12];
  c.fillStyle = fill; c.beginPath(); c.moveTo(...sh);
  c.quadraticCurveTo((sh[0] + wr[0]) / 2 - n1[0] * chord * .25, (sh[1] + wr[1]) / 2 - n1[1] * chord * .25, ...wr);
  c.quadraticCurveTo((wr[0] + tp[0]) / 2 - n2[0] * chord * .15, (wr[1] + tp[1]) / 2 - n2[1] * chord * .15, ...tp);
  c.quadraticCurveTo((wrB[0] + tipB[0]) / 2, (wrB[1] + tipB[1]) / 2, ...wrB);
  c.quadraticCurveTo((wrB[0] + shB[0]) / 2 + n1[0] * chord * .15, (wrB[1] + shB[1]) / 2 + n1[1] * chord * .15, ...shB); c.closePath(); c.fill();
  // white trailing edge
  c.strokeStyle = "rgba(255,255,255,.9)"; c.lineWidth = chord * .16;
  c.beginPath(); c.moveTo(...mixp(wrB, tipB, .55)); c.quadraticCurveTo(...wrB, ...mixp(wrB, shB, .7)); c.stroke();
  // black wingtip with a white mirror spot
  const k = .62, a1 = mixp(wr, tp, k), b1 = mixp(wrB, tipB, k * .92);
  c.fillStyle = dark; c.beginPath(); c.moveTo(...tp); c.lineTo(...a1); c.lineTo(...b1); c.quadraticCurveTo(...mixp(b1, tipB, .5), ...tp); c.fill();
  c.fillStyle = "#f6f4ee"; const m = mixp(mixp(a1, b1, .5), tp, .45); c.beginPath(); c.arc(m[0], m[1], chord * .1, 0, 7); c.fill();
}
const mixp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
function drawGull(x, y, s, dir, lift, tilt) {
  const c = gc; c.save(); c.translate(x, y); c.rotate(tilt); c.scale(dir * s, s);
  const L = lift; c.lineJoin = "round"; c.lineCap = "round";
  // far wing: reaches forward and up, foreshortened, in shade
  wing(c, [.05, -.03], [.13, -.17 * L - .07], [.27, -.3 * L - .15], .06, "#b3babf", "#2a2d30");
  // tail: short and white, a little fanned
  c.fillStyle = "#f2f0ea"; c.beginPath(); c.moveTo(-.09, -.016); c.lineTo(-.2, -.03); c.quadraticCurveTo(-.215, -.005, -.205, .018); c.lineTo(-.09, .03); c.fill();
  // legs tucked back under the tail
  c.strokeStyle = "#dda43a"; c.lineWidth = .008;
  c.beginPath(); c.moveTo(-.04, .036); c.lineTo(-.125, .058); c.moveTo(-.025, .042); c.lineTo(-.11, .068); c.stroke();
  // body and head
  c.fillStyle = "#fbfaf6"; c.beginPath(); c.ellipse(.0, .008, .12, .046, -.05, 0, 7); c.fill();
  c.beginPath(); c.arc(.125, -.004, .044, 0, 7); c.fill();
  c.fillStyle = "#e6e2d8"; c.beginPath(); c.ellipse(-.015, .032, .095, .017, -.05, 0, 7); c.fill();
  c.fillStyle = "#efb83a"; c.beginPath(); c.moveTo(.16, -.01); c.lineTo(.212, .004); c.quadraticCurveTo(.2, .014, .162, .012); c.fill();
  c.fillStyle = "#c8503a"; c.beginPath(); c.arc(.2, .009, .0045, 0, 7); c.fill();
  c.fillStyle = "#1d2124"; c.beginPath(); c.arc(.137, -.013, .0075, 0, 7); c.fill();
  // near wing: long, sweeping up and back, pale grey
  wing(c, [.03, -.02], [-.11, -.17 * L - .07], [-.45, -.29 * L - .14], .09, "#c8cdd1", "#222528");
  c.restore();
}
// where the gull is: u runs 0 → 1 across one pass (in from one side, hover in the middle, out the other)
function gull(u, dir, now) {
  const w = innerWidth, h = innerHeight, r = Math.min(2, devicePixelRatio || 1);
  if (sky.width !== w * r || sky.height !== h * r) { sky.width = w * r; sky.height = h * r; }
  gc.setTransform(r, 0, 0, r, 0, 0); gc.clearRect(0, 0, w, h);
  if (u <= 0 || u >= 1) return;
  const size = Math.min(w, h) * (w < 700 ? .62 : .42), side = x => dir > 0 ? x : w - x;
  let x, y, s, tilt;
  if (u < .36) {          // glides in level from the side of the screen
    const t = easeIO(u / .36);
    x = side(mix(-size * .6, w * .5, t)); y = mix(h * .36, h * .42, t); s = mix(.9, 1, t); tilt = dir * mix(.06, .0, t);
  } else if (u < .64) {   // carries us: hangs in the air, rising and falling a little
    const t = (u - .36) / .28;
    x = side(w * .5 + Math.sin(t * Math.PI) * w * .03); y = h * .42 + Math.sin(t * Math.PI * 2) * h * .012; s = 1 + t * .05; tilt = Math.sin(t * 6) * .02;
  } else {                // and glides on out of the other side, climbing a little
    const t = easeIO((u - .64) / .36);
    x = side(mix(w * .5 + w * .03 * 0, w + size * .6, t)); y = mix(h * .42, h * .3, t); s = mix(1.05, 1.1, t); tilt = dir * mix(0, -.08, t);
  }
  // slow wingbeats with long glides in between
  const beat = (now / 1000) % 3.2, flap = beat < 1.1 ? Math.sin(beat / 1.1 * Math.PI * 2) : 0;
  const lift = .35 + flap * .6 + Math.sin(now / 1700) * .05;     // mostly a shallow glide
  drawGull(x, y, size * s, dir, lift, tilt);
}

// one clock for the whole thing; t in seconds
const OPEN = { len: 9.6,
  gull: t => clamp(t / 8.6),                 // in 0–3.1 s, carrying 3.1–5.5 s, out 5.5–8.6 s
  map: t => clamp((t - .8) / 4.2),           // zoom, blur and fade 0.8–5.0 s
  paint: t => clamp((t - 4.4) / 4.6),        // the beach paints in 4.4–9.0 s
  ui: 8.4 };
const CLOSE = { len: 8.2,
  paint: () => 1,                            // the picture stays whole and simply crossfades into the map
  gull: t => clamp((t - .4) / 7.4),          // in from the other side and away again
  map: t => 1 - clamp((t - .8) / 6.4) };     // the map comes back through the blur and zooms out .8–7.2 s
function run(plan, dir, done) {
  cancelAnimationFrame(anim); setWill(true);
  const t0 = performance.now();
  const step = now => {
    const t = (now - t0) / 1000;
    mapPose(plan.map(t)); reveal = easeIO(plan.paint(t)); sceneHidden = wrap.style.opacity === "0";
    gull(plan.gull(t), dir, now);
    if (plan.ui) document.body.classList.toggle("beach-on", t > plan.ui);
    if (t < plan.len) anim = requestAnimationFrame(step); else { setWill(false); gull(0, dir, now); done(); }
  };
  anim = requestAnimationFrame(step);
}
window.openBeach = () => {
  if (busy || open || !selected || !has(selected.id)) return;
  busy = true; sc = SCENES[selected.id];
  try { resize(); build(); } catch (e) { console.warn("beach", e); busy = false; return; }
  open = true; lastHourShown = -1; last = performance.now(); reveal = 0;
  S = state(curT); fillHud(); fillPanel();
  const [bx, by] = P(selected.lon, selected.lat);
  camBefore = { ...cam }; camTarget = { x: bx, y: by, z: cam.z * 7 };
  document.body.classList.add("beach"); wrap.classList.add("on");
  hud.setAttribute("aria-hidden", "false");
  raf = requestAnimationFrame(frame);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { mapPose(1); reveal = 1; draw(0, 0); document.body.classList.add("beach-on"); busy = false; return; }
  run(OPEN, 1, () => { busy = false; scrollToDay(); document.getElementById("back").setAttribute("aria-label", "Back to the spot"); });
};
window.closeBeach = () => {
  if (busy || !open) return; busy = true;
  hud.setAttribute("aria-hidden", "true"); document.body.classList.remove("beach-on");
  const finish = () => { mapPose(0); for (const el of LAYERS) { el.style.filter = el.style.transform = el.style.opacity = ""; }
    document.body.classList.remove("beach"); wrap.classList.remove("on"); open = false; cancelAnimationFrame(raf); busy = false; reveal = 1; window.beachFull = false;
    document.getElementById("back").setAttribute("aria-label", "Back to the whole coast");
    document.getElementById("i-beach")?.focus({ preventScroll: true }); };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
  run(CLOSE, -1, finish);
};
resize();
})();
