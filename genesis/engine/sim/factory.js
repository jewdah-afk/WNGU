// Deterministic factory simulation. Integer math only, fixed 60 Hz tick,
// entities updated in id order, so the Luau port (roblox/src/shared/Sim.luau)
// can reproduce the same state hash tick for tick.
//
// The sim knows nothing about rendering. It emits `events` that the
// presentation layer turns into VFX/SFX, and exposes plain state for drawing.

export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];

const PM = 2147483647; // Park-Miller modulus; all products stay below 2^53.

export function pmNext(s) { return (s * 48271) % PM; }

export function hash2(x, y, seed) {
  let h = ((x + 1) * 374761 + (y + 1) * 668265 + seed * 1013) % PM;
  if (h <= 0) h += PM - 1;
  h = pmNext(pmNext(h));
  return h / PM; // [0,1)
}

function smooth(t) { return t * t * (3 - 2 * t); }

export function valueNoise(x, y, cell, seed) {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  const fx = smooth(x / cell - gx), fy = smooth(y / cell - gy);
  const a = hash2(gx, gy, seed), b = hash2(gx + 1, gy, seed);
  const c = hash2(gx, gy + 1, seed), d = hash2(gx + 1, gy + 1, seed);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

export function fbm(x, y, seed) {
  return valueNoise(x, y, 16, seed) * 0.6 + valueNoise(x, y, 8, seed + 7) * 0.3 + valueNoise(x, y, 4, seed + 13) * 0.1;
}

// terrain codes
export const T_GRASS = 0, T_SAND = 1, T_ROCK = 2, T_WATER = 3;

export function createWorld(content, { W = 64, H = 64, seed = 1 } = {}) {
  const N = W * H;
  const st = {
    W, H, seed, tick: 0, nextId: 1,
    terrain: new Uint8Array(N), ore: new Uint8Array(N), rich: new Uint16Array(N),
    occ: new Int32Array(N), ents: new Map(), order: [],
    stock: {}, delivered: {}, produced: {},
    tech: { levels: {}, current: null, units: 0 },
    power: { nets: [], dirty: true },
    events: [], content,
  };
  for (const k of Object.keys(content.ITEMS)) { st.stock[k] = 0; st.delivered[k] = 0; st.produced[k] = 0; }
  for (const k of Object.keys(content.START_STOCK)) st.stock[k] = content.START_STOCK[k];
  for (const k of Object.keys(content.TECHS)) st.tech.levels[k] = 0;
  genTerrain(st);
  const hc = Math.floor(W / 2) - 1;
  placeRaw(st, "hub", hc, hc, 0);
  return st;
}

function genTerrain(st) {
  const { W, H, seed, content } = st;
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
    const wet = fbm(x, y, seed + 101) + Math.max(0, 1 - d / 16) * 0.5;
    const rock = fbm(x, y, seed + 202);
    let t = T_GRASS;
    if (wet < 0.27) t = T_WATER; else if (wet < 0.32) t = T_SAND;
    else if (rock > 0.74 && d > 12) t = T_ROCK;
    st.terrain[i] = t;
  }
  // ore patches: four guaranteed starter patches, then richer ones further out
  let s = (seed * 7919) % PM || 1;
  const rnd = () => { s = pmNext(s); return s / PM; };
  const patches = [];
  for (let k = 0; k < 4; k++) {
    const ang = (k + rnd() * 0.5) * Math.PI / 2;
    patches.push({ ore: k + 1, x: cx + Math.cos(ang) * 11, y: cy + Math.sin(ang) * 11, r: 3.2 });
  }
  for (let k = 0; k < 10; k++) {
    const ang = rnd() * Math.PI * 2, dist = 17 + rnd() * 12;
    patches.push({ ore: 1 + Math.floor(rnd() * 4), x: cx + Math.cos(ang) * dist, y: cy + Math.sin(ang) * dist, r: 2.6 + rnd() * 2.2 });
  }
  for (const p of patches) {
    const r = Math.ceil(p.r + 2);
    for (let y = Math.floor(p.y) - r; y <= Math.floor(p.y) + r; y++) for (let x = Math.floor(p.x) - r; x <= Math.floor(p.x) + r; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dd = Math.sqrt((x - p.x) * (x - p.x) + (y - p.y) * (y - p.y));
      const edge = p.r * (0.75 + 0.5 * valueNoise(x, y, 3, seed + p.ore * 31));
      if (dd > edge) continue;
      const i = y * W + x;
      st.terrain[i] = T_GRASS;
      st.ore[i] = p.ore;
      const centre = 1 - dd / (edge + 0.001);
      const far = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      st.rich[i] = Math.floor(800 + far * 30 + centre * 600); // permille, infinite deposit
    }
  }
}

