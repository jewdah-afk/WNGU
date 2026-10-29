// Factory Universe — browser client. The sim is authoritative; this file only
// presents it: sprite baking, drawing, input, HUD, VFX and SFX.
import * as C from "./content.js";
import * as S from "../../engine/sim/factory.js";
import { bake, scaleGenome, RAMPS } from "../../engine/pixel/raster.js";
import { GENOMES, ITEM_GENOMES, TILE_GENOMES, oreGenome } from "./art.js";
import { Sfx } from "./sfx.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SEED = +(params.get("seed") || 1);
const SAVE_KEY = "fu.save.v1." + SEED;

// ---------------- state ----------------
let st;
try {
  const saved = params.has("fresh") || params.has("bot") ? null : localStorage.getItem(SAVE_KEY);
  st = saved ? S.deserialize(C, saved) : S.createWorld(C, { seed: SEED });
} catch (e) { st = S.createWorld(C, { seed: SEED }); }

const view = $("view"), vctx = view.getContext("2d");
const low = document.createElement("canvas"), lctx = low.getContext("2d");
const cam = { x: 0, y: 0, zoom: 3 };
const ui = { tool: null, dir: 0, hover: null, selected: null, drag: null, pan: null, speed: 1, paused: false, showTechs: false };
const fx = { parts: [], beams: [], rings: [] };
const anim = new Map(); // entity id -> animation phase
const perf = { frames: 0, fps: 0, last: performance.now(), frameMs: 0, simMs: 0, draws: 0, bakeMs: 0, bakes: 0 };
const sfx = new Sfx();

// ---------------- sprite cache ----------------
const sprites = new Map();
function toCanvas(b) {
  const c = document.createElement("canvas"); c.width = b.w; c.height = b.h;
  c.getContext("2d").putImageData(new ImageData(b.rgba, b.w, b.h), 0, 0);
  return { c, ox: b.ox, oy: b.oy, w: b.w, h: b.h };
}
function sprite(key, make) {
  let s = sprites.get(key);
  if (!s) { const t0 = performance.now(); s = toCanvas(make()); perf.bakeMs += performance.now() - t0; perf.bakes++; sprites.set(key, s); }
  return s;
}
const FRAMES = 8, BELT_FRAMES = 16;
const machineSprite = (type, dir, active, f) => sprite(`${type}:${dir}:${active ? f : "off"}`, () =>
  bake(GENOMES[type], { dir: type === "hub" ? 0 : dir, active, phase: active ? f / FRAMES : 0 }));
const beltSprite = (dir, f) => sprite(`belt:${dir}:${f}`, () => bake(GENOMES.belt, { dir, phase: f / BELT_FRAMES, groundShadow: false }));
const ITEM_SCALE = 1.9;
const itemSprite = item => sprite(`item:${item}`, () => bake(scaleGenome(ITEM_GENOMES[item], ITEM_SCALE), { groundShadow: false, shadows: false }));
const itemIcon = item => sprite(`icon:${item}`, () => bake(scaleGenome(ITEM_GENOMES[item], 2.6), { groundShadow: false, shadows: false }));
const ORE_MATS = ["", "ore_iron", "ore_copper", "ore_coal", "ore_stone"];

// ---------------- terrain ----------------
const ORIGIN = { x: st.H * 16 + 24, y: 48 };
const terrain = document.createElement("canvas");
terrain.width = (st.W + st.H) * 16 + 48; terrain.height = (st.W + st.H) * 8 + 96;
const tctx = terrain.getContext("2d");
const tileKind = i => { const t = st.terrain[i]; return t === S.T_WATER ? "water" : t === S.T_SAND ? "sand" : t === S.T_ROCK ? "rock" : "grass"; };
function tileSprite(x, y, phaseFrame = 0) {
  const i = y * st.W + x, k = tileKind(i);
  const v = (x * 7 + y * 13) % 4;
  if (k === "grass") { const g = S.fbm(x * 1.7, y * 1.7, 77) > 0.5 ? "grass2" : "grass"; return sprite(`t:${g}:${v}`, () => bake(TILE_GENOMES[g], { groundShadow: false, outline: false, seed: v + 1 })); }
  if (k === "water") return sprite(`t:water:${phaseFrame}`, () => bake(TILE_GENOMES.water, { groundShadow: false, outline: false, phase: phaseFrame / 4 }));
  return sprite(`t:${k}:${v % 2}`, () => bake(TILE_GENOMES[k], { groundShadow: false, outline: k === "rock", seed: v + 1 }));
}
function drawTerrain() {
  tctx.clearRect(0, 0, terrain.width, terrain.height);
  for (let d = 0; d < st.W + st.H - 1; d++) for (let x = Math.max(0, d - st.H + 1); x <= Math.min(d, st.W - 1); x++) {
    const y = d - x, s = tileSprite(x, y);
    const [sx, sy] = [(x - y) * 16 + ORIGIN.x, (x + y) * 8 + ORIGIN.y];
    tctx.drawImage(s.c, sx - s.ox, sy - s.oy);
    const o = st.ore[y * st.W + x];
    if (o) { const os = sprite(`ore:${o}:${(x * 3 + y * 5) % 3}`, () => bake(oreGenome(ORE_MATS[o], (x * 3 + y * 5) % 3 + 1))); tctx.drawImage(os.c, sx - os.ox, sy - os.oy); }
  }
}

// ---------------- coordinates ----------------
const toScreen = (x, y, z = 0) => [(x - y) * 16 + ORIGIN.x, (x + y) * 8 - z * 16 + ORIGIN.y];
function lowSize() { return [Math.ceil(innerWidth / cam.zoom), Math.ceil(innerHeight / cam.zoom)]; }
function screenToWorld(mx, my) {
  const [lw, lh] = lowSize();
  const px = mx / cam.zoom + cam.x - lw / 2 - ORIGIN.x, py = my / cam.zoom + cam.y - lh / 2 - ORIGIN.y;
  return [(px / 16 + py / 8) / 2, (py / 8 - px / 16) / 2];
}
function centreOn(tx, ty) { const [sx, sy] = toScreen(tx, ty); cam.x = sx; cam.y = sy; }

