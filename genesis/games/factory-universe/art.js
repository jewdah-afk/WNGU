// Factory Universe genomes. Authored facing +x (the output side). Every
// animated part is bound to a phase the renderer advances from sim state:
// drills spin only while mining, smelter fire only burns while smelting, etc.
//   spin: turns per animation cycle   move: offset vector * wave(phase)
//   when: "on" | "off" parts that exist only in that power state

export const GENOMES = {
  drill: {
    size: 2, height: 2.0,
    parts: [
      { box: [0.08, 0.08, 0, 1.92, 1.92, 0.22], mat: "dark", pat: "panel" },
      { box: [0.2, 0.2, 0.22, 1.5, 1.8, 0.95], mat: "orange", pat: "panel" },
      { box: [0.2, 0.2, 0.95, 1.5, 1.8, 1.05], mat: "hazard", pat: "hazard" },
      { cyl: "z", c: [0.85, 1.0, 1.35], r: 0.36, h: 0.3, mat: "steel", pat: "stripes", spin: 1 },
      { gear: "z", c: [0.85, 1.0, 1.72], r: 0.42, rin: 0.32, h: 0.07, teeth: 10, mat: "brass", spin: 1 },
      { cyl: "z", c: [0.85, 1.0, 1.85], r: 0.12, h: 0.06, mat: "dark" },
      { gear: "y", c: [0.55, 1.86, 0.62], r: 0.3, rin: 0.22, h: 0.06, teeth: 8, mat: "brass", spin: -2 },
      { box: [1.5, 0.6, 0.3, 1.95, 1.4, 0.55], mat: "steel", pat: "rivets" },
      { box: [1.55, 0.7, 0.55, 1.95, 1.3, 0.62], mat: "dark" },
      { sphere: true, c: [0.35, 0.35, 1.12], r: 0.08, mat: "lamp" },
    ],
  },
  smelter: {
    size: 2, height: 2.6,
    parts: [
      { box: [0.06, 0.06, 0, 1.94, 1.94, 0.18], mat: "stone", pat: "noise" },
      { box: [0.15, 0.15, 0.18, 1.7, 1.85, 1.25], mat: "brick", pat: "bricks" },
      { box: [0.1, 0.1, 1.25, 1.75, 1.9, 1.38], mat: "dark", pat: "rivets" },
      { box: [1.7, 0.55, 0.25, 1.82, 1.45, 0.85], mat: "dark" },
      { box: [1.69, 0.68, 0.3, 1.83, 1.32, 0.72], mat: "fire", when: "on" },
      { cyl: "z", c: [0.6, 0.6, 1.9], r: 0.26, h: 0.55, mat: "brick", pat: "bricks" },
      { cyl: "z", c: [0.6, 0.6, 2.46], r: 0.31, h: 0.05, mat: "dark" },
      { cyl: "z", c: [0.6, 0.6, 2.5], r: 0.18, h: 0.03, mat: "fire", when: "on" },
      { box: [1.75, 0.75, 0.05, 1.98, 1.25, 0.25], mat: "steel" },
      { box: [0.9, 0.9, 1.38, 1.55, 1.6, 1.55], mat: "copper", pat: "panel" },
    ],
  },
  assembler: {
    size: 2, height: 2.0,
    parts: [
      { box: [0.06, 0.06, 0, 1.94, 1.94, 0.2], mat: "dark", pat: "panel" },
      { box: [0.15, 0.15, 0.2, 1.85, 1.85, 0.95], mat: "blue", pat: "panel" },
      { box: [0.3, 0.3, 0.95, 1.7, 1.7, 1.02], mat: "steel", pat: "grille" },
      { box: [0.45, 0.45, 1.02, 1.55, 1.55, 1.08], mat: "dark" },
      { cyl: "z", c: [1, 1, 1.2], r: 0.12, h: 0.14, mat: "steel" },
      { box: [0.7, 0.92, 1.3, 1.5, 1.08, 1.4], mat: "orange", move: [-0.35, 0, 0] },
      { cyl: "z", c: [0.6, 1.0, 1.18], r: 0.07, h: 0.12, mat: "steel", move: [0, 0, 0.12] },
      { gear: "x", c: [1.88, 0.55, 0.6], r: 0.25, rin: 0.18, h: 0.05, teeth: 8, mat: "brass", spin: 2 },
      { gear: "x", c: [1.88, 0.98, 0.6], r: 0.2, rin: 0.14, h: 0.05, teeth: 6, mat: "brass", spin: -2.6 },
      { box: [1.85, 1.2, 0.3, 1.96, 1.7, 0.8], mat: "energy", when: "on" },
      { box: [1.85, 1.2, 0.3, 1.96, 1.7, 0.8], mat: "dark", when: "off" },
      { sphere: true, c: [0.3, 0.3, 1.0], r: 0.07, mat: "lamp" },
    ],
  },
  generator: {
    size: 2, height: 2.4,
    parts: [
      { box: [0.05, 0.05, 0, 1.95, 1.95, 0.18], mat: "dark", pat: "panel" },
      { cyl: "x", c: [0.95, 0.85, 0.75], r: 0.55, h: 0.78, mat: "copper", pat: "stripes" },
      { cyl: "x", c: [0.95, 0.85, 0.75], r: 0.6, h: 0.06, mat: "dark" },
      { cyl: "x", c: [0.4, 0.85, 0.75], r: 0.6, h: 0.05, mat: "dark" },
      { cyl: "x", c: [1.5, 0.85, 0.75], r: 0.6, h: 0.05, mat: "dark" },
      { gear: "y", c: [0.8, 1.72, 0.7], r: 0.5, rin: 0.4, h: 0.07, teeth: 14, mat: "steel", spin: 1 },
      { cyl: "y", c: [0.8, 1.8, 0.7], r: 0.12, h: 0.06, mat: "brass" },
      { box: [0.15, 1.45, 0.18, 1.85, 1.62, 0.3], mat: "steel" },
      { cyl: "z", c: [1.55, 1.5, 1.4], r: 0.17, h: 0.85, mat: "dark", pat: "rivets" },
      { box: [1.6, 0.3, 0.2, 1.92, 1.3, 0.6], mat: "dark" },
      { box: [1.88, 0.45, 0.28, 1.94, 1.15, 0.52], mat: "fire", when: "on" },
      { sphere: true, c: [0.2, 0.2, 0.3], r: 0.07, mat: "lamp" },
    ],
  },
  lab: {
    size: 2, height: 2.2,
    parts: [
      { box: [0.06, 0.06, 0, 1.94, 1.94, 0.25], mat: "dark", pat: "panel" },
      { cyl: "z", c: [1, 1, 0.4], r: 0.86, h: 0.15, mat: "steel", pat: "rivets" },
      { sphere: true, c: [1, 1, 0.55], r: 0.78, mat: "glass" },
      { gear: "z", c: [1, 1, 0.72], r: 0.86, rin: 0.8, h: 0.04, teeth: 18, mat: "brass", spin: 0.5 },
      { sphere: true, c: [1, 1, 1.0], r: 0.22, mat: "energy", when: "on" },
      { cyl: "z", c: [1, 1, 1.38], r: 0.06, h: 0.12, mat: "steel" },
      { sphere: true, c: [1, 1, 1.52], r: 0.07, mat: "lamp" },
    ],
  },
  pole: {
    size: 1, height: 2.2,
    parts: [
      { box: [0.4, 0.4, 0, 0.6, 0.6, 1.9], mat: "wood", pat: "planks" },
      { box: [0.2, 0.44, 1.65, 0.8, 0.56, 1.75], mat: "wood" },
      { cyl: "z", c: [0.25, 0.5, 1.82], r: 0.05, h: 0.07, mat: "copper" },
      { cyl: "z", c: [0.75, 0.5, 1.82], r: 0.05, h: 0.07, mat: "copper" },
    ],
  },
  solar: {
    size: 2, height: 1.2,
    parts: [
      { box: [0.1, 0.1, 0, 1.9, 1.9, 0.12], mat: "dark" },
      { box: [0.9, 0.9, 0.12, 1.1, 1.1, 0.45], mat: "steel" },
      { box: [0.12, 0.12, 0.45, 1.88, 1.88, 0.55], mat: "steel" },
      { box: [0.18, 0.18, 0.55, 1.82, 1.82, 0.58], mat: "blue", pat: "grille" },
    ],
  },
  hub: {
    size: 3, height: 3.4,
    parts: [
      { box: [0.05, 0.05, 0, 2.95, 2.95, 0.3], mat: "dark", pat: "panel" },
      { box: [0.2, 0.2, 0.3, 2.8, 2.8, 0.75], mat: "steel", pat: "panel" },
      { box: [0.2, 0.2, 0.75, 2.8, 2.8, 0.82], mat: "hazard", pat: "hazard" },
      { cyl: "z", c: [1.5, 1.5, 1.0], r: 1.0, h: 0.2, mat: "dark", pat: "rivets" },
      { gear: "z", c: [1.5, 1.5, 1.25], r: 0.95, rin: 0.85, h: 0.05, teeth: 24, mat: "brass", spin: 0.25 },
      { cyl: "z", c: [1.5, 1.5, 1.6], r: 0.55, h: 0.35, mat: "steel", pat: "stripes", spin: -0.5 },
      { cyl: "z", c: [1.5, 1.5, 2.4], r: 0.28, h: 0.5, mat: "energy" },
      { cyl: "z", c: [1.5, 1.5, 2.95], r: 0.4, h: 0.05, mat: "dark" },
      { box: [0.25, 0.25, 0.82, 0.55, 0.55, 1.5], mat: "orange", pat: "panel" },
      { box: [2.45, 0.25, 0.82, 2.75, 0.55, 1.5], mat: "orange", pat: "panel" },
      { box: [0.25, 2.45, 0.82, 0.55, 2.75, 1.5], mat: "orange", pat: "panel" },
      { box: [2.45, 2.45, 0.82, 2.75, 2.75, 1.5], mat: "orange", pat: "panel" },
    ],
  },
  belt: {
    size: 1, height: 0.3,
    parts: [
      { box: [0, 0.06, 0, 1, 0.94, 0.16], mat: "dark" },
      { box: [0, 0.12, 0.16, 1, 0.88, 0.2], mat: "rubber", pat: "belt" },
      { box: [0, 0.02, 0.06, 1, 0.1, 0.24], mat: "steel" },
      { box: [0, 0.9, 0.06, 1, 0.98, 0.24], mat: "steel" },
    ],
  },
};

