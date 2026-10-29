// Visual regression: re-bakes the full contact sheet (deterministic) and
// compares it pixel by pixel with the committed known-good baseline.
// Usage: node qa/visual-diff.mjs            compare (exit 1 on change)
//        node qa/visual-diff.mjs --accept   promote the current render to baseline
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { decodePNG, encodePNG } from "../tools/png.mjs";

const BASE = "qa/baselines/contact.png", CUR = "qa/out/contact-current.png", DIFF = "qa/out/contact-diff.png";
fs.mkdirSync("qa/out", { recursive: true });
execFileSync(process.execPath, ["tools/contact-sheet.mjs", CUR, "2"], { stdio: "ignore" });
if (process.argv.includes("--accept") || !fs.existsSync(BASE)) {
  fs.mkdirSync("qa/baselines", { recursive: true });
  fs.copyFileSync(CUR, BASE);
  console.log("baseline written:", BASE);
  process.exit(0);
}
const a = decodePNG(fs.readFileSync(BASE)), b = decodePNG(fs.readFileSync(CUR));
if (a.w !== b.w || a.h !== b.h) { console.log(`FAIL size changed ${a.w}x${a.h} -> ${b.w}x${b.h}`); process.exit(1); }
let changed = 0;
const d = new Uint8ClampedArray(a.px.length);
for (let i = 0; i < a.w * a.h; i++) {
  const same = a.px[i * 4] === b.px[i * 4] && a.px[i * 4 + 1] === b.px[i * 4 + 1] && a.px[i * 4 + 2] === b.px[i * 4 + 2] && a.px[i * 4 + 3] === b.px[i * 4 + 3];
  if (!same) changed++;
  // diff image: changed pixels magenta over a faded copy of the new render
  d[i * 4] = same ? b.px[i * 4] * 0.35 : 255; d[i * 4 + 1] = same ? b.px[i * 4 + 1] * 0.35 : 0; d[i * 4 + 2] = same ? b.px[i * 4 + 2] * 0.35 : 255; d[i * 4 + 3] = 255;
}
fs.writeFileSync(DIFF, encodePNG(a.w, a.h, d));
const pct = (changed / (a.w * a.h) * 100).toFixed(3);
console.log(`${changed ? "FAIL" : "PASS"} ${changed} pixels changed (${pct}%)${changed ? " -> " + DIFF : ""}`);
process.exit(changed ? 1 : 0);