// ---------------- VFX ----------------
// Particles live in terrain-pixel space; every emitter is driven by sim state.
function puff(x, y, z, kind) {
  const [sx, sy] = toScreen(x, y, z);
  const P = {
    smoke: { vx: (Math.random() - 0.3) * 4, vy: -9 - Math.random() * 5, life: 2.4, r0: 1.5, r1: 5, col: [120, 122, 130], a: 0.55 },
    soot:  { vx: (Math.random() - 0.3) * 4, vy: -11 - Math.random() * 5, life: 2.0, r0: 1.5, r1: 4.5, col: [52, 50, 58], a: 0.7 },
    spark: { vx: (Math.random() - 0.5) * 40, vy: -25 - Math.random() * 25, life: 0.45, r0: 0.6, r1: 0.6, col: [255, 214, 120], a: 1, g: 90 },
    dust:  { vx: (Math.random() - 0.5) * 14, vy: -6 - Math.random() * 6, life: 0.8, r0: 1, r1: 2, col: [150, 130, 100], a: 0.7, g: 12 },
    ember: { vx: (Math.random() - 0.5) * 6, vy: -16 - Math.random() * 6, life: 1.0, r0: 0.6, r1: 0.6, col: [255, 150, 60], a: 1 },
  }[kind];
  fx.parts.push({ x: sx, y: sy, t: 0, ...P });
}
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function drawParticles(ctx, dt, ox, oy) {
  const keep = [];
  for (const p of fx.parts) {
    p.t += dt; if (p.t >= p.life) continue;
    p.x += p.vx * dt; p.y += p.vy * dt; if (p.g) p.vy += p.g * dt; p.vx *= 0.985;
    keep.push(p);
    const k = p.t / p.life, r = p.r0 + (p.r1 - p.r0) * k, a = p.a * (1 - k);
    const cx = Math.round(p.x - ox), cy = Math.round(p.y - oy);
    ctx.fillStyle = `rgb(${p.col[0]},${p.col[1]},${p.col[2]})`;
    if (r < 1) { ctx.globalAlpha = a; ctx.fillRect(cx, cy, 1, 1); continue; }
    // dithered pixel disc: coverage thresholded against a Bayer matrix keeps it crisp
    const R = Math.ceil(r);
    ctx.globalAlpha = 1;
    for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
      if (xx * xx + yy * yy > r * r) continue;
      if (a * 16 < BAYER4[((cy + yy) & 3) * 4 + ((cx + xx) & 3)] + 0.5) continue;
      ctx.fillRect(cx + xx, cy + yy, 1, 1);
    }
  }
  ctx.globalAlpha = 1;
  fx.parts = keep.length > 2500 ? keep.slice(-2500) : keep;
}

// ---------------- simulation clock ----------------
let acc = 0, lastT = performance.now(), saveT = 0;
const deliveredWindow = []; // [tick, snapshot] for per-minute rates

function handleEvents() {
  for (const ev of st.events) {
    if (ev.k === "build") sfx.play("build", panOf(ev.x, ev.y));
    else if (ev.k === "remove") sfx.play("remove", panOf(ev.x, ev.y));
    else if (ev.k === "craft") {
      const e = st.ents.get(ev.id);
      if (e && onScreen(e)) {
        sfx.play(e.type === "smelter" ? "smelt" : "craft", panOf(e.x, e.y));
        if (e.type === "assembler") for (let i = 0; i < 6; i++) puff(e.x + 1, e.y + 1, 1.4, "spark");
      }
    } else if (ev.k === "burn") {
      const e = st.ents.get(ev.id);
      if (e) for (let i = 0; i < 4; i++) puff(e.x + 1.55, e.y + 1.5, 2.3, "soot");
    } else if (ev.k === "research") {
      sfx.play("research");
      toast(`${C.TECHS[ev.tech].name} ${C.TECHS[ev.tech].max === 1 ? "unlocked" : "level " + ev.level}`, "good");
      fx.rings.push({ t: 0 });
      buildToolbar();
    }
  }
  st.events.length = 0;
}

function simulate(now) {
  const dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
  if (ui.paused) return 0;
  acc += dt * ui.speed;
  const t0 = performance.now();
  let n = 0;
  while (acc >= 1 / 60 && n < 600) { S.step(st); handleEvents(); acc -= 1 / 60; n++; }
  perf.simMs = performance.now() - t0;
  if (st.tick % 60 === 0 || n > 0) {
    if (!deliveredWindow.length || st.tick - deliveredWindow[deliveredWindow.length - 1][0] >= 60) deliveredWindow.push([st.tick, { ...st.delivered }]);
    while (deliveredWindow.length > 61) deliveredWindow.shift();
  }
  if (now - saveT > 20000) { saveT = now; try { localStorage.setItem(SAVE_KEY, S.serialize(st)); } catch (e) {} }
  return dt;
}

// ---------------- rendering ----------------
function onScreen(e) {
  const [lw, lh] = lowSize(); const [sx, sy] = toScreen(e.x + e.size / 2, e.y + e.size / 2);
  return Math.abs(sx - cam.x) < lw / 2 + 64 && Math.abs(sy - cam.y) < lh / 2 + 96;
}
function panOf(x, y) { const [lw] = lowSize(); const [sx] = toScreen(x, y); return Math.max(-1, Math.min(1, (sx - cam.x) / (lw / 2))); }

function netOf(e) { return e.net !== undefined && e.net >= 0 ? st.power.nets[e.net] : null; }