// ---------- helpers ----------
const sizeOf = (st, type) => st.content.BUILDINGS[type].size;

export function footprint(st, type, x, y) {
  const s = sizeOf(st, type), out = [];
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) out.push([x + i, y + j]);
  return out;
}

export function frontTiles(e) {
  const s = e.size, out = [];
  for (let k = 0; k < s; k++) {
    if (e.dir === 0) out.push([e.x + s, e.y + k]);
    else if (e.dir === 1) out.push([e.x + k, e.y + s]);
    else if (e.dir === 2) out.push([e.x - 1, e.y + k]);
    else out.push([e.x + k, e.y - 1]);
  }
  return out;
}

export function entAt(st, x, y) {
  if (x < 0 || y < 0 || x >= st.W || y >= st.H) return null;
  const id = st.occ[y * st.W + x];
  return id ? st.ents.get(id) : null;
}

export function techUnlocked(st, tech) { return !tech || st.tech.levels[tech] > 0; }

export function techCost(st, id, level) {
  const t = st.content.TECHS[id];
  let c = t.base * 1000;
  for (let i = 0; i < level; i++) c = Math.floor(c * t.growth / 1000);
  return Math.floor(c / 1000);
}

export function beltSpeed(st) {
  const B = st.content.BELT;
  return Math.min(B.maxSpeed, B.baseSpeed + B.speedPerLevel * st.tech.levels.logistics);
}

function newEnt(st, type, x, y, dir) {
  const e = { id: st.nextId++, type, x, y, dir, size: sizeOf(st, type), working: false, anim: 0 };
  if (type === "belt") e.items = [];
  if (type === "smelter" || type === "assembler") {
    e.recipe = type === "assembler" ? "gear" : null;
    e.inb = {}; e.outb = {}; e.progress = 0; e.alt = 0;
  }
  if (type === "drill") { e.progress = 0; e.out = 0; e.alt = 0; }
  if (type === "generator") { e.fuel = 0; e.energy = 0; e.load = 0; }
  if (type === "lab") { e.inb = {}; e.progress = -1; }
  return e;
}

function placeRaw(st, type, x, y, dir) {
  const e = newEnt(st, type, x, y, dir);
  for (const [tx, ty] of footprint(st, type, x, y)) st.occ[ty * st.W + tx] = e.id;
  st.ents.set(e.id, e); st.order.push(e.id);
  if (type === "drill") {
    // dominant ore under the footprint; ties go to the lower ore code
    const cnt = [0, 0, 0, 0, 0], rs = [0, 0, 0, 0, 0];
    for (const [tx, ty] of footprint(st, type, x, y)) { const o = st.ore[ty * st.W + tx]; cnt[o]++; rs[o] += st.rich[ty * st.W + tx]; }
    let best = 1;
    for (let o = 2; o <= 4; o++) if (cnt[o] > cnt[best]) best = o;
    e.ore = best; e.rich = Math.floor(rs[best] / 4); // empty tiles dilute the rate
  }
  st.power.dirty = true; st.beltsDirty = true;
  return e;
}

// ---------- commands ----------
export function canBuild(st, type, x, y, ignoreCost = false) {
  const B = st.content.BUILDINGS[type];
  if (!B || type === "hub") return "unknown building";
  if (!techUnlocked(st, B.tech)) return "needs research";
  for (const [tx, ty] of footprint(st, type, x, y)) {
    if (tx < 0 || ty < 0 || tx >= st.W || ty >= st.H) return "out of bounds";
    const i = ty * st.W + tx;
    if (st.occ[i]) return "occupied";
    if (st.terrain[i] === T_WATER || st.terrain[i] === T_ROCK) return "blocked terrain";
  }
  if (type === "drill") {
    let n = 0;
    for (const [tx, ty] of footprint(st, type, x, y)) if (st.ore[ty * st.W + tx]) n++;
    if (!n) return "no ore under drill";
  }
  if (!ignoreCost) for (const k of Object.keys(B.cost)) if ((st.stock[k] || 0) < B.cost[k]) return "not enough " + st.content.ITEMS[k].name;
  return null;
}

