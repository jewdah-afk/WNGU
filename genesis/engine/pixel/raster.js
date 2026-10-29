// Genome rasterizer: compact part lists -> isometric pixel-art sprites.
//
// Each output pixel casts one orthographic ray along the 2:1 isometric view
// direction (1,1,1) against analytic primitives (box, cylinder, gear, sphere).
// The hit gives exact depth, normal, part and material, so shading, cast
// shadows, outlines and animation all come from geometry instead of painting.
// Colour is then quantised onto hand-tunable hue-shifted material ramps.
//
// Projection (tile units): sx = (x - y) * 16, sy = (x + y) * 8 - z * 16.

export const TILE_W = 32, TILE_H = 16, Z_PX = 16;

// ---------- palette ----------
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const f = n => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
const hueToward = (h, target, amt) => { let d = ((target - h + 540) % 360) - 180; return h + d * amt; };

// 6-step ramp: shadows drift cool (toward 240), highlights drift warm (toward 55)
export function makeRamp({ h, s, l = 1, glow = false }) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const hh = t < 0.5 ? hueToward(h, 245, 0.28 * (1 - t * 2)) : hueToward(h, 55, 0.22 * (t * 2 - 1));
    const ll = glow ? 0.35 + 0.6 * t : (0.09 + 0.78 * Math.pow(t, 0.95)) * l + (1 - l) * 0.04;
    const ss = Math.min(1, s * (0.7 + 0.45 * Math.sin(Math.PI * t)));
    out.push(hsl(hh, ss, Math.min(0.96, ll)));
  }
  return out;
}

export const MATERIALS = {
  steel:     { h: 212, s: 0.13, metal: true },
  dark:      { h: 225, s: 0.12, l: 0.62, metal: true },
  copper:    { h: 22,  s: 0.62, metal: true },
  brass:     { h: 44,  s: 0.58, metal: true },
  brick:     { h: 10,  s: 0.42 },
  stone:     { h: 36,  s: 0.14 },
  hazard:    { h: 46,  s: 0.92 },
  glass:     { h: 192, s: 0.45, metal: true },
  blue:      { h: 206, s: 0.52 },
  orange:    { h: 26,  s: 0.78 },
  green:     { h: 140, s: 0.45 },
  wood:      { h: 28,  s: 0.38, l: 0.85 },
  rubber:    { h: 228, s: 0.1, l: 0.55 },
  grass:     { h: 96,  s: 0.42, l: 0.92 },
  grass2:    { h: 82,  s: 0.45, l: 0.95 },
  sand:      { h: 40,  s: 0.42 },
  rock:      { h: 28,  s: 0.11, l: 0.9 },
  water:     { h: 199, s: 0.58, l: 0.85 },
  ore_iron:  { h: 212, s: 0.22 },
  ore_copper:{ h: 18,  s: 0.65 },
  ore_coal:  { h: 235, s: 0.08, l: 0.5 },
  ore_stone: { h: 34,  s: 0.2 },
  red:       { h: 356, s: 0.68 },
  fire:      { h: 24,  s: 0.95, glow: true },
  lamp:      { h: 128, s: 0.8,  glow: true },
  energy:    { h: 186, s: 0.9,  glow: true },
  sci_red:   { h: 356, s: 0.85, glow: true },
  sci_green: { h: 130, s: 0.8,  glow: true },
};
const RAMPS = {};
for (const k of Object.keys(MATERIALS)) RAMPS[k] = makeRamp(MATERIALS[k]);
export { RAMPS };

// ---------- geometry ----------
const LIGHT = (() => { const v = [-0.32, 0.52, 0.8]; const n = Math.hypot(...v); return v.map(x => x / n); })();
const VIEW = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
const AX = { x: 0, y: 1, z: 2 };

// rotate a genome authored facing +x by dir*90 degrees around the footprint centre
function rotPt(p, dir, s) {
  let [x, y, z] = p;
  for (let i = 0; i < dir; i++) [x, y] = [s - y, x];
  return [x, y, z];
}
function rotVec(v, dir) {
  let [x, y, z] = v;
  for (let i = 0; i < dir; i++) [x, y] = [-y, x];
  return [x, y, z];
}
function rotAxis(a, dir) { return a === "z" ? "z" : (dir % 2 ? (a === "x" ? "y" : "x") : a); }

