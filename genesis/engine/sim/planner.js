// Layout planner: spot search, belt routing (BFS) and pole chaining.
// Used by the autonomous playtest bot (qa/) and the in-game auto-route tool.
import { DX, DY, T_WATER, T_ROCK, entAt, frontTiles, footprint, canBuild, build } from "./factory.js";

function free(st, x, y) {
  if (x < 0 || y < 0 || x >= st.W || y >= st.H) return false;
  const i = y * st.W + x;
  return !st.occ[i] && st.terrain[i] !== T_WATER && st.terrain[i] !== T_ROCK;
}

// tiles that something already outputs into; a belt there would get unwanted input
function claimedTiles(st, except) {
  const s = new Set();
  for (const id of st.order) {
    const e = st.ents.get(id);
    if (e === except) continue;
    if (e.type === "belt") s.add((e.y + DY[e.dir]) * st.W + e.x + DX[e.dir]);
    else if (["drill", "smelter", "assembler"].includes(e.type)) for (const [x, y] of frontTiles(e)) s.add(y * st.W + x);
  }
  return s;
}

// Nearest top-left (x,y) to (cx,cy) where `type` fits and `ok(x,y)` holds.
export function findSpot(st, type, cx, cy, ok = () => true, maxR = 40, ignoreCost = true) {
  for (let r = 0; r <= maxR; r++) {
    let best = null, bd = 1e9;
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
      if (!canBuild(st, type, x, y, ignoreCost) && ok(x, y)) {
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d < bd) { bd = d; best = [x, y]; }
      }
    }
    if (best) return best;
  }
  return null;
}

export function fullyOnOre(st, x, y, size, ore) {
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) if (st.ore[(y + j) * st.W + x + i] !== ore) return false;
  return true;
}

// BFS belt path from the free tile `start` to any free tile adjacent to `target`.
// Returns [{x,y,dir}] with the last belt pointing into the target, or null.
export function routeBelt(st, start, target, source = null) {
  const W = st.W, claimed = claimedTiles(st, source);
  const tset = new Set(footprint(st, target.type, target.x, target.y).map(([x, y]) => y * W + x));
  const s0 = start[1] * W + start[0];
  if (!free(st, start[0], start[1])) return null;
  const prev = new Map([[s0, -1]]), q = [s0];
  while (q.length) {
    const c = q.shift(), cx = c % W, cy = (c - cx) / W;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d], n = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= st.H) continue;
      if (tset.has(n)) {
        const path = [];
        let k = c, dir = d;
        while (k !== -1) {
          const kx = k % W, ky = (k - kx) / W;
          path.unshift({ x: kx, y: ky, dir });
          const p = prev.get(k);
          if (p !== -1) { const px = p % W, py = (p - px) / W; dir = kx > px ? 0 : ky > py ? 1 : kx < px ? 2 : 3; }
          k = p;
        }
        return path;
      }
      if (prev.has(n) || !free(st, nx, ny) || (claimed.has(n) && n !== s0)) continue;
      prev.set(n, c); q.push(n);
    }
  }
  return null;
}

export function buildPath(st, path) {
  for (const p of path) { const r = build(st, "belt", p.x, p.y, p.dir); if (!r.ok) return r; }
  return { ok: true };
}

// Place poles from entity a to entity b, each within reach of the last.
export function poleChain(st, a, b, place = (x, y) => build(st, "pole", x, y).ok) {
  const reach = st.content.BUILDINGS.pole.reach;
  const ac = [a.x + (a.size >> 1), a.y + (a.size >> 1)], bc = [b.x + (b.size >> 1), b.y + (b.size >> 1)];
  const placed = [];
  let cur = findSpot(st, "pole", ac[0], ac[1], (x, y) => Math.max(Math.abs(x - ac[0]), Math.abs(y - ac[1])) <= 2 + (a.size >> 1), 4);
  if (!cur) return null;
  if (!place(cur[0], cur[1])) return null;
  placed.push(cur);
  for (let guard = 0; guard < 30; guard++) {
    const sup = st.content.BUILDINGS.pole.supply;
    const near = b.x - sup <= cur[0] && cur[0] <= b.x + b.size - 1 + sup && b.y - sup <= cur[1] && cur[1] <= b.y + b.size - 1 + sup;
    if (near) return placed;
    const dx = bc[0] - cur[0], dy = bc[1] - cur[1], len = Math.sqrt(dx * dx + dy * dy);
    const stepL = Math.min(reach - 1, len);
    const tx = Math.round(cur[0] + dx / len * stepL), ty = Math.round(cur[1] + dy / len * stepL);
    const nxt = findSpot(st, "pole", tx, ty, (x, y) => (x - cur[0]) ** 2 + (y - cur[1]) ** 2 <= reach * reach && !claimedTiles(st).has(y * st.W + x), 3);
    if (!nxt) return null;
    if (!place(nxt[0], nxt[1])) return null;
    placed.push(nxt); cur = nxt;
  }
  return null;
}

export function dirToward(fx, fy, tx, ty) {
  const dx = tx - fx, dy = ty - fy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 2;
  return dy >= 0 ? 1 : 3;
}

export function patchCentre(st, ore, nearX, nearY) {
  let best = null, bd = 1e9;
  for (let y = 0; y < st.H - 1; y++) for (let x = 0; x < st.W - 1; x++) {
    if (!fullyOnOre(st, x, y, 2, ore)) continue;
    const d = (x - nearX) ** 2 + (y - nearY) ** 2;
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}

export { entAt };