function draw(dt) {
  const t0 = performance.now();
  const [lw, lh] = lowSize();
  if (low.width !== lw || low.height !== lh) { low.width = lw; low.height = lh; }
  if (view.width !== innerWidth || view.height !== innerHeight) { view.width = innerWidth; view.height = innerHeight; }
  const ox = Math.round(cam.x - lw / 2), oy = Math.round(cam.y - lh / 2);
  const g = lctx;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#0b0e13"; g.fillRect(0, 0, lw, lh);
  g.drawImage(terrain, -ox, -oy);
  let draws = 1;

  // animated water, only on screen
  const wf = Math.floor(performance.now() / 260) % 4;
  for (let y = 0; y < st.H; y++) for (let x = 0; x < st.W; x++) {
    if (st.terrain[y * st.W + x] !== S.T_WATER) continue;
    const [sx, sy] = toScreen(x, y);
    if (sx - ox < -40 || sx - ox > lw + 40 || sy - oy < -30 || sy - oy > lh + 30) continue;
    const s = tileSprite(x, y, wf); g.drawImage(s.c, sx - s.ox - ox, sy - s.oy - oy); draws++;
  }

  // power coverage overlay while placing power-related things
  if (ui.tool === "pole" || (ui.tool && C.BUILDINGS[ui.tool] && C.BUILDINGS[ui.tool].power)) {
    g.globalAlpha = 0.16; g.fillStyle = "#5fd3e6";
    const sup = C.BUILDINGS.pole.supply;
    for (const id of st.order) {
      const e = st.ents.get(id);
      if (e.type !== "pole" && e.type !== "hub") continue;
      const cx = e.type === "hub" ? e.x + 1 : e.x, cy = e.type === "hub" ? e.y + 1 : e.y;
      diamond(g, cx - sup, cy - sup, 2 * sup + 1, ox, oy, true);
    }
    g.globalAlpha = 1;
  }

  // entities in isometric depth order
  const list = [];
  for (const id of st.order) { const e = st.ents.get(id); if (onScreen(e)) list.push(e); }
  list.sort((a, b) => (a.x + a.y + 2 * a.size) - (b.x + b.y + 2 * b.size) || b.size - a.size || a.x - b.x);
  const bspeed = S.beltSpeed(st);
  const beltFrame = Math.floor(((st.tick * bspeed) % 256) / 256 * BELT_FRAMES) % BELT_FRAMES;
  for (const e of list) {
    const [sx, sy] = toScreen(e.x, e.y);
    if (e.type === "belt") {
      const s = beltSprite(e.dir, e.items.length && !ui.paused ? beltFrame : beltFrame);
      g.drawImage(s.c, sx - s.ox - ox, sy - s.oy - oy); draws++;
      for (const it of e.items) {
        const f = it.pos / 256 - 0.5;
        const [ix, iy] = toScreen(e.x + 0.5 + S.DX[e.dir] * f, e.y + 0.5 + S.DY[e.dir] * f, 0.2);
        const is = itemSprite(it.item); g.drawImage(is.c, Math.round(ix - is.ox - ox), Math.round(iy - is.oy - oy)); draws++;
      }
      continue;
    }
    const net = netOf(e);
    const powered = e.type === "pole" || e.type === "hub" || e.type === "generator" || e.type === "solar" || (net && net.sat > 0);
    let ph = anim.get(e.id) || 0;
    const rate = e.type === "hub" ? 0.35 : e.type === "drill" ? 1.2 : e.type === "generator" ? (e.load > 0 ? 0.4 + e.load / 600 : 0) : 0.7;
    const working = e.type === "hub" || e.working;
    if (working && !ui.paused) ph = (ph + dt * ui.speed * rate * (net ? net.sat / 1000 : 1)) % 1;
    anim.set(e.id, ph);
    const active = (working || e.type === "hub") && e.type !== "pole";
    const s = e.type === "pole" ? machineSprite("pole", 0, false, 0) : machineSprite(e.type, e.dir, active, Math.floor(ph * FRAMES) % FRAMES);
    g.drawImage(s.c, sx - s.ox - ox, sy - s.oy - oy); draws++;
    if (!powered && C.BUILDINGS[e.type].power) icon(g, e, "power", ox, oy);
    else if (net && net.sat < 1000 && C.BUILDINGS[e.type].power && Math.floor(performance.now() / 500) % 2) icon(g, e, "brown", ox, oy);
    // emitters: real state only
    if (e.working && !ui.paused && Math.random() < dt * ui.speed * 3) {
      if (e.type === "smelter") puff(e.x + (e.dir % 2 ? 1.4 : 0.6), e.y + (e.dir === 1 || e.dir === 2 ? 1.4 : 0.6), 2.6, Math.random() < 0.15 ? "ember" : "smoke");
      if (e.type === "drill") puff(e.x + 0.85 + Math.random() * 0.3, e.y + 1 + Math.random() * 0.3, 0.3, "dust");
      if (e.type === "generator") puff(e.x + 1.55, e.y + 1.5, 2.3, "smoke");
    }
  }

  // pole wires: minimum spanning tree over each network, drawn above entities
  g.strokeStyle = "#c8743a"; g.lineWidth = 1;
  for (const [a, b] of wireEdges()) {
    const za = a.hub ? 2.9 : 1.82, zb = b.hub ? 2.9 : 1.82;
    const [ax, ay] = toScreen(a.x + 0.5, a.y + 0.5, za), [bx, by] = toScreen(b.x + 0.5, b.y + 0.5, zb);
    if (Math.max(ax, bx) - ox < -20 || Math.min(ax, bx) - ox > lw + 20) continue;
    wire(g, ax - ox, ay - oy, bx - ox, by - oy);
  }

  // hub beam pulses with recent deliveries; research completion ring
  const hub = st.ents.get(1);
  if (hub) {
    const [hx, hy] = toScreen(hub.x + 1.5, hub.y + 1.5, 2.95);
    const rate = deliveredRate();
    const h = 40 + Math.min(120, rate * 2);
    const pulse = 0.18 + 0.1 * Math.sin(performance.now() / 180);
    for (let k = 0; k < 3; k++) { g.globalAlpha = pulse * (1 - k * 0.28); g.fillStyle = k ? "#5fd3e6" : "#c8f6ff"; g.fillRect(Math.round(hx - ox) - 2 - k * 2, Math.round(hy - oy - h), 4 + k * 4, h); }
    for (const r of fx.rings) {
      r.t += dt; const k = r.t / 1.6; if (k > 1) continue;
      g.globalAlpha = 1 - k; g.strokeStyle = "#5fd3e6";
      g.beginPath(); g.ellipse(Math.round(hx - ox), Math.round(hy - oy + 30), 20 + k * 160, (20 + k * 160) / 2, 0, 0, Math.PI * 2); g.stroke();
    }
    fx.rings = fx.rings.filter(r => r.t < 1.6);
    g.globalAlpha = 1;
  }

  drawParticles(g, ui.paused ? 0 : dt * ui.speed, ox, oy);

  // placement ghost
  if (ui.tool === "remove" && ui.hover) {
    const e = S.entAt(st, Math.floor(ui.hover[0]), Math.floor(ui.hover[1]));
    if (e && e.type !== "hub") { g.globalAlpha = 0.4; g.fillStyle = "#ef5b5b"; diamond(g, e.x, e.y, e.size, ox, oy, true); g.globalAlpha = 1; }
  } else if (ui.tool && ui.hover) {
    const s = C.BUILDINGS[ui.tool].size;
    const [tx, ty] = ghostTile();
    const why = S.canBuild(st, ui.tool, tx, ty);
    g.globalAlpha = 0.6;
    const spr = ui.tool === "belt" ? beltSprite(ui.dir, 0) : machineSprite(ui.tool, ui.dir, false, 0);
    const [sx, sy] = toScreen(tx, ty);
    g.drawImage(spr.c, sx - spr.ox - ox, sy - spr.oy - oy);
    g.globalAlpha = 0.35; g.fillStyle = why ? "#ef5b5b" : "#6ed28a";
    diamond(g, tx, ty, s, ox, oy, true);
    g.globalAlpha = 1;
    // output arrow
    if (ui.tool !== "pole" && ui.tool !== "lab" && ui.tool !== "solar") {
      const [ax, ay] = toScreen(tx + s / 2 + S.DX[ui.dir] * (s / 2 + 0.35), ty + s / 2 + S.DY[ui.dir] * (s / 2 + 0.35), 0.1);
      g.fillStyle = "#f2b441"; g.fillRect(Math.round(ax - ox) - 1, Math.round(ay - oy) - 1, 3, 3);
    }
  } else if (ui.hover && !ui.tool) {
    const e = S.entAt(st, Math.floor(ui.hover[0]), Math.floor(ui.hover[1]));
    if (e) { g.globalAlpha = 0.22; g.fillStyle = "#f2b441"; diamond(g, e.x, e.y, e.size, ox, oy, true); g.globalAlpha = 1; }
  }
  if (ui.selected && st.ents.has(ui.selected)) {
    const e = st.ents.get(ui.selected);
    g.strokeStyle = "#f2b441"; diamond(g, e.x, e.y, e.size, ox, oy, false);
  }

  vctx.imageSmoothingEnabled = false;
  vctx.drawImage(low, 0, 0, lw * cam.zoom, lh * cam.zoom);
  perf.draws = draws;
  perf.frameMs = performance.now() - t0;
}