export function build(st, type, x, y, dir = 0) {
  const why = canBuild(st, type, x, y);
  if (why) return { ok: false, reason: why };
  const B = st.content.BUILDINGS[type];
  for (const k of Object.keys(B.cost)) st.stock[k] -= B.cost[k];
  const e = placeRaw(st, type, x, y, dir);
  st.events.push({ k: "build", id: e.id, type, x, y });
  return { ok: true, id: e.id };
}

export function remove(st, x, y) {
  const e = entAt(st, x, y);
  if (!e || e.type === "hub") return { ok: false, reason: "nothing removable" };
  const B = st.content.BUILDINGS[e.type];
  for (const k of Object.keys(B.cost)) st.stock[k] += B.cost[k];
  // contents go back to the hub so nothing is lost
  const back = (it, n) => { st.stock[it] += n; };
  if (e.items) for (const it of e.items) back(it.item, 1);
  if (e.inb) for (const k of Object.keys(e.inb)) back(k, e.inb[k]);
  if (e.outb) for (const k of Object.keys(e.outb)) back(k, e.outb[k]);
  if (e.type === "drill" && e.out) back(st.content.ORES[e.ore - 1], e.out);
  if (e.type === "generator") back("coal", e.fuel);
  for (const [tx, ty] of footprint(st, e.type, e.x, e.y)) st.occ[ty * st.W + tx] = 0;
  st.ents.delete(e.id);
  st.order.splice(st.order.indexOf(e.id), 1);
  st.power.dirty = true; st.beltsDirty = true;
  st.events.push({ k: "remove", type: e.type, x: e.x, y: e.y });
  return { ok: true };
}

export function rotate(st, x, y) {
  const e = entAt(st, x, y);
  if (!e || e.type === "hub") return false;
  e.dir = (e.dir + 1) % 4;
  st.beltsDirty = true;
  return true;
}

export function setRecipe(st, id, recipe) {
  const e = st.ents.get(id), R = st.content.RECIPES[recipe];
  if (!e || e.type !== "assembler" || !R || R.machine !== "assembler" || !techUnlocked(st, R.tech)) return false;
  if (e.recipe === recipe) return true;
  for (const k of Object.keys(e.inb)) st.stock[k] += e.inb[k];
  for (const k of Object.keys(e.outb)) st.stock[k] += e.outb[k];
  e.inb = {}; e.outb = {}; e.progress = 0; e.recipe = recipe;
  return true;
}

export function techAvailable(st, id) {
  const t = st.content.TECHS[id];
  if (t.req && !st.tech.levels[t.req]) return false;
  return t.max === 0 || st.tech.levels[id] < t.max;
}

export function setResearch(st, id) {
  if (id !== null && !techAvailable(st, id)) return false;
  if (st.tech.current !== id) st.tech.units = 0;
  st.tech.current = id;
  return true;
}

// ---------- item transfer ----------
function bufCap(n) { return n * 2 + 2; }

function accept(st, e, item, fromDir, overflow) {
  const C = st.content;
  switch (e.type) {
    case "belt": {
      if (fromDir === (e.dir + 2) % 4) return false; // belt faces back into the source
      const pos = overflow;
      const last = e.items[e.items.length - 1];
      if (last && last.pos - pos < C.BELT.gap) return false;
      e.items.push({ item, pos, t: st.tick });
      return true;
    }
    case "smelter": case "assembler": {
      let R = e.recipe ? C.RECIPES[e.recipe] : null;
      if (e.type === "smelter") {
        const idle = !Object.keys(e.inb).some(k => e.inb[k] > 0) && !Object.keys(e.outb).some(k => e.outb[k] > 0) && e.progress === 0;
        if (!R || (idle && !(item in R.in))) {
          R = null;
          for (const k of Object.keys(C.RECIPES)) {
            const r = C.RECIPES[k];
            if (r.machine === "smelter" && item in r.in && techUnlocked(st, r.tech)) { e.recipe = k; R = r; break; }
          }
          if (!R) return false;
        }
      }
      if (!(item in R.in)) return false;
      const have = e.inb[item] || 0;
      if (have >= bufCap(R.in[item])) return false;
      e.inb[item] = have + 1;
      return true;
    }
    case "generator":
      if (item !== "coal" || e.fuel >= 5) return false;
      e.fuel++; return true;
    case "lab": {
      if (item !== "sci_red" && item !== "sci_green") return false;
      if ((e.inb[item] || 0) >= 10) return false;
      e.inb[item] = (e.inb[item] || 0) + 1; return true;
    }
    case "hub":
      st.stock[item]++; st.delivered[item]++;
      return true;
    default: return false;
  }
}

