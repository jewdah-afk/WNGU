// Autonomous playtest bot: builds a starter factory through the same public
// commands a player uses, so a failure here is a real gameplay failure
// (unbuildable layout, starved machine, softlock), not a test artefact.
import { build, canBuild, setRecipe, setResearch, entAt, frontTiles, step } from "../engine/sim/factory.js";
import { findSpot, routeBelt, poleChain, dirToward, patchCentre } from "../engine/sim/planner.js";

const ORE = { iron_ore: 1, copper_ore: 2, coal: 3, stone: 4 };

export function hub(st) { return entAt(st, st.W / 2, st.H / 2); }

// waits (runs the sim) up to `patience` seconds for the hub to afford it
function place(st, log, type, x, y, dir, patience = 600) {
  let r = build(st, type, x, y, dir);
  for (let t = 0; !r.ok && r.reason.startsWith("not enough") && t < patience; t++) { run(st, 1); r = build(st, type, x, y, dir); }
  log.push(`${type}@${x},${y} d${dir}: ${r.ok ? "ok" : r.reason}`);
  return r.ok ? st.ents.get(r.id) : null;
}

// drill on `ore`, optional machine directly in front, then a belt to `target`.
export function line(st, log, ore, { machine = null, recipe = null, target, nearX, nearY, noRoute = false }) {
  const H = hub(st);
  const tgt = target || H;
  const c = patchCentre(st, ORE[ore], nearX ?? tgt.x, nearY ?? tgt.y);
  if (!c) { log.push("no patch for " + ore); return null; }
  const chainOf = machine ? (Array.isArray(machine) ? machine : [machine]) : [];
  const fits = (x, y) => {
    if (st.ore[y * st.W + x] !== ORE[ore]) return false;
    const dr = dirToward(x, y, tgt.x, tgt.y);
    let px = x, py = y;
    for (const m of chainOf) {
      px += 2 * [1, 0, -1, 0][dr]; py += 2 * [0, 1, 0, -1][dr];
      if (canBuild(st, m, px, py, true)) return false;
    }
    // the last machine's output tiles must not already belong to another line
    const fr = frontTiles({ x: px, y: py, size: 2, dir: dr });
    for (const [tx, ty] of fr) { const o = entAt(st, tx, ty); if (o && o !== tgt) return false; }
    return true;
  };
  const drill = findSpot(st, "drill", c[0], c[1], fits, 14);
  if (!drill) { log.push("no drill spot"); return null; }
  const dir = dirToward(drill[0], drill[1], tgt.x, tgt.y);
  const d = place(st, log, "drill", drill[0], drill[1], dir);
  if (!d) return null;
  let src = d;
  const chain = machine ? (Array.isArray(machine) ? machine : [machine]) : [];
  const recipes = Array.isArray(recipe) ? recipe : [recipe];
  for (let k = 0; k < chain.length; k++) {
    const [fx, fy] = frontTiles(src)[0];
    const mx = dir === 2 ? fx - 1 : fx, my = dir === 3 ? fy - 1 : fy;
    const m = place(st, log, chain[k], mx, my, dir);
    if (!m) return null;
    if (recipes[k]) setRecipe(st, m.id, recipes[k]);
    src = m;
  }
  if (noRoute) return { drill: d, src };
  const out = frontTiles(src);
  if (entAt(st, out[0][0], out[0][1]) === tgt) return { drill: d, src };
  for (const start of out) {
    const path = routeBelt(st, start, tgt, src);
    if (path) {
      let ok = true;
      for (const p of path) if (!place(st, [], "belt", p.x, p.y, p.dir)) { ok = false; break; }
      log.push(`belt x${path.length}: ${ok ? "ok" : "FAILED"}`);
      if (ok) return { drill: d, src, path };
    }
  }
  log.push("no belt route");
  return { drill: d, src };
}

function machinesOf(st, l) {
  const out = [], seen = new Set([l.drill.id]);
  let e = l.drill;
  while (e && e !== l.src) {
    const [fx, fy] = frontTiles(e)[0];
    e = entAt(st, fx, fy);
    if (!e || seen.has(e.id)) break;
    seen.add(e.id); out.push(e);
  }
  return out;
}

export function power(st, log, gen, targets) {
  for (const t of targets) {
    const p = poleChain(st, gen, t, (x, y) => !!place(st, [], "pole", x, y, 0));
    log.push(`poles ${gen.type}->${t.type}: ${p ? p.length : "FAILED"}`);
  }
}

export function starterFactory(st) {
  const log = [];
  const H = hub(st);
  // coal straight into a generator
  const coal = patchCentre(st, ORE.coal, H.x, H.y);
  const cd = findSpot(st, "drill", coal[0], coal[1], (x, y) => st.ore[y * st.W + x] === ORE.coal, 6);
  const cdir = dirToward(cd[0], cd[1], H.x, H.y);
  const drillC = place(st, log, "drill", cd[0], cd[1], cdir);
  const [gx, gy] = frontTiles(drillC)[0];
  const gen = place(st, log, "generator", cdir === 2 ? gx - 1 : gx, cdir === 3 ? gy - 1 : gy, cdir);
  const a = line(st, log, "iron_ore", { machine: "smelter" });
  const b = line(st, log, "copper_ore", { machine: "smelter" });
  const c = line(st, log, "stone", { machine: "smelter" });
  const g = line(st, log, "iron_ore", { machine: ["smelter", "assembler"], recipe: [null, "gear"] });
  const ms = [drillC, a, b, c, g].flatMap(l => l && l.drill ? [l.drill, ...machinesOf(st, l)] : l ? [l] : []);
  power(st, log, gen, ms);
  return { log, gen, lines: [a, b, c, g] };
}

// Second stage: copper -> smelter -> science assembler -> lab in one row,
// with gears belted in from a separate iron -> smelter -> gear assembler line.
export function scienceBlock(st, gen) {
  const log = [];
  const H = hub(st);
  const sci = line(st, log, "copper_ore", { machine: ["smelter", "assembler", "lab"], recipe: [null, "sci_red", null], noRoute: true });
  if (!sci) { log.push("no science row"); return { log }; }
  const [asm, lab] = machinesOf(st, sci).slice(1);
  const gl = line(st, log, "iron_ore", { machine: ["smelter", "assembler"], recipe: [null, "gear"], target: asm, nearX: asm.x, nearY: asm.y });
  power(st, log, gen, [sci.drill, ...machinesOf(st, sci), ...(gl && gl.drill ? [gl.drill, ...machinesOf(st, gl)] : [])]);
  setResearch(st, "logistics");
  return { log, asm, lab, gearAsm: gl && gl.src };
}

export function run(st, seconds) { for (let i = 0; i < seconds * 60; i++) step(st); st.events.length = 0; }