// Items: tiny genomes, centred on (0,0); rendered without ground shadow.
export const ITEM_GENOMES = {
  iron_ore:     { parts: [{ sphere: true, c: [0, 0, 0.1], r: 0.11, mat: "ore_iron", pat: "noise" }, { sphere: true, c: [0.07, -0.05, 0.07], r: 0.07, mat: "ore_iron" }] },
  copper_ore:   { parts: [{ sphere: true, c: [0, 0, 0.1], r: 0.11, mat: "ore_copper", pat: "noise" }, { sphere: true, c: [-0.06, 0.06, 0.07], r: 0.07, mat: "ore_copper" }] },
  coal:         { parts: [{ sphere: true, c: [0, 0, 0.1], r: 0.11, mat: "ore_coal", pat: "noise" }, { sphere: true, c: [0.06, 0.05, 0.06], r: 0.06, mat: "ore_coal" }] },
  stone:        { parts: [{ sphere: true, c: [0, 0, 0.09], r: 0.1, mat: "ore_stone", pat: "noise" }] },
  iron_plate:   { parts: [{ box: [-0.13, -0.13, 0, 0.13, 0.13, 0.06], mat: "steel" }] },
  copper_plate: { parts: [{ box: [-0.13, -0.13, 0, 0.13, 0.13, 0.06], mat: "copper" }] },
  brick:        { parts: [{ box: [-0.14, -0.08, 0, 0.14, 0.08, 0.09], mat: "brick" }] },
  gear:         { parts: [{ gear: "z", c: [0, 0, 0.04], r: 0.14, rin: 0.1, h: 0.04, teeth: 8, mat: "steel" }, { cyl: "z", c: [0, 0, 0.085], r: 0.04, h: 0.01, mat: "dark" }] },
  wire:         { parts: [{ cyl: "z", c: [0, 0, 0.06], r: 0.1, h: 0.06, mat: "copper", pat: "stripes" }, { cyl: "z", c: [0, 0, 0.125], r: 0.04, h: 0.01, mat: "dark" }] },
  circuit:      { parts: [{ box: [-0.13, -0.1, 0, 0.13, 0.1, 0.04], mat: "green", pat: "grille" }, { box: [-0.05, -0.04, 0.04, 0.05, 0.04, 0.07], mat: "dark" }] },
  sci_red:      { parts: [{ cyl: "z", c: [0, 0, 0.07], r: 0.08, h: 0.07, mat: "sci_red" }, { cyl: "z", c: [0, 0, 0.17], r: 0.035, h: 0.04, mat: "glass" }] },
  sci_green:    { parts: [{ cyl: "z", c: [0, 0, 0.07], r: 0.08, h: 0.07, mat: "sci_green" }, { cyl: "z", c: [0, 0, 0.17], r: 0.035, h: 0.04, mat: "glass" }] },
};

