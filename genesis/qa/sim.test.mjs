// Run: node --test qa/
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../games/factory-universe/content.js";
import { createWorld, step, build, entAt, stateHash, terrainHash, setResearch, beltSpeed, T_WATER } from "../engine/sim/factory.js";
import { starterFactory, scienceBlock, run } from "./bot.mjs";

// clear a flat test strip so layout tests don't depend on terrain
function flat(seed = 1) {
  const st = createWorld(C, { seed });
  for (let y = 2; y < 12; y++) for (let x = 2; x < 40; x++) { const i = y * st.W + x; st.terrain[i] = 0; st.ore[i] = 0; }
  st.stock.iron_plate = 1e6; st.stock.gear = 1e6; st.stock.copper_plate = 1e6; st.stock.brick = 1e6;
  return st;
}

// pole chain from (x,y) on the test strip to the hub's built-in pole
function hubLink(st, x, y) {
  for (const [px, py] of [[x, y], [19, 12], [24, 16], [28, 21], [31, 26]]) { st.terrain[py * 64 + px] = 0; assert.ok(build(st, "pole", px, py).ok); }
}

test("world generation is deterministic and seeded", () => {
  const a = createWorld(C, { seed: 3 }), b = createWorld(C, { seed: 3 }), c = createWorld(C, { seed: 4 });
  assert.equal(terrainHash(a), terrainHash(b));
  assert.notEqual(terrainHash(a), terrainHash(c));
});

test("every seed has all four ores within 14 tiles of the hub and dry land around it", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const st = createWorld(C, { seed });
    const found = new Set();
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const o = st.ore[y * 64 + x];
      if (o && Math.hypot(x - 32, y - 32) <= 14) found.add(o);
      if (Math.hypot(x - 32, y - 32) <= 5) assert.notEqual(st.terrain[y * 64 + x], T_WATER, `water near hub, seed ${seed}`);
    }
    assert.equal(found.size, 4, `seed ${seed} ores ${[...found]}`);
  }
});

test("basic belt carries 7.5 items/s (Factorio basic belt, one lane)", () => {
  const st = flat();
  for (let x = 4; x < 30; x++) build(st, "belt", x, 5, 0);
  const sink = entAt(st, 29, 5);
  let got = 0;
  for (let t = 0; t < 60 * 40; t++) {
    entAt(st, 4, 5).items.length < 4 && (entAt(st, 4, 5).items[entAt(st, 4, 5).items.length - 1]?.pos ?? 99) >= 64 && entAt(st, 4, 5).items.push({ item: "coal", pos: 0, t: -1 });
    step(st);
    if (sink.items[0]?.pos === 256) { sink.items.shift(); if (t >= 60 * 20) got++; }
  }
  const rate = got / 20;
  assert.ok(Math.abs(rate - 7.5) < 0.2, `rate ${rate}`);
});

test("smelter makes 0.3125 plates/s at full power (Factorio stone furnace rate)", () => {
  const st = flat();
  build(st, "smelter", 10, 5, 0);
  build(st, "pole", 9, 5);
  const sm = entAt(st, 10, 5);
  hubLink(st, 14, 8);
  let t0 = null, n0 = 0;
  for (let t = 0; t < 60 * 120; t++) {
    sm.inb.iron_ore = 4; sm.recipe = "iron_plate";
    step(st);
    if (sm.outb.iron_plate) { st.produced.iron_plate; sm.outb.iron_plate = 0; if (t >= 600) { if (t0 === null) t0 = t; n0++; } }
  }
  const rate = (n0 - 1) / ((60 * 120 - t0) / 60);
  assert.ok(Math.abs(rate - 0.3125) < 0.01, `rate ${rate}`);
});

test("brownout slows machines proportionally (Factorio electric system)", () => {
  const st = flat();
  // hub supplies 150 kW. 3 smelters at 90 kW = 270 kW demand -> 555 permille
  hubLink(st, 15, 10);
  for (const x of [12, 14, 16]) build(st, "smelter", x, 7, 0);
  for (let t = 0; t < 10; t++) { for (const x of [12, 14, 16]) { const s = entAt(st, x, 7); s.inb.iron_ore = 4; s.recipe = "iron_plate"; } step(st); }
  const net = st.power.nets[0];
  assert.equal(net.demand, 270);
  assert.equal(net.sat, Math.floor(150 * 1000 / 270));
});

test("same commands give the same state hash (lockstep determinism)", () => {
  const go = () => { const st = createWorld(C, { seed: 5 }); const a = starterFactory(st); run(st, 60); scienceBlock(st, a.gen); run(st, 120); return stateHash(st); };
  assert.equal(go(), go());
});

test("autonomous playtest: starter factory researches Belt Logistics within 10 minutes on seeds 1-5", () => {
  const report = [];
  for (let seed = 1; seed <= 5; seed++) {
    const st = createWorld(C, { seed });
    const a = starterFactory(st);
    run(st, 120);
    const b = scienceBlock(st, a.gen);
    let minute = null;
    for (let m = 1; m <= 8 && minute === null; m++) { run(st, 60); if (st.tech.levels.logistics >= 1) minute = m + 2; }
    report.push({ seed, minute, sat: st.power.nets.map(n => n.sat), fails: [...a.log, ...b.log].filter(l => /FAIL|no /.test(l)) });
  }
  const bad = report.filter(r => r.minute === null);
  assert.equal(bad.length, 0, JSON.stringify(report, null, 1));
});

test("research consumes packs and raises level; belt speed follows", () => {
  const st = flat();
  hubLink(st, 14, 10);
  build(st, "lab", 12, 7, 0);
  const lab = entAt(st, 12, 7);
  setResearch(st, "logistics");
  for (let t = 0; t < 60 * 120 && !st.tech.levels.logistics; t++) { lab.inb.sci_red = 5; step(st); }
  assert.equal(st.tech.levels.logistics, 1);
  assert.equal(st.events.some(e => e.k === "research"), true);
  assert.equal(beltSpeed(st), C.BELT.baseSpeed + C.BELT.speedPerLevel);
});

test("save/load round-trips to the same future state", async () => {
  const { serialize, deserialize } = await import("../engine/sim/factory.js");
  const st = createWorld(C, { seed: 2 });
  const a = starterFactory(st); run(st, 90); scienceBlock(st, a.gen); run(st, 30);
  const copy = deserialize(C, serialize(st));
  run(st, 60); run(copy, 60);
  assert.equal(stateHash(copy), stateHash(st));
});

test("every surface pattern bakes on every primitive kind", async () => {
  const { bake } = await import("../engine/pixel/raster.js");
  const pats = ["rivets", "panel", "grille", "hazard", "stripes", "screw", "belt", "planks", "bricks", "noise", "water", "blades", undefined];
  const prims = [{ box: [0.2, 0.2, 0, 0.8, 0.8, 0.5] }, { cyl: "z", c: [0.5, 0.5, 0.3], r: 0.3, h: 0.2 }, { gear: "x", c: [0.5, 0.5, 0.4], r: 0.3, rin: 0.2, h: 0.05, teeth: 8 }, { sphere: true, c: [0.5, 0.5, 0.3], r: 0.25 }];
  for (const pat of pats) for (const pr of prims) assert.doesNotThrow(() => bake({ size: 1, height: 1, parts: [{ ...pr, mat: "steel", pat }] }), `${pat} on ${Object.keys(pr)[0]}`);
});