let wireCache = { key: "", edges: [] };
function wireEdges() {
  const key = st.order.length + ":" + st.nextId;
  if (wireCache.key === key) return wireCache.edges;
  const nodes = [];
  for (const id of st.order) { const e = st.ents.get(id); if (e.type === "pole") nodes.push({ x: e.x, y: e.y }); else if (e.type === "hub") nodes.push({ x: e.x + 1, y: e.y + 1, hub: true }); }
  const r2 = C.BUILDINGS.pole.reach ** 2, used = new Array(nodes.length).fill(false), edges = [];
  for (let s0 = 0; s0 < nodes.length; s0++) {
    if (used[s0]) continue;
    used[s0] = true; const tree = [s0];
    while (true) {
      let best = null, bd = 1e9;
      for (const i of tree) for (let j = 0; j < nodes.length; j++) {
        if (used[j]) continue;
        const d = (nodes[i].x - nodes[j].x) ** 2 + (nodes[i].y - nodes[j].y) ** 2;
        if (d <= r2 && d < bd) { bd = d; best = [i, j]; }
      }
      if (!best) break;
      used[best[1]] = true; tree.push(best[1]); edges.push([nodes[best[0]], nodes[best[1]]]);
    }
  }
  wireCache = { key, edges };
  return edges;
}

function diamond(g, x, y, s, ox, oy, fill) {
  const p = [toScreen(x, y), toScreen(x + s, y), toScreen(x + s, y + s), toScreen(x, y + s)];
  g.beginPath(); p.forEach(([a, b], i) => i ? g.lineTo(a - ox, b - oy) : g.moveTo(a - ox, b - oy)); g.closePath();
  fill ? g.fill() : g.stroke();
}
function wire(g, ax, ay, bx, by) {
  const n = 12; g.beginPath();
  for (let i = 0; i <= n; i++) { const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t + Math.sin(Math.PI * t) * 4; i ? g.lineTo(Math.round(x) + 0.5, Math.round(y) + 0.5) : g.moveTo(Math.round(x) + 0.5, Math.round(y) + 0.5); }
  g.stroke();
}
function icon(g, e, kind, ox, oy) {
  const [sx, sy] = toScreen(e.x + e.size / 2, e.y + e.size / 2, 2.1);
  const x = Math.round(sx - ox), y = Math.round(sy - oy);
  const bolt = [[1, -4], [0, -3], [0, -2], [-1, -1], [-1, 0], [0, 0], [1, 0], [0, 1], [0, 2], [-1, 3]];
  g.fillStyle = "#11151b";
  for (const [a, b] of bolt) g.fillRect(x + a - 1, y + b - 1, 4, 3);
  g.fillStyle = kind === "power" ? "#ef5b5b" : "#f2b441";
  for (const [a, b] of bolt) g.fillRect(x + a, y + b, 2, 1);
}
function deliveredRate() {
  if (deliveredWindow.length < 2) return 0;
  const a = deliveredWindow[0], b = deliveredWindow[deliveredWindow.length - 1];
  const dtm = (b[0] - a[0]) / 3600; if (dtm <= 0) return 0;
  let n = 0; for (const k of Object.keys(b[1])) n += b[1][k] - a[1][k];
  return n / dtm;
}

