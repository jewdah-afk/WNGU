# Genesis architecture

Genesis turns a game concept into a playable build by keeping **one data
source of truth** per game and making every other artefact (sim, sprites,
Roblox modules, tests, screenshots, benchmarks) a deterministic function of
it. AI judgement is spent only where measurement can't decide: design,
visual review and choosing the next experiment. Everything measurable is a
script.

```
 concept ─► spec (content.js, art.js)  ── single source of truth
              │
              ├─► engine/sim      deterministic, integer, command-driven ─┬─► HTML client (games/*/main.js)
              │                                                       └─► tools/gen-roblox ─► Luau Sim + Content
              ├─► engine/pixel    genome ray caster ─► sprites ─────────┬─► HTML client
              │                                                       └─► tools/gen-roblox ─► AtlasData (RLE)
              └─► qa/             bot playtests · node tests · Playwright shots · visual diff · bench
                                        │
                                        ▼
                         experiments/ (results JSON, incl. failures) ─► knowledge/techniques.md
```

## Components and why each exists

| Component | Path | Purpose | Measured output |
|---|---|---|---|
| Spec | `games/<game>/content.js`, `art.js` | Items, recipes, buildings, techs; genomes for every visual. Plain data. | Generated Luau modules diff cleanly |
| Sim core | `engine/sim/factory.js` | Deterministic 60 Hz factory sim: belts, drills, machines, power with brownout, labs. Integer math, id-order updates, commands as data. | `qa/sim.test.mjs` (Factorio-referenced rates), ms/tick, state hash |
| Planner | `engine/sim/planner.js` | Spot search, BFS belt routing, pole chaining. | Used by the bot; failures surface as test failures |
| Playtest bot | `qa/bot.mjs` | Builds a factory through the same commands a player uses, waits for resources, sets research. | Time-to-milestone per seed; found 4 real bugs (below) |
| Pixel engine | `engine/pixel/raster.js` | Analytic isometric ray caster over part-list genomes; hue-shifted ramps, ordered dither, selective outlines, cast + contact shadows. | EXP-001: bake ms, colours, silhouette contrast, bytes |
| HTML client | `games/factory-universe/` | Playable prototype: render, input, HUD, VFX from sim state, procedural SFX. | Playwright checks + screenshots, frame ms |
| Roblox slice | `games/factory-universe/roblox/` | Luau mirror of the sim, lockstep netcode, EditableImage compositor, native HUD. | `tests/parity.luau` (needs Lune), on-screen perf line |
| Generators | `tools/gen-roblox.mjs` | Emits Content, AtlasData and the parity fixture from the JS sources. | Fixture replay proves JS determinism before export |
| Lab | `lab/` | Interactive genome workbench: live bake, stage ablation, interactive evolution, JSON edit, ramps. | Per-variant bake ms and colour counts |
| QA harness | `qa/` | `sim.test.mjs`, `shoot.mjs` (real browser), `visual-diff.mjs` (known-good baseline), `bench.mjs`. | Pass/fail + PNGs + JSON |
| Registry | `experiments/` | Hypothesis, method, numbers, verdict for every experiment, failures included. | `registry.json`, `results/` |
| Ledger | `knowledge/techniques.md` | Reusable techniques with provenance and status (established / experimental / unverified). | — |

## Coordination

- **One orchestrator, many deterministic workers.** The orchestrating
  session designs, reads screenshots and decides. Workers are plain scripts
  with exit codes. Sub-agents are used only for independent fetches (the
  reference research) so their output stays out of the main context.
- **Commands as data.** `applyCommand(st, [name, ...args])` is the only way
  to change a world. The same stream drives the HTML client, the bot, save
  replays, the Luau parity fixture and the Roblox network protocol.
- **Determinism as an interface.** Integer arithmetic, Park-Miller RNG,
  arithmetic-only `dsin/dcos`, explicit key orders and downstream-first belt
  order make `stateHash` equal across runs and (by construction) runtimes.
  That one property buys lockstep multiplayer, save/load verification,
  replay debugging and cross-language parity tests.
- **Known-good and rollback.** `qa/baselines/contact.png` is the visual
  baseline; `qa/visual-diff.mjs --accept` promotes a reviewed change. Git
  tags `known-good-*` mark builds whose full QA passed.

## The autonomous experiment loop

1. Write the hypothesis in `experiments/registry.json` (status `planned`).
2. Implement candidates behind options, not forks (`bake(genome, opts)`).
3. A bench script measures every variant against a baseline and writes
   `experiments/results/<id>.json` plus a contact sheet.
4. Inspect the images (objective metrics never override visual review).
5. Record the verdict, including negative results, and promote what
   survives into `knowledge/techniques.md`.
6. Keep the variant switchable so regressions can be re-measured.

## Generalising beyond Factory Universe

Reusable as-is: `engine/pixel` (any isometric game), `qa/` harness patterns
(`window.__<game>` hooks, visual diff, bench), `tools/png.mjs`, the
generator approach, the lockstep protocol. Genre module: `engine/sim/factory.js`
covers factory/automation games; a roguelike or tower-defence needs its own
sim module, but it should follow the same rules (integer, command-driven,
hashable) so the rest of the pipeline applies unchanged.

## Deliberately not built

No fixed number of agents or pipelines, no prompt hierarchy, no
orchestration framework. Each would add coordination cost without a metric
it improves. Add a component only when a measured bottleneck needs it.
