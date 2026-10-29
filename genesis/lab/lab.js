// Genome Lab: live baking, stage ablation and interactive evolution on the
// same rasterizer the game uses.
import { bake, RAMPS, MATERIALS, scaleGenome } from "../engine/pixel/raster.js";
import { GENOMES, ITEM_GENOMES, TILE_GENOMES } from "../games/factory-universe/art.js";

const $ = id => document.getElementById(id);
const ASSETS = {};
for (const k of Object.keys(GENOMES)) ASSETS[k] = GENOMES[k];
for (const k of Object.keys(TILE_GENOMES)) ASSETS["tile:" + k] = TILE_GENOMES[k];
for (const k of Object.keys(ITEM_GENOMES)) ASSETS["item:" + k] = scaleGenome(ITEM_GENOMES[k], 3);
const clone = g => JSON.parse(JSON.stringify(g));
let current = clone(GENOMES.smelter), currentName = "smelter";

for (const k of Object.keys(ASSETS)) $("asset").add(new Option(k, k));
$("asset").value = "smelter";

const STAGES = ["quantize", "dither", "outline", "shadows", "groundShadow"];
function opts() {
  const o = { dir: +$("dir").value, phase: +$("phase").value, active: $("active").checked };
  for (const s of STAGES) o[s] = $(s).checked;
  return o;
}

function paint(canvas, s, zoom, bg) {
  canvas.width = s.w * zoom; canvas.height = s.h * zoom;
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.fillStyle = bg; g.fillRect(0, 0, canvas.width, canvas.height);
  const tmp = document.createElement("canvas"); tmp.width = s.w; tmp.height = s.h;
  tmp.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(s.rgba), s.w, s.h), 0, 0);
  g.drawImage(tmp, 0, 0, s.w * zoom, s.h * zoom);
}
function colours(s) { const set = new Set(); for (let i = 0; i < s.w * s.h; i++) if (s.rgba[i * 4 + 3] === 255) set.add((s.rgba[i * 4] << 16) | (s.rgba[i * 4 + 1] << 8) | s.rgba[i * 4 + 2]); return set.size; }
function contrast(s, bg) {
  const b = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16)), L = (r, g, bl) => 0.2126 * r + 0.7152 * g + 0.0722 * bl, bl = L(...b);
  let e = 0, n = 0;
  for (let y = 1; y < s.h - 1; y++) for (let x = 1; x < s.w - 1; x++) {
    const i = y * s.w + x; if (s.rgba[i * 4 + 3] !== 255) continue;
    if ([i - 1, i + 1, i - s.w, i + s.w].some(j => s.rgba[j * 4 + 3] !== 255)) { e += Math.abs(L(s.rgba[i * 4], s.rgba[i * 4 + 1], s.rgba[i * 4 + 2]) - bl); n++; }
  }
  return n ? e / n : 0;
}

function render() {
  const o = opts(), bg = $("bg").value;
  const t0 = performance.now();
  let s;
  try { s = bake(current, o); } catch (e) { $("jsonErr").innerHTML = `<span class="err">${e.message}</span>`; return; }
  const ms = performance.now() - t0;
  paint($("view"), s, +$("zoom").value, bg);
  $("s-ms").textContent = ms.toFixed(1) + " ms";
  $("s-size").textContent = `${s.w}x${s.h}`;
  $("s-col").textContent = colours(s);
  $("s-bytes").textContent = JSON.stringify(current).length + " B";
}

function ablation() {
  const bg = $("bg").value, base = opts();
  const rows = [["all on", {}], ["no ramps", { quantize: false }], ["no dither", { dither: false }], ["no outline", { outline: false }], ["no shadows", { shadows: false, groundShadow: false }], ["raw", { quantize: false, dither: false, outline: false, shadows: false, groundShadow: false }]];
  const box = $("ablation"); box.innerHTML = "";
  for (const [name, ov] of rows) {
    const t0 = performance.now(), s = bake(current, { ...base, ...ov }), ms = performance.now() - t0;
    const d = document.createElement("div"); d.className = "cell";
    const c = document.createElement("canvas"); paint(c, s, 2, bg); d.appendChild(c);
    d.insertAdjacentHTML("beforeend", `<small>${name} · ${colours(s)} col · ${ms.toFixed(1)} ms</small>`);
    box.appendChild(d);
  }
}