// ---------------- input ----------------
function ghostTile() {
  const s = C.BUILDINGS[ui.tool].size;
  return [Math.floor(ui.hover[0] - (s - 1) / 2), Math.floor(ui.hover[1] - (s - 1) / 2)];
}
function tryBuild(tx, ty) {
  const r = S.build(st, ui.tool, tx, ty, ui.dir);
  if (!r.ok && r.reason !== "occupied") toast(r.reason, "bad");
  return r;
}
view.addEventListener("contextmenu", e => e.preventDefault());
function selectAt(x, y) {
  const ent = S.entAt(st, Math.floor(x), Math.floor(y));
  ui.selected = ent ? ent.id : null; renderInspector(); if (ent) sfx.play("click");
}
function removeAt(x, y) {
  const r = S.remove(st, Math.floor(x), Math.floor(y));
  if (r.ok && ui.selected && !st.ents.has(ui.selected)) { ui.selected = null; renderInspector(); }
  return r;
}
view.addEventListener("pointerdown", e => {
  sfx.unlock();
  view.setPointerCapture?.(e.pointerId);
  ui.hover = screenToWorld(e.clientX, e.clientY);
  if (e.button === 1 || (e.button === 0 && e.shiftKey)) { ui.pan = [e.clientX, e.clientY, cam.x, cam.y]; return; }
  if (e.button === 2) { ui.pan = [e.clientX, e.clientY, cam.x, cam.y, true]; return; }
  if (ui.tool === "remove") { removeAt(ui.hover[0], ui.hover[1]); ui.drag = { remove: true }; return; }
  if (!ui.tool) {
    // touch: drag pans, a tap selects (decided on pointerup)
    if (e.pointerType !== "mouse") { ui.pan = [e.clientX, e.clientY, cam.x, cam.y, "tap"]; return; }
    selectAt(ui.hover[0], ui.hover[1]);
    return;
  }
  const [tx, ty] = ghostTile();
  const r = tryBuild(tx, ty);
  if (ui.tool === "belt") ui.drag = { x: tx, y: ty, id: r.ok ? r.id : null };
  else if (ui.tool === "pole") ui.drag = { pole: true, x: tx, y: ty };
});
addEventListener("pointermove", e => {
  ui.hover = screenToWorld(e.clientX, e.clientY);
  if (ui.drag && ui.drag.remove) { removeAt(ui.hover[0], ui.hover[1]); return; }
  if (ui.pan) {
    const dx = e.clientX - ui.pan[0], dy = e.clientY - ui.pan[1];
    if (Math.abs(dx) + Math.abs(dy) > 6) ui.pan[4] = false;
    cam.x = ui.pan[2] - dx / cam.zoom; cam.y = ui.pan[3] - dy / cam.zoom;
  }
  if (ui.drag && ui.tool === "belt") {
    const tx = Math.floor(ui.hover[0]), ty = Math.floor(ui.hover[1]);
    if (tx === ui.drag.x && ty === ui.drag.y) return;
    // walk one tile at a time toward the cursor, turning the previous belt
    const ddx = tx - ui.drag.x, ddy = ty - ui.drag.y;
    const dir = Math.abs(ddx) >= Math.abs(ddy) ? (ddx > 0 ? 0 : 2) : (ddy > 0 ? 1 : 3);
    const prev = ui.drag.id && st.ents.get(ui.drag.id);
    if (prev) S.rotate(st, prev.x, prev.y, dir);
    ui.dir = dir;
    const nx = ui.drag.x + S.DX[dir], ny = ui.drag.y + S.DY[dir];
    const r = S.build(st, "belt", nx, ny, dir);
    ui.drag = { x: nx, y: ny, id: r.ok ? r.id : null };
    if (!r.ok && r.reason !== "occupied") { toast(r.reason, "bad"); ui.drag = null; }
  }
  updateTip(e);
});
addEventListener("pointerup", e => {
  if (ui.pan && ui.pan[4] === true && e.button === 2) removeAt(ui.hover[0], ui.hover[1]);
  if (ui.pan && ui.pan[4] === "tap") selectAt(ui.hover[0], ui.hover[1]);
  ui.pan = null; ui.drag = null;
});
view.addEventListener("wheel", e => {
  e.preventDefault();
  const before = screenToWorld(e.clientX, e.clientY);
  cam.zoom = Math.max(1, Math.min(6, cam.zoom + (e.deltaY < 0 ? 1 : -1)));
  const after = screenToWorld(e.clientX, e.clientY);
  const [a, b] = toScreen(before[0], before[1]), [c, d] = toScreen(after[0], after[1]);
  cam.x += a - c; cam.y += b - d;
}, { passive: false });

