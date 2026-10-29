# Technique ledger

Verified, reusable techniques with where they live and how they were
checked. Status: **verified** (measured here), **adopted** (in use, partly
measured), **candidate** (backlog). Provenance says what is established
elsewhere versus specific to this project.

| Technique | Status | Where | Evidence | Provenance |
|---|---|---|---|---|
| Analytic iso ray casting of part-list genomes at native pixel resolution | verified | `engine/pixel/raster.js` | EXP-001 | Pre-rendered sprites are old practice; this combination is project-specific |
| Hue-shifted 6-step material ramps (shadows → 245°, highlights → 55°) | verified | `makeRamp` | EXP-001: 2–16× fewer colours | Standard pixel-art practice |
| Selective outline: silhouette = own darkest ramp step, creases from depth jumps between parts | verified | `bake` outline pass | EXP-001: ~2× silhouette contrast | Standard practice; depth-based crease detection is common in NPR |
| Gameplay-bound genome animation (`spin`, `move`, `when: on/off`) | adopted | `art.js`, client `anim` map | Frames advance only when the sim says the machine works, scaled by power satisfaction | Project-specific binding |
| Factorio belt model: 256 positions/tile, 64 gap, 8 per tick | verified | `engine/sim/factory.js` | sim test: 7.5 items/s | Factorio wiki (reference/NOTES.md) |
| Downstream-first belt update order | verified | `rebuildBeltOrder` | EXP-002: 6.7 → 7.5 items/s | Common in belt sims |
| Proportional brownout with solar-first priority | verified | `stepPower` | sim test | Factorio wiki electric system |
| Commands as data + integer sim + state hash | verified (JS) | `applyCommand`, `stateHash` | determinism + save/load + replay tests | Lockstep RTS networking, well established |
| Arithmetic-only trig for cross-runtime world gen | verified (JS) | `dsin`/`dcos` | EXP-003 | Known determinism practice |
| Palette + RLE sprite modules for Roblox, opaque spans blitted with `buffer.copy` | adopted | `tools/gen-roblox.mjs`, `Atlas.luau` | EXP-004 size; runtime unmeasured | Pattern follows cursed-survivors' strip blitter |
| Playtest bot through player commands | verified | `qa/bot.mjs` | found 4 design/code bugs (registry FAIL-004, pole coverage, line collision, cost-blind pole placement) | Standard automated playtesting |
| Real-browser visual QA with pixel baselines | verified | `qa/shoot.mjs`, `qa/visual-diff.mjs` | 11 checks; diff detects a 0.04-tile radius change | Standard visual regression testing |
| Dithered pixel particles (Bayer-thresholded discs) | adopted | `drawParticles` | visual review | Standard |
