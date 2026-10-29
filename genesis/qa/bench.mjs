// EXP-001 (genome rasterizer ablation) + sim throughput benchmark.
// Writes experiments/results/exp001.json, exp001-sheet.png and sim-bench.json.
import fs from "node:fs";
import zlib from "node:zlib";
import { bake } from "../engine/pixel/raster.js";
import { GENOMES } from "../games/factory-universe/art.js";
import { Surface, encodePNG } from "../tools/png.mjs";
import * as C from "../games/factory-universe/content.js";
import { createWorld, step, build } from "../engine/sim/factory.js";

const OUT = "experiments/results";
fs.mkdirSync(OUT, { recursive: true });

const VARIANTS = {
  A_raw:       { quantize: false, dither: false, outline: false, shadows: false, groundShadow: false },
  B_ramps:     { quantize: true,  dither: false, outline: false, shadows: false, groundShadow: false },
  C_dither:    { quantize: true,  dither: true,  outline: false, shadows: false, groundShadow: false },
  D_outline:   { quantize: true,  dither: true,  outline: true,  shadows: false, groundShadow: false },
  E_full:      { quantize: true,  dither: true,  outline: true,  shadows: true,  groundShadow: true },
  F_noDither:  { quantize: true,  dither: false, outline: true,  shadows: true,  groundShadow: true },
};
const BG = [92, 140, 58]; // mid grass, the usual backdrop

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function metrics(s) {
  const { w, h, rgba } = s;
  const colors = new Set(); let opaque = 0, lap = 0, lapN = 0, edge = 0, edgeN = 0;
  const L = new Float32Array(w * h), A = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    A[i] = rgba[i * 4 + 3] === 255 ? 1 : 0;
    if (A[i]) { opaque++; colors.add((rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2]); }
    L[i] = A[i] ? lum(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) : lum(...BG);
  }
  const bgL = lum(...BG);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!A[i]) continue;
    const nb = [i - 1, i + 1, i - w, i + w];
    if (nb.every(j => A[j])) { lap += Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w]); lapN++; }
    else { edge += Math.abs(L[i] - bgL); edgeN++; }
  }
  return { colors: colors.size, opaque, hfNoise: +(lap / Math.max(1, lapN)).toFixed(2), silhouetteContrast: +(edge / Math.max(1, edgeN)).toFixed(1) };
}

function timeIt(f, n = 7) { const ts = []; let r; for (let i = 0; i < n; i++) { const t = process.hrtime.bigint(); r = f(); ts.push(Number(process.hrtime.bigint() - t) / 1e6); } ts.sort((a, b) => a - b); return { ms: +ts[n >> 1].toFixed(2), r }; }

const results = {};
const sheetCells = [];
for (const name of ["drill", "smelter", "assembler", "generator", "lab", "hub"]) {
  results[name] = {};
  for (const [v, opts] of Object.entries(VARIANTS)) {
    const { ms, r } = timeIt(() => bake(GENOMES[name], { ...opts, phase: 0.2, active: true }));
    results[name][v] = { bakeMs: ms, ...metrics(r), w: r.w, h: r.h };
    sheetCells.push(r);
  }
}

// compactness: genome JSON vs the PNG atlas of every state the game uses
const atlas = {};
let genomeBytes = 0, atlasBytes = 0, frames = 0, atlasMs = 0;
for (const name of ["drill", "smelter", "assembler", "generator", "lab"]) {
  const g = JSON.stringify(GENOMES[name]); genomeBytes += g.length;
  let bytes = 0;
  const t0 = process.hrtime.bigint();
  for (let d = 0; d < 4; d++) {
    for (let f = 0; f < 8; f++) { const s = bake(GENOMES[name], { dir: d, phase: f / 8, active: true }); bytes += encodePNG(s.w, s.h, s.rgba).length; frames++; }
    const s = bake(GENOMES[name], { dir: d, active: false }); bytes += encodePNG(s.w, s.h, s.rgba).length; frames++;
  }
  atlasMs += Number(process.hrtime.bigint() - t0) / 1e6;
  atlas[name] = { genomeBytes: g.length, genomeGzip: zlib.gzipSync(g).length, atlasPngBytes: bytes, frames: 36 };
  atlasBytes += bytes;
}

