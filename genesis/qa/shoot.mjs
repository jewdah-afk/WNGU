// Visual QA: launches the real game in Chromium, lets the bot build a
// factory, drives input, captures screenshots and fails on console errors.
// Usage: node qa/shoot.mjs [outDir]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "qa/out"));
fs.mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css" };

export function serve(root, port = 0) {
  const srv = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => srv.listen(port, "127.0.0.1", () => r(srv)));
}

const report = { checks: [], errors: [], perf: {}, shots: [] };
const check = (name, ok, detail = "") => { report.checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`); };

const srv = await serve(ROOT);
const base = `http://127.0.0.1:${srv.address().port}/games/factory-universe/index.html`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", m => { if (m.type() === "error") report.errors.push(m.text()); });
page.on("pageerror", e => report.errors.push(String(e)));

async function shot(name) { const f = path.join(OUT, name + ".png"); await page.screenshot({ path: f }); report.shots.push(f); return f; }

// 1. fresh world
await page.goto(base + "?fresh=1&seed=1&zoom=2");
await page.waitForFunction(() => window.__fu && !document.getElementById("loading"), null, { timeout: 30000 });
await page.waitForTimeout(800);
await shot("01-fresh-world");
check("boots without errors", report.errors.length === 0, report.errors.slice(0, 3).join(" | "));
report.perf.bootMs = await page.evaluate(() => window.__fu.perf.bootMs);

// 2. player input: select the drill tool with a key and click on an ore tile
const placed = await page.evaluate(async () => {
  const fu = window.__fu, st = fu.st();
  let target = null;
  for (let y = 20; y < 44 && !target; y++) for (let x = 20; x < 44 && !target; x++) if (!fu.S.canBuild(st, "drill", x, y)) target = [x, y];
  fu.centreOn(target[0] + 1, target[1] + 1);
  return target;
});
await page.keyboard.press("2");
await page.waitForTimeout(100);
const scr = await page.evaluate(([x, y]) => {
  const fu = window.__fu, [sx, sy] = fu.toScreen(x + 1, y + 1);
  const lw = Math.ceil(innerWidth / fu.cam.zoom), lh = Math.ceil(innerHeight / fu.cam.zoom);
  return [(sx - fu.cam.x + lw / 2) * fu.cam.zoom, (sy - fu.cam.y + lh / 2) * fu.cam.zoom];
}, placed);
const before = await page.evaluate(() => window.__fu.st().order.length);
await page.mouse.move(scr[0], scr[1]);
await page.waitForTimeout(100);
await shot("02-ghost-drill");
await page.mouse.click(scr[0], scr[1]);
const after = await page.evaluate(() => window.__fu.st().order.length);
check("keyboard + click places a drill on ore", after === before + 1, `${before} -> ${after}`);
await page.mouse.click(scr[0], scr[1], { button: "right" });
const removed = await page.evaluate(() => window.__fu.st().order.length);
check("right-click removes it and refunds", removed === before, `${after} -> ${removed}`);
await page.keyboard.press("Escape");

// 3. bot-built factory running for 5 sim-minutes
await page.goto(base + "?bot=300&seed=1&zoom=3");
await page.waitForFunction(() => window.__fu && !document.getElementById("loading"), null, { timeout: 60000 });
await page.waitForTimeout(2500);
const s1 = await page.evaluate(() => { const st = window.__fu.st(); return { ents: st.order.length, delivered: Object.values(st.delivered).reduce((a, b) => a + b, 0), lv: st.tech.levels.logistics }; });
check("bot factory delivers items to the hub", s1.delivered > 50, JSON.stringify(s1));
await shot("03-factory-zoom3");
// let it run in real time and check it keeps moving
const d0 = await page.evaluate(() => window.__fu.st().tick);
await page.waitForTimeout(2000);
const d1 = await page.evaluate(() => window.__fu.st().tick);
check("sim advances in real time", d1 - d0 > 90, `${d1 - d0} ticks in 2s`);
await shot("04-factory-later");
report.perf.runtime = await page.evaluate(() => { const p = window.__fu.perf; return { fps: p.fps, frameMs: +p.frameMs.toFixed(2), simMs: +p.simMs.toFixed(2), draws: p.draws, bakes: p.bakes, bakeMs: Math.round(p.bakeMs) }; });
check("frame cost under 16 ms", report.perf.runtime.frameMs < 16, JSON.stringify(report.perf.runtime));

// 4. inspector and research UI
const hubPx = await page.evaluate(() => {
  const fu = window.__fu, st = fu.st(), e = st.ents.get(1);
  fu.centreOn(e.x + 1.5, e.y + 1.5);
  const [sx, sy] = fu.toScreen(e.x + 1.5, e.y + 1.5, 0.5);
  const lw = Math.ceil(innerWidth / fu.cam.zoom), lh = Math.ceil(innerHeight / fu.cam.zoom);
  return [(sx - fu.cam.x + lw / 2) * fu.cam.zoom, (sy - fu.cam.y + lh / 2) * fu.cam.zoom];
});
await page.mouse.click(hubPx[0], hubPx[1]);
await page.waitForTimeout(300);
check("clicking the hub opens the inspector", await page.evaluate(() => document.getElementById("inspect").style.display === "block"));
await page.keyboard.press("t");
await page.waitForTimeout(300);
await shot("05-research-panel");
check("T opens research", await page.evaluate(() => document.getElementById("techs").style.display === "block"));
await page.keyboard.press("Escape");

// 5. close-up on the busiest belt: items must be visible on it
const busy = await page.evaluate(() => {
  const fu = window.__fu, st = fu.st();
  let best = null;
  for (const id of st.order) { const e = st.ents.get(id); if (e.type === "belt" && (!best || e.items.length > best.items.length)) best = e; }
  fu.cam.zoom = 6; fu.centreOn(best.x + 0.5, best.y + 0.5); fu.setPaused(true);
  return { x: best.x, y: best.y, items: best.items.length };
});
await page.waitForTimeout(300);
await shot("07-closeup-belt-zoom6");
check("busiest belt carries items", busy.items > 0, JSON.stringify(busy));
await page.evaluate(() => window.__fu.setPaused(false));

// 6. zoomed-out overview of the whole sector
await page.evaluate(() => { const fu = window.__fu; fu.cam.zoom = 1; fu.centreOn(32, 32); });
await page.waitForTimeout(400);
await shot("06-overview-zoom1");

// 7. the genome lab
await page.goto(base.replace("games/factory-universe/index.html", "lab/index.html"));
await page.waitForFunction(() => window.__lab && document.querySelectorAll("#mutants canvas").length === 6, null, { timeout: 30000 });
await page.click("#mutate");
await page.waitForTimeout(500);
check("lab renders genome, ablation and 6 mutants", await page.evaluate(() => document.querySelectorAll("#ablation canvas").length === 6 && document.querySelectorAll("#mutants canvas").length === 6));
await shot("08-genome-lab");

check("no console errors during session", report.errors.length === 0, report.errors.slice(0, 5).join(" | "));
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
await browser.close(); srv.close();
const failed = report.checks.filter(c => !c.ok).length;
console.log(`${report.checks.length - failed}/${report.checks.length} checks passed; shots in ${OUT}`);
process.exit(failed ? 1 : 0);
