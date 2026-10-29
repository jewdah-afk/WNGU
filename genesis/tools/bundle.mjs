// Bundles an HTML page and its ES-module graph into one self-contained file
// (for publishing as an artifact, where only inline scripts may run).
// It handles the import/export forms this repo uses: namespace, named,
// dynamic `await import()`, `export function|class|const|let`, `export { a }`.
// Usage: node tools/bundle.mjs <page.html> <out.html>
import fs from "node:fs";
import path from "node:path";

const [, , pageArg, outArg] = process.argv;
const page = path.resolve(pageArg), root = path.dirname(page);
const mods = new Map(); // abs path -> transformed source

function exportNames(decl) {
  // split `A = 1, B = { ... }, C` at depth-0 commas, keep identifiers before `=`
  const names = []; let depth = 0, cur = "";
  for (const ch of decl) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) { names.push(cur); cur = ""; } else cur += ch;
  }
  names.push(cur);
  return names.map(s => s.split("=")[0].trim()).filter(Boolean);
}

function load(abs) {
  if (mods.has(abs)) return;
  mods.set(abs, null);
  let src = fs.readFileSync(abs, "utf8");
  const exps = [];
  const dep = spec => { const d = path.resolve(path.dirname(abs), spec); load(d); return JSON.stringify(path.relative(root, d)); };
  src = src.replace(/^import \* as (\w+) from "([^"]+)";/gm, (_, n, s) => `const ${n} = __req(${dep(s)});`);
  src = src.replace(/^import \{([^}]+)\} from "([^"]+)";/gm, (_, names, s) => `const {${names.replace(/(\w+) as (\w+)/g, "$1: $2")}} = __req(${dep(s)});`);
  src = src.replace(/await import\("([^"]+)"\)/g, (_, s) => `__req(${dep(s)})`);
  src = src.replace(/^export (async )?function (\w+)/gm, (_, a, n) => { exps.push(n); return `${a || ""}function ${n}`; });
  src = src.replace(/^export class (\w+)/gm, (_, n) => { exps.push(n); return `class ${n}`; });
  // export const/let: find the declaration up to its terminating `;` at depth 0
  src = src.replace(/^export (const|let) /gm, (m, kw, off, all) => {
    let depth = 0, i = off + m.length, j = i;
    for (; j < all.length; j++) { const ch = all[j]; if ("([{".includes(ch)) depth++; else if (")]}".includes(ch)) depth--; else if (ch === ";" && depth === 0) break; }
    exps.push(...exportNames(all.slice(i, j)));
    return `${kw} `;
  });
  src = src.replace(/^export \{([^}]+)\};?/gm, (_, names) => { exps.push(...names.split(",").map(s => s.trim()).filter(Boolean)); return ""; });
  if (/^\s*(import|export)\s/m.test(src)) throw new Error(`unhandled import/export form in ${abs}`);
  mods.set(abs, `__def(${JSON.stringify(path.relative(root, abs))}, function () {\n${src}\nreturn { ${[...new Set(exps)].join(", ")} };\n});`);
}

let html = fs.readFileSync(page, "utf8");
const m = html.match(/<script type="module" src="([^"]+)"><\/script>/);
if (!m) throw new Error("no module script tag");
const entry = path.resolve(root, m[1]);
load(entry);
const runtime = `const __defs = new Map(), __cache = new Map();
function __def(k, f) { __defs.set(k, f); }
function __req(k) { if (!__cache.has(k)) { if (!__defs.has(k)) throw new Error("bundle: missing " + k); __cache.set(k, {}); __cache.set(k, __defs.get(k)()); } return __cache.get(k); }`;
const body = [runtime, ...mods.values(), `__req(${JSON.stringify(path.relative(root, entry))});`].join("\n");
html = html.replace(m[0], () => `<script type="module">\n${body}\n</script>`);
// the artifact host supplies the document skeleton
html = html.replace(/<!doctype html>\s*/i, "").replace(/<html[^>]*>\s*/i, "").replace(/<\/html>\s*$/i, "")
  .replace(/<head>\s*/i, "").replace(/<\/head>\s*/i, "").replace(/<body>\s*/i, "").replace(/<\/body>\s*/i, "")
  .replace(/<meta charset="utf-8">\s*/i, "").replace(/<meta name="viewport"[^>]*>\s*/i, "");
fs.mkdirSync(path.dirname(path.resolve(outArg)), { recursive: true });
fs.writeFileSync(outArg, html);
console.log(`${outArg}: ${mods.size} modules, ${(html.length / 1024).toFixed(0)} KB`);