// Resolve a part for a given facing and animation phase into a flat primitive.
function resolve(part, dir, size, phase) {
  const wave = part.wave === "saw" ? phase : Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;
  const mv = part.move ? rotVec(part.move.map(v => v * wave), dir) : [0, 0, 0];
  const p = { mat: part.mat, pat: part.pat, part, spin: (part.spin || 0) * phase * Math.PI * 2 };
  if (part.box) {
    const b = part.box;
    const a = rotPt([b[0], b[1], b[2]], dir, size), c = rotPt([b[3], b[4], b[5]], dir, size);
    p.kind = 0;
    p.min = [Math.min(a[0], c[0]) + mv[0], Math.min(a[1], c[1]) + mv[1], Math.min(a[2], c[2]) + mv[2]];
    p.max = [Math.max(a[0], c[0]) + mv[0], Math.max(a[1], c[1]) + mv[1], Math.max(a[2], c[2]) + mv[2]];
  } else if (part.cyl || part.gear) {
    p.kind = part.gear ? 2 : 1;
    p.axis = AX[rotAxis(part.cyl || part.gear, dir)];
    const c = rotPt(part.c, dir, size);
    p.c = [c[0] + mv[0], c[1] + mv[1], c[2] + mv[2]];
    p.r = part.r; p.h = part.h; p.teeth = part.teeth || 0; p.rin = part.rin || part.r * 0.78;
  } else if (part.sphere) {
    p.kind = 3;
    const c = rotPt(part.c, dir, size);
    p.c = [c[0] + mv[0], c[1] + mv[1], c[2] + mv[2]];
    p.r = part.r;
  }
  return p;
}

// ray o + t*d, returns {t, n, l (local point)} or null
function hitBox(p, o, d) {
  let tmin = -1e9, tmax = 1e9, nAxis = -1, nSign = 0;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < p.min[a] || o[a] > p.max[a]) return null; continue; }
    let t1 = (p.min[a] - o[a]) / d[a], t2 = (p.max[a] - o[a]) / d[a], s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 1e-6) return null;
  const t = tmin > 1e-6 ? tmin : tmax;
  const n = [0, 0, 0]; n[nAxis] = nSign;
  return { t, n };
}

function hitCylRaw(c, axis, r, h, o, d) {
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const ou = o[u] - c[u], ov = o[v] - c[v], du = d[u], dv = d[v];
  let best = null;
  const A = du * du + dv * dv;
  if (A > 1e-12) {
    const B = 2 * (ou * du + ov * dv), Cc = ou * ou + ov * ov - r * r, D = B * B - 4 * A * Cc;
    if (D >= 0) {
      const sq = Math.sqrt(D);
      for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
        if (t <= 1e-6) continue;
        const w = o[axis] + d[axis] * t - c[axis];
        if (Math.abs(w) <= h) { const n = [0, 0, 0]; n[u] = (ou + du * t) / r; n[v] = (ov + dv * t) / r; best = { t, n }; break; }
      }
    }
  }
  if (Math.abs(d[axis]) > 1e-12) {
    for (const s of [-1, 1]) {
      const t = (c[axis] + s * h - o[axis]) / d[axis];
      if (t <= 1e-6 || (best && t >= best.t)) continue;
      const pu = ou + du * t, pv = ov + dv * t;
      if (pu * pu + pv * pv <= r * r) { const n = [0, 0, 0]; n[axis] = s; best = { t, n }; }
    }
  }
  return best;
}

function angleAt(p, x) {
  const u = (p.axis + 1) % 3, v = (p.axis + 2) % 3;
  return Math.atan2(x[v] - p.c[v], x[u] - p.c[u]);
}