// direction of travel from tile a to adjacent tile b
function dirBetween(ax, ay, bx, by) {
  if (bx > ax) return 0; if (by > ay) return 1; if (bx < ax) return 2; return 3;
}

// push `item` from entity `src` into whatever sits on tile (tx,ty)
function give(st, src, fx, fy, tx, ty, item, overflow) {
  const t = entAt(st, tx, ty);
  if (!t || t === src) return false;
  return accept(st, t, item, dirBetween(fx, fy, tx, ty), overflow);
}

function emitFromMachine(st, e, item) {
  const fronts = frontTiles(e);
  for (let k = 0; k < fronts.length; k++) {
    const idx = (e.alt + k) % fronts.length;
    const [tx, ty] = fronts[idx];
    const [fx, fy] = [tx - DX[e.dir], ty - DY[e.dir]];
    if (give(st, e, fx, fy, tx, ty, item, 0)) { e.alt = (idx + 1) % fronts.length; return true; }
  }
  return false;
}

// ---------- power ----------
function rebuildPower(st) {
  const C = st.content, poles = [];
  // the hub is a pole at its centre tile with its own core supply
  for (const id of st.order) {
    const e = st.ents.get(id);
    if (e.type === "pole") poles.push(e);
    else if (e.type === "hub") poles.push({ id: e.id, x: e.x + 1, y: e.y + 1, hub: e });
  }
  const parent = poles.map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const reach = C.BUILDINGS.pole.reach, sup = C.BUILDINGS.pole.supply;
  for (let i = 0; i < poles.length; i++) for (let j = i + 1; j < poles.length; j++) {
    const dx = poles[i].x - poles[j].x, dy = poles[i].y - poles[j].y;
    if (dx * dx + dy * dy <= reach * reach) { const a = find(i), b = find(j); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
  }
  const nets = [];
  const netOf = new Map();
  for (let i = 0; i < poles.length; i++) {
    const r = find(i);
    if (!netOf.has(r)) { netOf.set(r, nets.length); nets.push({ members: [], poles: [], cap: 0, demand: 0, sat: 1000 }); }
    poles[i].net = netOf.get(r);
    if (poles[i].hub) { poles[i].hub.net = poles[i].net; nets[poles[i].net].members.push(poles[i].id); }
    nets[poles[i].net].poles.push(poles[i].id);
  }
  for (const id of st.order) {
    const e = st.ents.get(id);
    if (e.type === "pole" || e.type === "belt" || e.type === "hub") continue;
    e.net = -1;
    for (const p of poles) {
      if (e.x - sup <= p.x && p.x <= e.x + e.size - 1 + sup && e.y - sup <= p.y && p.y <= e.y + e.size - 1 + sup) { e.net = p.net; break; }
    }
    if (e.net >= 0) nets[e.net].members.push(e.id);
  }
  st.power.nets = nets;
  st.power.dirty = false;
}

function stepPower(st) {
  const C = st.content;
  if (st.power.dirty) rebuildPower(st);
  const steamMul = 1000 + 500 * st.tech.levels.steam;
  for (const net of st.power.nets) {
    let demand = 0, solar = 0, gens = [];
    for (const id of net.members) {
      const e = st.ents.get(id);
      const P = C.BUILDINGS[e.type].power;
      if (P) demand += e.wantsWork ? P : Math.floor(P / 10);
      if (e.type === "solar") solar += C.BUILDINGS.solar.output;
      if (e.type === "hub") solar += C.BUILDINGS.hub.output;
      if (e.type === "generator" && (e.energy > 0 || e.fuel > 0)) gens.push(e);
    }
    const genCap = Math.floor(C.BUILDINGS.generator.output * steamMul / 1000);
    const cap = solar + gens.length * genCap;
    net.cap = cap; net.demand = demand;
    net.sat = demand === 0 ? 1000 : Math.min(1000, Math.floor(cap * 1000 / demand));
    // solar first, generators share the rest equally (Factorio priority order)
    let rest = Math.max(0, Math.min(demand, cap) - solar);
    for (let g = 0; g < gens.length; g++) {
      const e = gens[g];
      const share = g === gens.length - 1 ? rest : Math.floor(rest / (gens.length - g));
      rest -= share;
      e.load = share;
      if (e.energy < share && e.fuel > 0) { e.fuel--; e.energy += C.COAL_KJ * 60; st.events.push({ k: "burn", id: e.id }); }
      e.energy = Math.max(0, e.energy - share);
    }
  }
}

function satOf(st, e) {
  if (e.net === undefined || e.net < 0) return 0;
  return st.power.nets[e.net].sat;
}

// Belts update downstream-first (sorted by distance to the end of their chain,
// then id) so an item leaving a tile frees space before the tile behind moves.
function rebuildBeltOrder(st) {
  const belts = [], dist = new Map();
  for (const id of st.order) { const e = st.ents.get(id); if (e.type === "belt") belts.push(e); }
  for (const b of belts) {
    let d = 0, cur = b;
    const seen = new Set();
    while (true) {
      seen.add(cur.id);
      const nx = entAt(st, cur.x + DX[cur.dir], cur.y + DY[cur.dir]);
      if (!nx || nx.type !== "belt" || nx.dir === (cur.dir + 2) % 4) break;
      if (seen.has(nx.id)) { d = 1e9; break; }
      if (dist.has(nx.id)) { d += 1 + dist.get(nx.id); break; }
      d++; cur = nx;
    }
    dist.set(b.id, d);
  }
  belts.sort((a, b) => (dist.get(a.id) - dist.get(b.id)) || (a.id - b.id));
  st.beltOrder = belts.map(b => b.id);
  st.beltsDirty = false;
}

function stepBelt(st, e, speed, L, G) {
  const items = e.items;
  let cap = L;
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (it.t === st.tick) { cap = it.pos - G; continue; }
    let np = Math.min(it.pos + speed, cap);
    if (k === 0 && np >= L) {
      const tx = e.x + DX[e.dir], ty = e.y + DY[e.dir];
      const over = Math.min(np - L, G - 1);
      if (give(st, e, e.x, e.y, tx, ty, it.item, over)) { items.shift(); k--; cap = L; continue; }
      np = L;
    }
    if (np < it.pos) np = it.pos;
    it.pos = np;
    cap = np - G;
  }
  e.working = items.length > 0;
}