const keys = new Set();
addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") return;
  keys.add(e.key.toLowerCase());
  sfx.unlock();
  const b = Object.keys(C.BUILDINGS).find(k => C.BUILDINGS[k].key === e.key);
  if (b) { selectTool(ui.tool === b ? null : b); return; }
  const k = e.key.toLowerCase();
  if (k === "r") {
    if (ui.tool) ui.dir = (ui.dir + 1) % 4;
    else if (ui.hover) { S.rotate(st, Math.floor(ui.hover[0]), Math.floor(ui.hover[1])); renderInspector(); }
  } else if (k === "escape") { selectTool(null); ui.selected = null; renderInspector(); toggleTechs(false); }
  else if (k === "x" && ui.hover) S.remove(st, Math.floor(ui.hover[0]), Math.floor(ui.hover[1]));
  else if (k === "t") toggleTechs();
  else if (k === "p") { ui.paused = !ui.paused; toast(ui.paused ? "paused" : "running"); }
  else if (k === "h") $("help").style.display = $("help").style.display === "none" ? "" : "none";
});
addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
function panKeys(dt) {
  const v = 420 * dt / cam.zoom * 2;
  if (keys.has("w") || keys.has("arrowup")) cam.y -= v;
  if (keys.has("s") || keys.has("arrowdown")) cam.y += v;
  if (keys.has("a") || keys.has("arrowleft")) cam.x -= v;
  if (keys.has("d") || keys.has("arrowright")) cam.x += v;
}

// ---------------- HUD ----------------
const iconURL = new Map();
function iconSrc(item) {
  if (!iconURL.has(item)) iconURL.set(item, itemIcon(item).c.toDataURL());
  return iconURL.get(item);
}
const toolURL = new Map();
function toolSrc(type) {
  if (!toolURL.has(type)) toolURL.set(type, (type === "belt" ? beltSprite(0, 0) : machineSprite(type, 0, true, 0)).c.toDataURL());
  return toolURL.get(type);
}
function costText(cost) { return Object.keys(cost).map(k => `${cost[k]} ${C.ITEMS[k].name}`).join(", "); }

function buildToolbar() {
  const tb = $("toolbar");
  tb.innerHTML = "";
  for (const k of Object.keys(C.BUILDINGS)) {
    const B = C.BUILDINGS[k];
    if (!B.cost) continue;
    const locked = !S.techUnlocked(st, B.tech);
    const btn = document.createElement("button");
    btn.className = "tool" + (ui.tool === k ? " on" : "") + (locked ? " locked" : "");
    btn.dataset.tool = k;
    btn.innerHTML = `<img class="px" src="${toolSrc(k)}" style="width:${k === "belt" || k === "pole" ? 34 : 56}px"><span class="k">${B.key}</span><span class="nm">${B.name}</span>`;
    btn.onpointerenter = ev => ev.pointerType === "mouse" && showTip(ev, `<b>${B.name}</b><br>${costText(B.cost)}${B.power ? `<br>${B.power} kW` : ""}${B.output ? `<br>+${B.output} kW` : ""}${locked ? `<br><span style="color:var(--bad)">needs ${C.TECHS[B.tech].name}</span>` : ""}`);
    btn.onpointerleave = hideTip;
    btn.onclick = () => { if (!locked) selectTool(ui.tool === k ? null : k); };
    tb.appendChild(btn);
  }
  const rm = document.createElement("button");
  rm.className = "tool" + (ui.tool === "remove" ? " on" : ""); rm.dataset.tool = "remove";
  rm.innerHTML = `<span class="k">X</span><span class="big">&times;</span><span class="nm">Remove</span>`;
  rm.onclick = () => selectTool(ui.tool === "remove" ? null : "remove");
  tb.appendChild(rm);
  const sp = document.createElement("div"); sp.id = "speed";
  for (const v of [1, 2, 4]) { const b = document.createElement("button"); b.textContent = v + "x"; b.className = ui.speed === v ? "on" : ""; b.onclick = () => { ui.speed = v; buildToolbar(); }; sp.appendChild(b); }
  tb.appendChild(sp);
  const zm = document.createElement("div"); zm.id = "speed";
  for (const [lbl, d] of [["+", 1], ["\u2212", -1]]) { const b = document.createElement("button"); b.textContent = lbl; b.setAttribute("aria-label", d > 0 ? "zoom in" : "zoom out"); b.onclick = () => { cam.zoom = Math.max(1, Math.min(6, cam.zoom + d)); }; zm.appendChild(b); }
  tb.appendChild(zm);
}
function selectTool(t) {
  if (t && t !== "remove" && !S.techUnlocked(st, C.BUILDINGS[t].tech)) { toast("needs " + C.TECHS[C.BUILDINGS[t].tech].name, "bad"); return; }
  ui.tool = t; if (t) { ui.selected = null; renderInspector(); }
  document.querySelectorAll(".tool").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
  view.style.cursor = t ? "none" : "crosshair";
  sfx.play("click");
}

const SHOWN = ["iron_plate", "copper_plate", "brick", "gear", "wire", "circuit", "sci_red", "sci_green"];
function renderHUD() {
  const now = deliveredWindow.length > 1 ? deliveredWindow[deliveredWindow.length - 1][1] : null, then = deliveredWindow[0] && deliveredWindow[0][1];
  const mins = deliveredWindow.length > 1 ? (deliveredWindow[deliveredWindow.length - 1][0] - deliveredWindow[0][0]) / 3600 : 0;
  $("stock").innerHTML = SHOWN.filter(k => st.stock[k] > 0 || st.delivered[k] > 0 || k === "iron_plate").map(k => {
    const r = now && mins > 0 ? Math.round((now[k] - then[k]) / mins) : 0;
    return `<span class="res" title="${C.ITEMS[k].name}"><img class="px" src="${iconSrc(k)}"><span class="n">${fmt(st.stock[k])}</span>${r ? `<span class="r">+${r}/m</span>` : ""}</span>`;
  }).join("");
  let cap = 0, dem = 0, worst = 1000;
  for (const n of st.power.nets) { cap += n.cap; dem += n.demand; worst = Math.min(worst, n.sat); }
  $("pw-txt").textContent = `${dem} / ${cap} kW`;
  const bar = $("pw-bar"); bar.style.width = (cap ? Math.min(100, dem / cap * 100) : 0) + "%";
  bar.style.background = worst >= 1000 ? "var(--good)" : worst >= 500 ? "var(--warn)" : "var(--bad)";
  const cur = st.tech.current;
  if (cur) {
    const need = S.techCost(st, cur, st.tech.levels[cur]);
    $("rs-txt").textContent = `${C.TECHS[cur].name.split(" ")[0]} ${st.tech.units}/${need}`;
    $("rs-bar").style.width = (st.tech.units / need * 100) + "%";
  } else { $("rs-txt").textContent = "none (T)"; $("rs-bar").style.width = "0"; }
  $("clock").textContent = `t+${Math.floor(st.tick / 3600)}m ${String(Math.floor(st.tick / 60) % 60).padStart(2, "0")}s · ${perf.fps} fps`;
  document.querySelectorAll(".tool").forEach(b => {
    const B = C.BUILDINGS[b.dataset.tool]; if (!B || !B.cost) return;
    b.classList.toggle("poor", Object.keys(B.cost).some(k => st.stock[k] < B.cost[k]));
  });
  if (ui.selected) renderInspector(true);
  if (ui.showTechs) renderTechs();
}
function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(1) + "k" : String(n); }