function hitPrim(p, o, d) {
  if (p.kind === 0) return hitBox(p, o, d);
  if (p.kind === 1) return hitCylRaw(p.c, p.axis, p.r, p.h, o, d);
  if (p.kind === 2) {
    // gear = solid inner disc + toothed outer ring (angular mask)
    const inner = hitCylRaw(p.c, p.axis, p.rin, p.h, o, d);
    const outer = hitCylRaw(p.c, p.axis, p.r, p.h, o, d);
    if (outer && (!inner || outer.t < inner.t)) {
      const x = [o[0] + d[0] * outer.t, o[1] + d[1] * outer.t, o[2] + d[2] * outer.t];
      const a = angleAt(p, x) - p.spin;
      const k = ((a / (Math.PI * 2)) * p.teeth % 1 + 1) % 1;
      if (k < 0.5) return outer;
    }
    return inner;
  }
  // sphere
  const oc = [o[0] - p.c[0], o[1] - p.c[1], o[2] - p.c[2]];
  const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const b = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2], cc = oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - p.r * p.r;
  const D = b * b - A * cc;
  if (D < 0) return null;
  let t = (-b - Math.sqrt(D)) / A;
  if (t <= 1e-6) t = (-b + Math.sqrt(D)) / A;
  if (t <= 1e-6) return null;
  const x = [oc[0] + d[0] * t, oc[1] + d[1] * t, oc[2] + d[2] * t];
  return { t, n: [x[0] / p.r, x[1] / p.r, x[2] / p.r] };
}

function castAll(prims, o, d, skip = null) {
  let best = null, bp = null;
  for (const p of prims) {
    if (p === skip) continue;
    const h = hitPrim(p, o, d);
    if (h && (!best || h.t < best.t)) { best = h; bp = p; }
  }
  return best ? { ...best, p: bp } : null;
}

// ---------- surface patterns: return ramp-step offset, or {mat} override ----------
const frac = x => x - Math.floor(x);
function pattern(p, x, n, phase, seed) {
  switch (p.pat) {
    case "rivets": {
      if (!p.min) {
        // cylinders: rivet rings near both ends
        const w = x[p.axis] - p.c[p.axis];
        const ring = Math.abs(Math.abs(w) - p.h * 0.75) < 0.04;
        return ring && frac(angleAt(p, x) / (Math.PI * 2) * 12) < 0.4 ? 2 : 0;
      }
      if (Math.abs(n[2]) > 0.5) return 0;
      const a = Math.abs(n[0]) > 0.5 ? 1 : 0, w = x[a], z = x[2];
      const nearEdge = Math.min(Math.abs(w - p.min[a]), Math.abs(w - p.max[a])) < 0.09;
      const zRow = Math.abs(frac(z * 4) - 0.5) < 0.12;
      return nearEdge && zRow ? 2 : 0;
    }
    case "panel": {
      // recessed seams every half tile on side faces, bevel on top edges (boxes only)
      if (!p.min) return 0;
      if (Math.abs(n[2]) > 0.5) {
        const e = Math.min(x[0] - p.min[0], p.max[0] - x[0], x[1] - p.min[1], p.max[1] - x[1]);
        return e < 0.05 ? 1 : 0;
      }
      const a = Math.abs(n[0]) > 0.5 ? 1 : 0;
      return Math.abs(frac(x[a] * 2) - 0.5) > 0.47 ? -2 : (x[2] > p.max[2] - 0.05 ? 1 : 0);
    }
    case "grille": {
      if (Math.abs(n[2]) > 0.5) return frac(x[0] * 6 + x[1] * 6) < 0.45 ? -3 : 0;
      return frac(x[2] * 8) < 0.45 ? -3 : 0;
    }
    case "hazard":
      return frac((x[0] + x[1] + x[2]) * 3) < 0.5 ? { mat: "dark" } : 0;
    case "stripes": {
      if (p.kind === 0) return 0;
      const k = frac((angleAt(p, x) - p.spin) / (Math.PI * 2) * 6);
      return k < 0.5 ? -1 : 0;
    }
    case "screw": {
      // helical auger: stripes along the axis that slide with phase (round parts only)
      if (p.kind === 0 || p.kind === 3) return 0;
      const k = frac(x[p.axis] * 5 + (angleAt(p, x)) / (Math.PI * 2) + phase);
      return k < 0.45 ? -2 : 0;
    }
    case "belt": {
      // chevrons on the top face scrolling along the local +x of the genome
      if (n[2] < 0.5) return frac((x[0] + x[1]) * 6) < 0.2 ? -1 : 0;
      const along = p.part.alongY ? x[1] : x[0];
      const across = p.part.alongY ? x[0] : x[1];
      const sgn = p.part.rev ? -1 : 1;
      const v = frac(sgn * along * 2 - phase * 2 + Math.abs(across - 0.5) * 1.6);
      if (across < 0.14 || across > 0.86) return -1;
      return v < 0.2 ? { mat: "steel" } : v > 0.85 ? -1 : 0;
    }
    case "planks":
      return frac(x[2] * 7 + (p.min ? p.min[0] : 0)) < 0.12 ? -2 : 0;
    case "bricks": {
      if (Math.abs(n[2]) > 0.5) return 0;
      const a = Math.abs(n[0]) > 0.5 ? 1 : 0;
      const row = Math.floor(x[2] * 6);
      const col = frac(x[a] * 3 + (row % 2) * 0.5);
      return frac(x[2] * 6) < 0.18 || col < 0.08 ? -2 : (hash3(row, Math.floor(x[a] * 3 + (row % 2) * 0.5), seed) > 0.7 ? 1 : 0);
    }
    case "noise":
      return Math.floor(hash3(Math.floor(x[0] * 16), Math.floor(x[1] * 16) * 7 + Math.floor(x[2] * 16), seed) * 3) - 1;
    case "water": {
      const w = Math.sin((x[0] * 5 + x[1] * 3) + phase * Math.PI * 2) + Math.sin((x[0] * 2 - x[1] * 6) - phase * Math.PI * 2 * 2);
      return w > 1.35 ? 2 : w < -1.1 ? -1 : 0;
    }
    case "blades": {
      const hsh = hash3(Math.floor(x[0] * 16), Math.floor(x[1] * 16), seed);
      return hsh > 0.86 ? 1 : hsh < 0.1 ? -1 : 0;
    }
    default: return 0;
  }
}

