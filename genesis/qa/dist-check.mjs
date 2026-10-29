// Checks the bundled single-file pages (dist/) the way the artifact host
// serves them: wrapped in a minimal skeleton, desktop and phone (touch).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const OUT = "qa/out"; fs.mkdirSync(OUT, { recursive: true });
const wrap = f => {
  const p = path.join(OUT, "wrapped-" + path.basename(f));
  fs.writeFileSync(p, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${fs.readFileSync(f, "utf8")}</body></html>`);
  return "file://" + path.resolve(p);
};
let fails = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n} ${d}`); if (!ok) fails++; };
const browser = await chromium.launch();

for (const [name, ctxOpts] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["phone", devices["iPhone 13"]]]) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e))); page.on("console", m => m.type() === "error" && errs.push(m.text()));
  await page.goto(wrap("dist/factory-universe.html"));
  await page.waitForFunction(() => window.__fu && !document.getElementById("loading"), null, { timeout: 30000 });
  check(`${name}: game boots`, errs.length === 0, errs.join(" | "));
  await page.locator("#bot-go").click();
  await page.waitForFunction(() => window.__fu.st().order.length > 20, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  check(`${name}: bot button builds a factory`, true, `${await page.evaluate(() => window.__fu.st().order.length)} entities`);
  // tap/click to place a belt on an empty tile near the hub
  const tgt = await page.evaluate(() => {
    const fu = window.__fu, st = fu.st();
    for (let r = 4; r < 20; r++) for (let dx = -r; dx <= r; dx++) { const x = 32 + dx, y = 32 + r; if (!fu.S.canBuild(st, "belt", x, y)) { fu.centreOn(x + 0.5, y + 0.5); return [x, y]; } }
  });
  await page.locator('.tool[data-tool="belt"]').click();
  const pt = await page.evaluate(([x, y]) => { const fu = window.__fu, [sx, sy] = fu.toScreen(x + 0.5, y + 0.5); const lw = Math.ceil(innerWidth / fu.cam.zoom), lh = Math.ceil(innerHeight / fu.cam.zoom); return [(sx - fu.cam.x + lw / 2) * fu.cam.zoom, (sy - fu.cam.y + lh / 2) * fu.cam.zoom]; }, tgt);
  const n0 = await page.evaluate(() => window.__fu.st().order.length);
  if (name === "phone") await page.touchscreen.tap(pt[0], pt[1]); else await page.mouse.click(pt[0], pt[1]);
  await page.waitForTimeout(200);
  const n1 = await page.evaluate(() => window.__fu.st().order.length);
  check(`${name}: ${name === "phone" ? "tap" : "click"} places a belt`, n1 === n0 + 1, `${n0} -> ${n1}`);
  await page.locator('.tool[data-tool="belt"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/dist-${name}.png` });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check(`${name}: no horizontal page scroll`, !wide);
  check(`${name}: no errors`, errs.length === 0, errs.join(" | "));
  await ctx.close();
}
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; page.on("pageerror", e => errs.push(String(e)));
  await page.goto(wrap("dist/genome-lab.html"));
  await page.waitForFunction(() => window.__lab && document.querySelectorAll("#mutants canvas").length === 6, null, { timeout: 30000 });
  check("lab bundle renders", errs.length === 0, errs.join(" | "));
  const ph = await (await browser.newContext(devices["iPhone 13"])).newPage();
  await ph.goto(wrap("dist/genome-lab.html"));
  await ph.waitForFunction(() => window.__lab, null, { timeout: 30000 });
  check("lab on phone: no horizontal page scroll", !(await ph.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  await ph.screenshot({ path: `${OUT}/dist-lab-phone.png`, fullPage: false });
}
await browser.close();
process.exit(fails ? 1 : 0);
