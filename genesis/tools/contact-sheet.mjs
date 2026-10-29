// Bakes every genome (4 facings, on/off) and writes a zoomed contact sheet.
// Usage: node tools/contact-sheet.mjs [out.png] [scale]
import fs from "node:fs";
import { bake } from "../engine/pixel/raster.js";
import { GENOMES, ITEM_GENOMES, TILE_GENOMES, oreGenome } from "../games/factory-universe/art.js";
import { Surface } from "./png.mjs";

const out = process.argv[2] || "qa/out/contact.png", scale = +process.argv[3] || 3;
const cells = [];
for (const k of Object.keys(GENOMES)) for (let d = 0; d < 4; d++) cells.push(bake(GENOMES[k], { dir: d, phase: 0.15, active: d !== 3 }));
for (const k of Object.keys(TILE_GENOMES)) cells.push(bake(TILE_GENOMES[k], { groundShadow: false }));
for (const m of ["ore_iron", "ore_copper", "ore_coal", "ore_stone"]) cells.push(bake(oreGenome(m, 3)));
for (const k of Object.keys(ITEM_GENOMES)) cells.push(bake(ITEM_GENOMES[k], { groundShadow: false }));
const cw = 110, ch = 120, cols = 8;
const S = new Surface(cw * cols * scale, Math.ceil(cells.length / cols) * ch * scale, [52, 70, 48, 255]);
cells.forEach((c, i) => S.blit(c, ((i % cols) * cw + (cw - c.w) / 2 | 0) * scale, (Math.floor(i / cols) * ch + (ch - c.h) / 2 | 0) * scale, scale));
fs.mkdirSync("qa/out", { recursive: true });
fs.writeFileSync(out, S.png());
console.log(out, cells.length, "sprites");