// Terrain tiles: one block per tile; variation by seed.
export const TILE_GENOMES = {
  grass: { size: 1, height: 0.1, parts: [{ box: [0, 0, -0.25, 1, 1, 0], mat: "grass", pat: "blades" }] },
  grass2:{ size: 1, height: 0.1, parts: [{ box: [0, 0, -0.25, 1, 1, 0], mat: "grass2", pat: "blades" }] },
  sand:  { size: 1, height: 0.1, parts: [{ box: [0, 0, -0.25, 1, 1, 0], mat: "sand", pat: "noise" }] },
  water: { size: 1, height: 0.1, zmin: -0.3, parts: [{ box: [0, 0, -0.3, 1, 1, -0.12], mat: "water", pat: "water" }] },
  rock:  { size: 1, height: 0.9, parts: [{ box: [0, 0, -0.25, 1, 1, 0.35], mat: "rock", pat: "noise" }, { box: [0.15, 0.2, 0.35, 0.8, 0.85, 0.6], mat: "rock", pat: "noise" }] },
};

// ore scatter: a few lumps sitting on a grass tile, coloured by ore
export function oreGenome(mat, seed) {
  const parts = [];
  let s = seed * 9301 + 49297;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let k = 0; k < 3; k++) {
    const R = 0.11 + r() * 0.07;
    parts.push({ sphere: true, c: [0.2 + r() * 0.6, 0.2 + r() * 0.6, R * 0.35], r: R, mat, pat: "noise" });
  }
  return { size: 1, height: 0.3, parts };
}