function hash3(a, b, s) {
  let h = (a * 374761393 + b * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - 0.5);

// ---------- bake ----------
// opts: phase, dir, active, quantize, dither, outline, shadows, groundShadow
export function bake(genome, opts = {}) {
  const o = { phase: 0, dir: 0, active: true, quantize: true, dither: true, outline: true, shadows: true, groundShadow: true, seed: 1, ...opts };
  const size = genome.size || 1;
  const prims = genome.parts.filter(pt => !pt.when || pt.when === (o.active ? "on" : "off")).map(pt => resolve(pt, o.dir, size, o.phase));
  // bounds: footprint plus every part's box (generous for animation)
  let x0 = 0, y0 = 0, x1 = size, y1 = size, z1 = genome.height || 1;
  for (const p of prims) {
    const lo = p.min || [p.c[0] - p.r - (p.h || 0), p.c[1] - p.r - (p.h || 0), p.c[2] - p.r - (p.h || 0)];
    const hi = p.max || [p.c[0] + p.r + (p.h || 0), p.c[1] + p.r + (p.h || 0), p.c[2] + p.r + (p.h || 0)];
    x0 = Math.min(x0, lo[0]); y0 = Math.min(y0, lo[1]); x1 = Math.max(x1, hi[0]); y1 = Math.max(y1, hi[1]); z1 = Math.max(z1, hi[2]);
  }
  const zmin = genome.zmin ?? 0;
  const pad = 2;
  const sxMin = Math.floor((x0 - y1) * 16) - pad, sxMax = Math.ceil((x1 - y0) * 16) + pad;
  const syMin = Math.floor((x0 + y0) * 8 - z1 * Z_PX) - pad, syMax = Math.ceil((x1 + y1) * 8 - zmin * Z_PX) + pad;
  const W = sxMax - sxMin, H = syMax - syMin;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const depth = new Float32Array(W * H).fill(-1e9);
  const partId = new Int16Array(W * H).fill(-1);
  const shadeIdx = new Int8Array(W * H).fill(-1);
  const matOf = new Array(W * H);
  const dd = [-1, -1, -1];
  const T = z1 + 4;
  const sh = o.shadowCatch ?? 0.6;

  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const sx = px + sxMin + 0.5, sy = py + syMin + 0.5;
    const gx = (sx / 16 + sy / 8) / 2, gy = (sy / 8 - sx / 16) / 2;
    const org = [gx + T, gy + T, T];
    const hit = castAll(prims, org, dd);
    const i = py * W + px;
    if (!hit) {
      // contact shadow on the ground plane under the object
      if (o.groundShadow && o.shadows && gx > x0 - sh && gy > y0 - sh && gx < x1 + sh && gy < y1 + sh) {
        const g = [gx, gy, 0.001];
        if (castAll(prims, g, LIGHT)) { rgba[i * 4] = 18; rgba[i * 4 + 1] = 20; rgba[i * 4 + 2] = 46; rgba[i * 4 + 3] = 92; }
      }
      continue;
    }
    const x = [org[0] - hit.t, org[1] - hit.t, org[2] - hit.t];
    let n = hit.n;
    const p = hit.p;
    let mat = p.mat;
    let step = 0;
    const pr = pattern(p, x, n, o.phase, o.seed + prims.indexOf(p) * 17);
    if (typeof pr === "object") mat = pr.mat; else step = pr;
    const M = MATERIALS[mat];
    let v;
    if (M.glow) {
      v = o.active ? 0.66 + 0.16 * Math.sin(o.phase * Math.PI * 2 * 2) + 0.12 * Math.max(0, n[2]) : 0.08;
      if (!o.active) mat = "dark";
    } else {
      let lam = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      if (o.shadows && lam > 0) {
        const so = [x[0] + n[0] * 0.002, x[1] + n[1] * 0.002, x[2] + n[2] * 0.002];
        if (castAll(prims, so, LIGHT)) lam *= 0.25;
      }
      v = 0.22 + 0.7 * lam;
      if (M.metal) {
        // Blinn highlight: one bright ramp step where the half vector lines up
        const hv = [LIGHT[0] + VIEW[0], LIGHT[1] + VIEW[1], LIGHT[2] + VIEW[2]], hl = Math.hypot(...hv);
        const spec = Math.pow(Math.max(0, (n[0] * hv[0] + n[1] * hv[1] + n[2] * hv[2]) / hl), 24);
        v += spec * 0.5;
      }
      if (o.shadows) v -= 0.12 * Math.max(0, 1 - (x[2] - zmin) / 0.25); // contact darkening
    }
    depth[i] = hit.t === undefined ? 0 : -hit.t;
    partId[i] = prims.indexOf(p);
    matOf[i] = mat;
    const ramp = RAMPS[mat];
    if (o.quantize) {
      const dz = o.dither ? BAYER[(py & 3) * 4 + (px & 3)] * 0.55 : 0;
      let k = Math.round(v * 5 + dz) + step;
      k = Math.max(0, Math.min(5, k));
      shadeIdx[i] = k;
      const c = ramp[k];
      rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255;
    } else {
      // continuous baseline: interpolate the ramp, no quantisation
      const f = Math.max(0, Math.min(5, v * 5 + step)), a = Math.floor(Math.min(4, f)), t = f - a;
      for (let ch = 0; ch < 3; ch++) rgba[i * 4 + ch] = ramp[a][ch] * (1 - t) + ramp[a + 1][ch] * t;
      rgba[i * 4 + 3] = 255;
      shadeIdx[i] = Math.round(f);
    }
  }

  if (o.outline) {
    // selective outline: silhouette pixels take their own material's darkest
    // step; interior creases (depth jumps between parts) drop two steps.
    const out = new Uint8ClampedArray(rgba);
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const i = py * W + px;
      if (partId[i] < 0) continue;
      let edge = false, crease = false;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + ax, ny = py + ay;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { edge = true; continue; }
        const j = ny * W + nx;
        if (partId[j] < 0) edge = true;
        else if (partId[j] !== partId[i] && depth[j] - depth[i] > 0.18) crease = true;
      }
      if (edge || crease) {
        const ramp = RAMPS[matOf[i]];
        const k = edge ? 0 : Math.max(0, shadeIdx[i] - 2);
        const c = ramp[k];
        out[i * 4] = edge ? c[0] * 0.7 : c[0]; out[i * 4 + 1] = edge ? c[1] * 0.7 : c[1]; out[i * 4 + 2] = edge ? c[2] * 0.75 : c[2]; out[i * 4 + 3] = 255;
      }
    }
    rgba.set(out);
  }
  // ox, oy: where world (0,0,0) lands inside the sprite
  return { w: W, h: H, rgba, ox: -sxMin, oy: -syMin };
}

// uniformly scale a genome (used for item readability)
export function scaleGenome(g, k) {
  const sc = a => a.map(v => v * k);
  return { ...g, parts: g.parts.map(p => ({ ...p, box: p.box && sc(p.box), c: p.c && sc(p.c), r: p.r && p.r * k, rin: p.rin && p.rin * k, h: p.h && p.h * k })) };
}

// world tile coords -> screen pixels (relative to world origin)
export function project(x, y, z = 0) { return [(x - y) * 16, (x + y) * 8 - z * Z_PX]; }