function chip(item, n) { return `<span class="chip"><img class="px" src="${iconSrc(item)}">${n}</span>`; }
function renderInspector(soft) {
  const box = $("inspect");
  const e = ui.selected && st.ents.get(ui.selected);
  if (!e) { box.style.display = "none"; return; }
  if (soft && box.matches(":hover")) return;
  box.style.display = "block";
  const B = C.BUILDINGS[e.type], net = netOf(e);
  let status = "", body = "";
  const pw = B.power ? (net ? (net.sat >= 1000 ? `<span style="color:var(--good)">powered</span>` : `<span style="color:var(--warn)">brownout ${Math.round(net.sat / 10)}%</span>`) : `<span style="color:var(--bad)">no power - place a pole nearby</span>`) : "";
  if (e.type === "drill") {
    status = e.working ? "mining" : e.out ? "output blocked" : "idle";
    body = `<div class="eyebrow">Deposit</div><div class="buf">${chip(C.ORES[e.ore - 1], (e.rich / 1000).toFixed(2) + "x")} infinite</div>
      <div class="eyebrow">Rate</div>${(C.BUILDINGS.drill.rate * e.rich / 1000 * (1 + 0.1 * st.tech.levels.mining_prod)).toFixed(1)} ore/min at full power`;
  } else if (e.type === "smelter" || e.type === "assembler") {
    const R = e.recipe && C.RECIPES[e.recipe];
    status = e.working ? "working" : R ? "waiting for input" : "no recipe";
    body = `<div class="eyebrow">Input</div><div class="buf">${R ? Object.keys(R.in).map(k => chip(k, `${e.inb[k] || 0}/${R.in[k]}`)).join("") : "auto (smelts any ore)"}</div>
      <div class="eyebrow">Output</div><div class="buf">${R ? Object.keys(R.out).map(k => chip(k, e.outb[k] || 0)).join("") : "-"}</div>
      <div class="bar"><i style="width:${R ? e.progress / (R.time * 10) : 0}%;background:var(--amber)"></i></div>`;
    if (e.type === "assembler") {
      body += `<div class="eyebrow" style="margin-top:10px">Recipe</div><div class="recipes">` + Object.keys(C.RECIPES).filter(k => C.RECIPES[k].machine === "assembler").map(k => {
        const ok = S.techUnlocked(st, C.RECIPES[k].tech);
        return `<button class="btn${e.recipe === k ? " on" : ""}" data-recipe="${k}" ${ok ? "" : "disabled"}><img class="px" src="${iconSrc(k)}">${C.ITEMS[k].name}</button>`;
      }).join("") + `</div>`;
    }
  } else if (e.type === "generator") {
    status = e.load > 0 ? `generating ${e.load} kW` : "idle";
    body = `<div class="eyebrow">Fuel</div><div class="buf">${chip("coal", e.fuel)}</div><div class="bar"><i style="width:${e.energy / (C.COAL_KJ * 60) * 100}%;background:var(--amber)"></i></div>`;
  } else if (e.type === "lab") {
    status = e.working ? "researching" : st.tech.current ? "waiting for packs" : "no research selected (T)";
    body = `<div class="eyebrow">Packs</div><div class="buf">${chip("sci_red", e.inb.sci_red || 0)}${chip("sci_green", e.inb.sci_green || 0)}</div>`;
  } else if (e.type === "hub") {
    status = "accepting all items";
    body = `<div class="eyebrow">Delivered per minute</div>${Math.round(deliveredRate())} items/min<br><div class="eyebrow" style="margin-top:8px">Core reactor</div>+${C.BUILDINGS.hub.output} kW, acts as a power pole`;
  } else if (e.type === "pole") { status = net ? `network: ${net.demand}/${net.cap} kW` : "unconnected"; }
  else if (e.type === "solar") { status = `+${B.output} kW`; }
  box.innerHTML = `<h3>${B.name}</h3><div class="st">${status}${pw ? " · " + pw : ""}</div>${body}
    ${e.type !== "hub" ? `<div class="row" style="margin-top:12px"><button class="btn" id="i-rot">Rotate (R)</button><button class="btn" id="i-del">Remove</button></div>` : ""}`;
  box.querySelectorAll("[data-recipe]").forEach(b => b.onclick = () => { S.setRecipe(st, e.id, b.dataset.recipe); sfx.play("click"); renderInspector(); });
  const rot = $("i-rot"); if (rot) rot.onclick = () => { S.rotate(st, e.x, e.y); renderInspector(); };
  const del = $("i-del"); if (del) del.onclick = () => { S.remove(st, e.x, e.y); ui.selected = null; renderInspector(); };
}