// ---------- tick ----------
export function step(st) {
  const C = st.content;
  stepPower(st);
  const speed = beltSpeed(st), L = C.BELT.len, G = C.BELT.gap;
  const mineMul = 1000 + 100 * st.tech.levels.mining_prod;
  const clockMul = 1000 + 150 * st.tech.levels.overclock;

  if (st.beltsDirty !== false) rebuildBeltOrder(st);
  for (const id of st.beltOrder) stepBelt(st, st.ents.get(id), speed, L, G);
  for (const id of st.order) {
    const e = st.ents.get(id);
    if (!e) continue;
    switch (e.type) {
      case "belt": break;
      case "drill": {
        e.wantsWork = e.out === 0;
        const sat = satOf(st, e);
        e.working = false;
        if (e.out === 0 && sat > 0) {
          e.progress += Math.floor(e.rich * mineMul / 1000 * sat / 1000);
          e.working = true;
          const need = (3600 / C.BUILDINGS.drill.rate) * 1000;
          if (e.progress >= need) { e.progress -= need; e.out = 1; st.produced[C.ORES[e.ore - 1]]++; }
        }
        if (e.out > 0 && emitFromMachine(st, e, C.ORES[e.ore - 1])) e.out = 0;
        break;
      }
      case "smelter": case "assembler": {
        const R = e.recipe ? C.RECIPES[e.recipe] : null;
        e.working = false; e.wantsWork = false;
        if (R) {
          let room = true;
          for (const k of Object.keys(R.out)) if ((e.outb[k] || 0) + R.out[k] > bufCap(R.out[k])) room = false;
          let ready = e.progress > 0;
          if (!ready) { ready = true; for (const k of Object.keys(R.in)) if ((e.inb[k] || 0) < R.in[k]) ready = false; }
          if (ready && room) {
            e.wantsWork = true;
            const sat = satOf(st, e);
            if (sat > 0) {
              if (e.progress === 0) for (const k of Object.keys(R.in)) e.inb[k] -= R.in[k];
              e.progress += Math.max(1, Math.floor(C.BUILDINGS[e.type].speed * clockMul / 1000 * sat / 1000));
              e.working = true;
              if (e.progress >= R.time * 1000) {
                e.progress = 0;
                for (const k of Object.keys(R.out)) { e.outb[k] = (e.outb[k] || 0) + R.out[k]; st.produced[k] += R.out[k]; }
                st.events.push({ k: "craft", id: e.id, item: Object.keys(R.out)[0] });
              }
            }
          }
          for (const k of Object.keys(R.out)) if ((e.outb[k] || 0) > 0 && emitFromMachine(st, e, k)) e.outb[k]--;
        }
        break;
      }
      case "lab": {
        const cur = st.tech.current;
        e.working = false; e.wantsWork = false;
        if (!cur) break;
        const T = C.TECHS[cur];
        if (e.progress < 0) {
          let ok = true;
          for (const p of T.packs) if (!(e.inb[p] > 0)) ok = false;
          if (ok) { for (const p of T.packs) e.inb[p]--; e.progress = 0; }
        }
        if (e.progress >= 0) {
          e.wantsWork = true;
          const sat = satOf(st, e);
          if (sat > 0) {
            e.working = true;
            e.progress += Math.floor(1000 * sat / 1000);
            if (e.progress >= T.time * 1000) {
              e.progress = -1;
              st.tech.units++;
              if (st.tech.units >= techCost(st, cur, st.tech.levels[cur])) {
                st.tech.levels[cur]++; st.tech.units = 0;
                st.events.push({ k: "research", tech: cur, level: st.tech.levels[cur] });
                if (!techAvailable(st, cur)) st.tech.current = null;
                break;
              }
            }
          }
        }
        break;
      }
      case "generator":
        e.working = e.load > 0;
        break;
      case "solar":
        e.working = e.net >= 0;
        break;
    }
  }
  st.tick++;
}

