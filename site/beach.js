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
    lights: [[.83, -.12], [.87, -.135], [.91, -.11], [.76, -.07], [.95, -.14], [.715, -.035]],
  },
};
const has = id => !!SCENES[id];

/* ---------- canvas & layout ---------- */
const wrap = document.createElement("div");
wrap.id = "beach"; wrap.setAttribute("aria-hidden", "true");
wrap.innerHTML = '<canvas id="beach-cv"></canvas>';
document.getElementById("grain").before(wrap);
const cv = wrap.firstChild, g = cv.getContext("2d");
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
  HZ = H * (W / H < .8 ? .3 : .4);
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
  scrubP = curve(sc.scrub, 10);
  // seaward normals along the shore, for the lines of breaking waves
  const ref = [X(.25), Y(.06)];
  shoreP.forEach((p, i) => {
    const a = shoreP[Math.max(0, i - 1)], b = shoreP[Math.min(shoreP.length - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if (nx * (ref[0] - p[0]) + ny * (ref[1] - p[1]) < 0) { nx = -nx; ny = -ny; }
    p.n = [nx, ny];
  });
  const scrub = new Path2D(); scrub.moveTo(...scrubP[0]); scrubP.forEach(p => scrub.lineTo(...p));
  scrub.lineTo(X(.68), H + 2); scrub.lineTo(W + 2, H + 2); scrub.lineTo(W + 2, Y(-.06)); scrub.closePath();
  sc.scrubPath = scrub;
  const sea = new Path2D(); sea.moveTo(-2, HZ); sea.lineTo(shoreP[0][0], HZ); shoreP.forEach(p => sea.lineTo(...p));
  sea.lineTo(-2, shoreP[shoreP.length - 1][1]); sea.closePath(); sc.seaPath = sea;
  tufts = []; bushes = [];
  for (let i = 0; i < 2600 && tufts.length < 190; i++) {
    const x = X(.45 + rand() * .6), y = Y(-.02 + rand() * (1 - HZ / H + .05));
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (g.isPointInPath(scrub, x, y)) {
      (rand() < .22 ? bushes : tufts).push({ x, y, s: .4 + depth(y) * 1.6, ph: rand() * 6.28, f: .8 + rand() * .8, c: rand() });
    }
  }
  tufts.sort((a, b) => a.y - b.y); bushes.sort((a, b) => a.y - b.y);
  // pine wood on the lower slopes to the right (in the photo: dark crowns above the scrub)
  sc.pines = Array.from({ length: 70 }, () => { const x = .74 + rand() * .3, top = -.012 - (x - .7) * .19;
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
  for (const p of sc.pines) { const x = X(p.x), y = Y(p.y), r = (2.2 + depth(y) * 30) * p.r;
    g.fillStyle = css(lit("#33502f")); g.beginPath(); g.ellipse(x, y, r * 1.5, r, 0, 0, 7); g.fill();
    g.fillStyle = css(lit("#4c6a3d"), .7); g.beginPath(); g.ellipse(x - r * .3, y - r * .3, r * .8, r * .45, 0, 0, 7); g.fill(); }
  // little lights at night in the houses on the hill
  const night = 1 - smooth(-6, 1, s.sun.el);
  if (night > 0) sc.lights.forEach(([x, y], i) => { const a = night * (.6 + .4 * Math.sin(t * .7 + i * 2.1));
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
    g.strokeStyle = css(lit("#6fc0b0"), a * (1 - s.grey * .4)); g.lineWidth = H * w; g.stroke(shore);
  }
  // sun or moon glitter on the water
  const glit = (b, alpha) => { if (b.el < -1) return; const [sx] = screenOf(b.az, b.el); if (sx < -W * .2 || sx > W * 1.2) return;
    for (let i = 0; i < 160; i++) { const v = (i / 160), y = HZ + 2 + v * v * (H - HZ) * .6, spread = 4 + v * W * .09 * (1 + b.el / 30);
      const x = sx + Math.sin(i * 12.9898 + Math.floor(t * 2.2 + i) * 4.1) * spread, a = alpha * (1 - v) * (.4 + .6 * Math.abs(Math.sin(t * 3 + i * 1.7)));
      g.fillStyle = `rgba(255,248,226,${a})`; g.fillRect(x, y, 2 + v * 14, 1 + v * 1.5); } };
  glit(S.sun, .75 * (1 - s.grey * .9) * smooth(-1, 6, s.sun.el));
  glit(S.moon, .45 * (1 - s.cloud * .8) * (1 - s.day) * (1 - Math.abs(Math.cos(s.ph * 2 * Math.PI))));
  // ripples and, with wind, whitecaps
  const caps = clamp((s.kn - 11) / 22), seaH = H - HZ;
  for (const r of ripples) {
    const y = HZ + 3 + r.v * seaH * .62, d = depth(y), x = r.u * W + Math.sin(t * .5 + r.ph) * 6 * d + (t * s.wx * (2 + s.kn * .3) * d) % W;
    const xx = ((x % W) + W) % W, w = 3 + d * 26;
    if (r.cap < caps * .55 && Math.sin(t * (1.2 + s.kn * .04) + r.ph) > .6) { g.fillStyle = `rgba(250,248,240,${.55 * (1 - s.grey * .3) * mix(.2, 1, s.day)})`; g.fillRect(xx, y, w * .8, 1 + d * 2.5); }
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
  // spray blown off the crests in strong wind
  if (s.kn > 18) { const n = Math.round((s.kn - 18) * 3);
    for (let i = 0; i < n; i++) { const q = shoreP[(i * 7 + Math.floor(t * 3)) % shoreP.length], d = depth(q[1]) + .1, k = (t * 1.7 + i * .37) % 1;
      g.fillStyle = `rgba(251,249,240,${(1 - k) * .45 * foam})`;
      g.fillRect(q[0] + q.n[0] * reach * .5 * d + s.wx * k * 40 * d, q[1] + q.n[1] * reach * .5 * d - k * 10 * d, 2 * d + 1, 1); } }
  g.restore();
}

function drawScrub(t) {
  const s = S;
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

function drawFlag(t) {
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
  if (s.kn > 14) { const a = clamp((s.kn - 14) / 16) * .75, v = (s.wx || .2) * (60 + s.kn * 6);
    g.strokeStyle = `rgba(245,232,200,${a})`; g.lineWidth = 1;
    for (const d of drift) { d.x += v * dt / W; if (d.x > 1.1) d.x = -.1; if (d.x < -.1) d.x = 1.1;
      const y = mix(Y(.12), H, d.y), dd = depth(y), x = d.x * W; if (x > X(.72) + (y - HZ) * .1) continue;
      const vz = s.wz * (4 + dd * 14) * (.5 + d.l);   // wind blowing away from us drags the streaks up the picture
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.sign(v) * (8 + dd * 30) * (.5 + d.l) * Math.max(.3, Math.abs(s.wx)), y + vz); g.stroke(); } }
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
let last = 0, raf = 0, clockT = 0;
function frame(now) {
  if (!open) return;
  const dt = Math.min(.1, (now - last) / 1000 || 0); last = now; clockT += dt;
  try { draw(clockT, dt); } catch (e) { console.warn("beach", e); }
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) raf = requestAnimationFrame(frame);
}
function draw(t, dt) {
  S = state(curT);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSky(t); drawClouds(t, dt); drawSea(t); drawHills(t); drawLand(t); drawWaves(t); drawScrub(t);
  // the big pale dune at Punta Paloma, at the far end of the beach
  g.fillStyle = css(mixc(lit("#f4ead2"), S.hor, .15)); g.fill(polyPath(sc.dune));
  const dz = sc.dune, mid = Math.floor(dz.length / 2);
  g.fillStyle = css(mixc(lit("#d8c49c"), S.hor, .2), .7); g.fill(polyPath([...dz.slice(mid), [dz[mid][0] - .02, .002]]));
  drawBoardwalk(); drawFlag(t); drawWeather(t, dt);
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
        `<i class="g">${gu}</i><b>${kn}</b><em style="height:${Math.round(2 + kn / gx * 11)}px;background:${barCol(kn)}"></em>` +
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
// One motion, played forwards to go in and backwards to come out: the map zooms down onto the
// beach and tips away (the camera pitching up to the horizon), then the beach rises into view.
let camBefore = null, camTarget = null, busy = false;
window.beachHas = has;
window.beachOpen = () => open;
const LAYERS = ["map", "detail", "heat", "wind"].map(id => document.getElementById(id));
function pose(k) {
  const z = ease3(clamp(k / .8)), tilt = smooth(.18, .82, k), blur = smooth(.55, .95, k), rise = smooth(.5, .95, k);
  cam.x = mix(camBefore.x, camTarget.x, z); cam.y = mix(camBefore.y, camTarget.y, z);
  cam.z = Math.exp(mix(Math.log(camBefore.z), Math.log(camTarget.z), z)); applyCam();
  for (const el of LAYERS) {
    el.style.transformOrigin = "50% 58%";
    el.style.transform = k > 0 ? `perspective(760px) rotateX(${(tilt * 70).toFixed(2)}deg) scale(${(1 + tilt * .35).toFixed(3)})` : "";
    el.style.filter = blur > 0 ? `blur(${(blur * 9).toFixed(1)}px)` : "";
    el.style.opacity = k > 0 ? (1 - smooth(.75, 1, k) * .9).toFixed(3) : "";
  }
  wrap.style.opacity = rise.toFixed(3);
  wrap.style.transform = rise < 1 ? `perspective(900px) translateY(${((1 - rise) * 26).toFixed(2)}%) rotateX(${((1 - rise) * -22).toFixed(2)}deg) scale(${(1 + (1 - rise) * .18).toFixed(3)})` : "";
  wrap.style.filter = rise < 1 ? `blur(${((1 - rise) * 10).toFixed(1)}px)` : "";
}
const ease3 = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
window.openBeach = () => {
  if (busy || open || !selected || !has(selected.id)) return;
  busy = true; sc = SCENES[selected.id]; resize(); build();
  open = true; lastHourShown = -1; last = performance.now();
  S = state(curT); fillHud(); fillPanel(); draw(0, 0);
  const [bx, by] = P(selected.lon, selected.lat);
  camBefore = { ...cam }; camTarget = { x: bx, y: by, z: cam.z * 7 };
  document.body.classList.add("beach"); wrap.classList.add("on");
  hud.setAttribute("aria-hidden", "false");
  raf = requestAnimationFrame(frame);
  tween(2100, (e, k) => pose(k), () => { busy = false; window.beachFull = true; scrollToDay();
    document.getElementById("back").setAttribute("aria-label", "Back to the spot"); });
};
window.closeBeach = () => {
  if (busy || !open) return; busy = true; window.beachFull = false;
  document.body.classList.remove("beach"); hud.setAttribute("aria-hidden", "true");
  tween(1500, (e, k) => pose(1 - k), () => { pose(0); wrap.classList.remove("on"); open = false; cancelAnimationFrame(raf); busy = false;
    document.getElementById("back").setAttribute("aria-label", "Back to the whole coast");
    document.getElementById("i-beach")?.focus({ preventScroll: true }); });
};
resize();
})();
