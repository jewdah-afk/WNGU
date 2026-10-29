// Factory Universe content spec. Single source of truth for the JS sim, the
// renderer and the generated Luau module (tools/gen-luau-content.mjs).
// All times are in ticks (60 ticks = 1 s). Power in kW. Speeds in permille.

export const TPS = 60;

export const ITEMS = {
  iron_ore:     { name: "Iron Ore",     color: "#8c9bb0" },
  copper_ore:   { name: "Copper Ore",   color: "#d9844a" },
  coal:         { name: "Coal",         color: "#2b2b33" },
  stone:        { name: "Stone",        color: "#b5a58a" },
  iron_plate:   { name: "Iron Plate",   color: "#c9d3de" },
  copper_plate: { name: "Copper Plate", color: "#f0a060" },
  brick:        { name: "Stone Brick",  color: "#c27a5a" },
  gear:         { name: "Gear",         color: "#9fb0c0" },
  wire:         { name: "Copper Wire",  color: "#ffb36b" },
  circuit:      { name: "Circuit",      color: "#5fd07a" },
  sci_red:      { name: "Automation Pack", color: "#e8484f" },
  sci_green:    { name: "Logistic Pack",   color: "#4fd86a" },
};

// Factorio-referenced numbers where they exist (see reference/NOTES.md).
export const RECIPES = {
  iron_plate:   { machine: "smelter",   time: 192, in: { iron_ore: 1 },   out: { iron_plate: 1 } },
  copper_plate: { machine: "smelter",   time: 192, in: { copper_ore: 1 }, out: { copper_plate: 1 } },
  brick:        { machine: "smelter",   time: 192, in: { stone: 2 },      out: { brick: 1 } },
  gear:         { machine: "assembler", time: 30,  in: { iron_plate: 2 }, out: { gear: 1 } },
  wire:         { machine: "assembler", time: 30,  in: { copper_plate: 1 }, out: { wire: 2 }, tech: "electronics" },
  circuit:      { machine: "assembler", time: 30,  in: { iron_plate: 1, wire: 3 }, out: { circuit: 1 }, tech: "electronics" },
  sci_red:      { machine: "assembler", time: 300, in: { copper_plate: 1, gear: 1 }, out: { sci_red: 1 } },
  sci_green:    { machine: "assembler", time: 360, in: { gear: 1, circuit: 1 }, out: { sci_green: 1 }, tech: "logistic_science" },
};

// size = footprint in tiles. power = kW drawn while working (idle draws 10%).
export const BUILDINGS = {
  belt:      { name: "Conveyor",    size: 1, cost: { iron_plate: 1 }, key: "1" },
  drill:     { name: "Mining Drill",size: 2, cost: { iron_plate: 8, gear: 3 }, power: 90, rate: 30, key: "2" },
  smelter:   { name: "Smelter",     size: 2, cost: { iron_plate: 10, brick: 4 }, power: 90, speed: 1000, key: "3" },
  assembler: { name: "Assembler",   size: 2, cost: { iron_plate: 9, gear: 5 }, power: 75, speed: 750, key: "4" },
  generator: { name: "Coal Generator", size: 2, cost: { iron_plate: 10, gear: 5 }, output: 600, key: "5" },
  pole:      { name: "Power Pole",  size: 1, cost: { iron_plate: 1, copper_plate: 1 }, supply: 2, reach: 7, key: "6" },
  lab:       { name: "Research Lab",size: 2, cost: { copper_plate: 10, gear: 10 }, power: 60, key: "7" },
  solar:     { name: "Solar Array", size: 2, cost: { iron_plate: 10, copper_plate: 10, circuit: 5 }, output: 60, tech: "solar", key: "8" },
  hub:       { name: "Core Hub",    size: 3, cost: null, output: 150 }, // also acts as a pole
};

// Drill rate: ore per minute at richness 1000 (0.5/s, Factorio electric drill).
// Coal: 4 MJ per unit (Factorio value).
export const COAL_KJ = 4000;

// Belt: 256 positions per tile, 64 min spacing, 8 positions/tick base (Factorio).
export const BELT = { len: 256, gap: 64, baseSpeed: 8, speedPerLevel: 4, maxSpeed: 32 };

// cost(level): c = base*1000, then c = floor(c*growth/1000) per level, units = floor(c/1000); each unit consumes one of
// each listed pack and takes `time` ticks in one lab.
export const TECHS = {
  logistics:        { name: "Belt Logistics",     packs: ["sci_red"],              base: 10, growth: 2000, time: 300, max: 6, effect: "belt_speed" },
  electronics:      { name: "Electronics",        packs: ["sci_red"],              base: 20, growth: 1000, time: 300, max: 1, effect: "unlock" },
  solar:            { name: "Solar Energy",       packs: ["sci_red"],              base: 30, growth: 1000, time: 300, max: 1, effect: "unlock", req: "electronics" },
  logistic_science: { name: "Logistic Science",   packs: ["sci_red"],              base: 40, growth: 1000, time: 300, max: 1, effect: "unlock", req: "electronics" },
  mining_prod:      { name: "Mining Productivity",packs: ["sci_red", "sci_green"], base: 25, growth: 1600, time: 600, max: 0, effect: "mining", req: "logistic_science" },
  overclock:        { name: "Machine Overclock",  packs: ["sci_red", "sci_green"], base: 25, growth: 1700, time: 600, max: 0, effect: "speed",  req: "logistic_science" },
  steam:            { name: "High-Pressure Steam",packs: ["sci_red"],              base: 25, growth: 1800, time: 300, max: 5, effect: "power" },
};

export const START_STOCK = { iron_plate: 160, gear: 40, copper_plate: 40, brick: 24, coal: 0 };

export const ORES = ["iron_ore", "copper_ore", "coal", "stone"];