const exp = {
  id: "EXP-001", date: new Date().toISOString().slice(0, 10), node: process.version,
  hypothesis: "Rendering compact part-list genomes with an analytic isometric ray caster, then quantising onto hue-shifted material ramps with selective outlines, yields coherent pixel-art sprites for every facing/state at interactive bake cost, from a representation far smaller than the sprite atlas it replaces.",
  variants: VARIANTS, results, compactness: { perMachine: atlas, genomeBytes, atlasPngBytes: atlasBytes, ratio: +(atlasBytes / genomeBytes).toFixed(1), frames, atlasBakeMs: Math.round(atlasMs), msPerFrame: +(atlasMs / frames).toFixed(2) },
};
fs.writeFileSync(`${OUT}/exp001.json`, JSON.stringify(exp, null, 2));

// contact sheet: rows = machines, cols = variants, 3x zoom on grass
const cw = 104, ch = 110, cols = Object.keys(VARIANTS).length, rows = sheetCells.length / cols, z = 3;
const S = new Surface(cw * cols * z, ch * rows * z, [...BG, 255]);
sheetCells.forEach((c, i) => S.blit(c, (((i % cols) * cw + (cw - c.w) / 2) | 0) * z, ((Math.floor(i / cols) * ch + (ch - c.h) / 2) | 0) * z, z));
fs.writeFileSync(`${OUT}/exp001-sheet.png`, S.png());

// ---- sim throughput: a dense synthetic factory ----
function denseWorld() {
  const st = createWorld(C, { seed: 1 });
  for (let i = 0; i < st.W * st.H; i++) { st.terrain[i] = 0; }
  for (const k of Object.keys(st.stock)) st.stock[k] = 1e9;
  // serpentine belt loops over most of the map, 1 item per tile
  let belts = 0;
  for (let y = 2; y < 62; y += 2) {
    for (let x = 2; x < 28; x++) if (build(st, "belt", x, y, 0).ok) belts++;
    for (let x = 36; x < 62; x++) if (build(st, "belt", x, y, 0).ok) belts++;
  }
  for (const id of st.order) { const e = st.ents.get(id); if (e.type === "belt") e.items.push({ item: "iron_plate", pos: 0, t: -1 }); }
  // machine blocks on the odd rows
  let machines = 0;
  for (let y = 3; y < 60; y += 6) for (let x = 2; x < 26; x += 3) {
    if (build(st, "smelter", x, y, 0).ok) machines++;
    if (build(st, "pole", x + 2, y + 2).ok) machines++;
  }
  return { st, belts, machines };
}
const { st, belts, machines } = denseWorld();
for (let i = 0; i < 120; i++) step(st);
const N = 600, t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) step(st);
const msPerTick = Number(process.hrtime.bigint() - t0) / 1e6 / N;
let items = 0; for (const id of st.order) { const e = st.ents.get(id); if (e.items) items += e.items.length; }
const simBench = { entities: st.order.length, belts, machines, itemsOnBelts: items, msPerTick: +msPerTick.toFixed(3), budgetAt60Hz: "16.67 ms", headroom: +(16.67 / msPerTick).toFixed(1) };
fs.writeFileSync(`${OUT}/sim-bench.json`, JSON.stringify(simBench, null, 2));

console.table(Object.fromEntries(Object.entries(results.smelter).map(([k, v]) => [k, v])));
console.log("compactness", exp.compactness.genomeBytes, "B genome ->", exp.compactness.atlasPngBytes, "B atlas (", exp.compactness.ratio, "x ),", exp.compactness.frames, "frames in", exp.compactness.atlasBakeMs, "ms");
console.log("sim", simBench);