// ---- interactive evolution ----
const MATS = Object.keys(MATERIALS).filter(m => !MATERIALS[m].glow && !m.startsWith("ore_") && !["grass", "grass2", "sand", "water", "rock"].includes(m));
const PATS = [undefined, "panel", "rivets", "grille", "bricks", "stripes", "hazard", "noise"];
function mutate(g) {
  const m = clone(g);
  const n = 1 + Math.floor(Math.random() * 3);
  for (let k = 0; k < n; k++) {
    const p = m.parts[Math.floor(Math.random() * m.parts.length)];
    const r = Math.random();
    if (r < 0.4 && p.box) {
      const a = Math.floor(Math.random() * 6), d = (Math.random() - 0.5) * 0.3;
      p.box[a] = Math.max(0, Math.min((m.size || 1) + 0.5, p.box[a] + d));
      if (p.box[a % 3] > p.box[a % 3 + 3]) [p.box[a % 3], p.box[a % 3 + 3]] = [p.box[a % 3 + 3], p.box[a % 3]];
    } else if (r < 0.55 && p.r) {
      p.r = Math.max(0.04, p.r * (0.8 + Math.random() * 0.4));
      if (p.rin) p.rin = Math.min(p.rin, p.r * 0.9);
    } else if (r < 0.8 && !MATERIALS[p.mat]?.glow) {
      p.mat = MATS[Math.floor(Math.random() * MATS.length)];
    } else {
      p.pat = PATS[Math.floor(Math.random() * PATS.length)];
    }
  }
  return m;
}
function showMutants() {
  const bg = $("bg").value, o = opts();
  const box = $("mutants"); box.innerHTML = "";
  for (let made = 0, tries = 0; made < 6 && tries < 30; tries++) {
    const g = mutate(current);
    let s;
    try { s = bake(g, o); } catch (e) { console.warn("mutant skipped:", e.message); continue; }
    made++;
    const d = document.createElement("div"); d.className = "cell";
    const c = document.createElement("canvas"); paint(c, s, 2, bg); d.appendChild(c);
    d.insertAdjacentHTML("beforeend", `<small>contrast ${contrast(s, bg).toFixed(0)} · ${colours(s)} col</small>`);
    d.onclick = () => { current = g; syncJSON(); refresh(); showMutants(); };
    box.appendChild(d);
  }
}

function syncJSON() { $("json").value = JSON.stringify(current, null, 1); $("jsonErr").textContent = ""; }
$("json").addEventListener("input", () => {
  try { current = JSON.parse($("json").value); $("jsonErr").textContent = ""; refresh(); }
  catch (e) { $("jsonErr").innerHTML = `<span class="err">JSON: ${e.message}</span>`; }
});

function ramps() {
  $("ramps").innerHTML = Object.keys(RAMPS).map(k => `<div><span>${k}</span>${RAMPS[k].map(c => `<i style="background:rgb(${c.join(",")})"></i>`).join("")}</div>`).join("");
}

function refresh() { render(); ablation(); }
$("asset").onchange = () => { currentName = $("asset").value; current = clone(ASSETS[currentName]); syncJSON(); refresh(); showMutants(); };
for (const id of ["dir", "active", "bg", ...STAGES]) $(id).onchange = refresh;
$("phase").oninput = render; $("zoom").oninput = render;
$("mutate").onclick = showMutants;
$("reset").onclick = () => { current = clone(ASSETS[currentName]); syncJSON(); refresh(); };

// configs persist per viewer; export gives a JSON file to commit as an experiment config
const KEY = "genome-lab.config";
$("save").onclick = () => {
  const cfg = { asset: currentName, genome: current, opts: opts(), bg: $("bg").value, zoom: +$("zoom").value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); $("saved").textContent = "saved in this browser"; } catch (e) { $("saved").textContent = "storage unavailable"; }
};
$("export").onclick = async () => {
  const text = JSON.stringify({ asset: currentName, genome: current, opts: opts() }, null, 2);
  try { await navigator.clipboard.writeText(text); $("saved").textContent = "config JSON copied"; }
  catch (e) { $("json").value = text; $("json").select(); $("saved").textContent = "copy blocked: the JSON is selected in the editor"; }
};
try {
  const cfg = JSON.parse(localStorage.getItem(KEY) || "null");
  if (cfg) {
    currentName = cfg.asset; current = cfg.genome; $("asset").value = cfg.asset; $("bg").value = cfg.bg; $("zoom").value = cfg.zoom;
    for (const s of STAGES) $(s).checked = cfg.opts[s]; $("dir").value = cfg.opts.dir; $("active").checked = cfg.opts.active;
  }
} catch (e) {}

let last = performance.now();
function tick(now) {
  if ($("play").checked && now - last > 90) { last = now; $("phase").value = ((+$("phase").value + 0.0625) % 1).toFixed(4); render(); }
  requestAnimationFrame(tick);
}
syncJSON(); ramps(); refresh(); showMutants(); requestAnimationFrame(tick);
window.__lab = { bake, get genome() { return current; } };