const EFFECT = { belt_speed: "+50% belt speed per level", unlock: "unlocks new content", mining: "+10% drill output per level", speed: "+15% smelter & assembler speed per level", power: "+50% generator output per level" };
function toggleTechs(on) { ui.showTechs = on === undefined ? !ui.showTechs : on; $("techs").style.display = ui.showTechs ? "block" : "none"; if (ui.showTechs) renderTechs(); }
function renderTechs() {
  const box = $("techs");
  if (box.matches(":hover") && box.dataset.ready) return;
  box.dataset.ready = 1;
  box.innerHTML = `<h2>RESEARCH</h2><div class="eyebrow">Labs consume one of each pack per unit. Infinite techs grow geometrically.</div>` +
    Object.keys(C.TECHS).map(k => {
      const T = C.TECHS[k], lv = st.tech.levels[k], avail = S.techAvailable(st, k);
      const done = !avail && (T.max && lv >= T.max), locked = !avail && !done;
      const need = S.techCost(st, k, lv);
      return `<div class="tech${st.tech.current === k ? " on" : ""}${done ? " done" : ""}${locked ? " locked" : ""}" data-tech="${k}">
        <span class="nm">${T.name} <span class="lv">${T.max === 1 ? (lv ? "done" : "") : "lv " + lv + (T.max ? "/" + T.max : "")}</span></span>
        <span class="cost">${done ? "" : need + " x " + T.packs.map(p => `<img class="px" src="${iconSrc(p)}">`).join("")}</span>
        <span class="ef">${EFFECT[T.effect]}${T.req && !st.tech.levels[T.req] ? ` · requires ${C.TECHS[T.req].name}` : ""}${st.tech.current === k ? ` · ${st.tech.units}/${need} units` : ""}</span></div>`;
    }).join("");
  box.querySelectorAll("[data-tech]").forEach(d => d.onclick = () => { if (S.setResearch(st, d.dataset.tech)) { sfx.play("click"); box.dataset.ready = ""; renderTechs(); } });
}
$("research-mini").onclick = () => toggleTechs();
$("help-x").onclick = () => $("help").style.display = "none";

function toast(msg, kind = "") {
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = msg;
  $("toasts").appendChild(t); setTimeout(() => t.remove(), 3300);
  while ($("toasts").children.length > 4) $("toasts").firstChild.remove();
}
function showTip(ev, html) { const t = $("tip"); t.innerHTML = html; t.style.display = "block"; t.style.left = ev.clientX + 12 + "px"; t.style.top = ev.clientY - 60 + "px"; }
function hideTip() { $("tip").style.display = "none"; }
function updateTip(ev) {
  if (ui.tool || !ui.hover || ev.target !== view) { if (ev.target === view) hideTip(); return; }
  const x = Math.floor(ui.hover[0]), y = Math.floor(ui.hover[1]);
  if (x < 0 || y < 0 || x >= st.W || y >= st.H) return hideTip();
  const e = S.entAt(st, x, y), o = st.ore[y * st.W + x];
  if (e) showTip(ev, `<b>${C.BUILDINGS[e.type].name}</b>${e.working ? " · working" : ""}<br><span style="color:var(--muted)">click to inspect</span>`);
  else if (o) showTip(ev, `<b>${C.ITEMS[C.ORES[o - 1]].name}</b> deposit<br>richness ${(st.rich[y * st.W + x] / 1000).toFixed(2)}x · infinite`);
  else hideTip();
}

// ---------------- boot ----------------
async function boot() {
  const t0 = performance.now();
  drawTerrain();
  // pre-bake what the first screen needs
  for (const k of ["drill", "smelter", "assembler", "generator", "lab"]) for (let d = 0; d < 4; d++) machineSprite(k, d, false, 0);
  for (let f = 0; f < FRAMES; f++) machineSprite("hub", 0, true, f);
  for (let d = 0; d < 4; d++) for (let f = 0; f < BELT_FRAMES; f++) beltSprite(d, f);
  perf.bootMs = Math.round(performance.now() - t0);
  const hub = st.ents.get(1);
  centreOn(hub.x + 1.5, hub.y + 1.5);
  cam.zoom = innerWidth > 1400 ? 3 : 2;
  if (params.has("bot") || location.hash === "#bot") await runBot(+(params.get("bot") || 60));
  if (params.has("zoom")) cam.zoom = +params.get("zoom");
  buildToolbar(); renderHUD();
  $("loading").remove();
  if (st.tick === 0) toast("Build drills on ore and belt plates into the Core Hub", "good");
  requestAnimationFrame(frame);
  setInterval(renderHUD, 250);
}
// let the playtest bot build a starter factory in this world (same commands a player uses)
async function runBot(extraSeconds = 60) {
  const Bot = await import("../../qa/bot.mjs");
  const a = Bot.starterFactory(st);
  Bot.run(st, 120);
  Bot.scienceBlock(st, a.gen);
  Bot.run(st, extraSeconds);
  st.events.length = 0;
  buildToolbar();
}
$("bot-go").onclick = async () => {
  if (st.order.length > 1) { toast("the bot needs an empty world: remove your buildings first", "bad"); return; }
  $("bot-go").disabled = true; $("bot-go").textContent = "building…";
  await new Promise(r => setTimeout(r, 30));
  await runBot(30);
  $("bot-go").textContent = "built";
  if (innerWidth < 900) $("help").style.display = "none";
  toast("bot built a starter factory: drills, smelters, gears, science", "good");
};

function frame(now) {
  const dt = simulate(now);
  panKeys(dt || 1 / 60);
  draw(dt);
  sfx.ambient(st);
  perf.frames++;
  if (now - perf.last > 1000) { perf.fps = perf.frames; perf.frames = 0; perf.last = now; }
  requestAnimationFrame(frame);
}

// QA hooks: the automated harness drives and inspects the real game through these.
window.__fu = { st: () => st, S, C, cam, ui, perf, sprites, selectTool, centreOn, toScreen, screenToWorld, renderHUD, toggleTechs,
  setSpeed: v => { ui.speed = v; }, setPaused: v => { ui.paused = v; }, stepN: n => { for (let i = 0; i < n; i++) { S.step(st); handleEvents(); } } };
boot();