// Order-sensitive state hash with exact integer arithmetic (portable to Luau).
export function stateHash(st) {
  const M = 2147483629;
  let h = 7;
  const mix = v => { h = (h * 31 + (v % M + M) % M) % M; };
  mix(st.tick);
  for (const id of st.order) {
    const e = st.ents.get(id);
    mix(e.id); mix(e.x); mix(e.y); mix(e.dir);
    if (e.items) for (const it of e.items) mix(it.pos);
    if (e.progress !== undefined) mix(e.progress);
    if (e.inb) for (const k of Object.keys(e.inb).sort()) mix(e.inb[k]);
    if (e.outb) for (const k of Object.keys(e.outb).sort()) mix(e.outb[k]);
    if (e.fuel !== undefined) { mix(e.fuel); mix(e.energy); }
  }
  for (const k of Object.keys(st.stock).sort()) mix(st.stock[k]);
  mix(st.tech.units);
  return h;
}

export function terrainHash(st) {
  const M = 2147483629;
  let h = 7;
  for (let i = 0; i < st.W * st.H; i++) h = (h * 31 + st.terrain[i] * 7 + st.ore[i] * 3 + st.rich[i]) % M;
  return h;
}

// ---------- save / load (JSON; terrain is regenerated from the seed) ----------
export function serialize(st) {
  const ents = st.order.map(id => {
    const e = st.ents.get(id);
    const o = { id: e.id, type: e.type, x: e.x, y: e.y, dir: e.dir };
    for (const k of ["items", "recipe", "inb", "outb", "progress", "alt", "out", "fuel", "energy", "wantsWork", "load"]) if (e[k] !== undefined) o[k] = e[k];
    return o;
  });
  return JSON.stringify({ v: 1, seed: st.seed, W: st.W, H: st.H, tick: st.tick, nextId: st.nextId, ents, stock: st.stock, delivered: st.delivered, produced: st.produced, tech: st.tech });
}

export function deserialize(content, json) {
  const d = typeof json === "string" ? JSON.parse(json) : json;
  const st = createWorld(content, { W: d.W, H: d.H, seed: d.seed });
  st.occ.fill(0); st.ents.clear(); st.order.length = 0;
  for (const o of d.ents) {
    st.nextId = o.id;
    const e = placeRaw(st, o.type, o.x, o.y, o.dir);
    for (const k of Object.keys(o)) if (!["id", "type", "x", "y", "dir"].includes(k)) e[k] = o[k];
  }
  st.nextId = d.nextId; st.tick = d.tick;
  Object.assign(st.stock, d.stock); Object.assign(st.delivered, d.delivered); Object.assign(st.produced, d.produced);
  st.tech = d.tech;
  return st;
}
