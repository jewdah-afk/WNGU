# Genesis

A game-generation and graphics-research workbench. Its first game is **Factory Universe**,
an isometric pixel-art factory game. It has a playable browser prototype
and a Roblox vertical slice, both built from the same spec. See
[ARCHITECTURE.md](ARCHITECTURE.md) for how the parts fit.

## Run it

```sh
cd genesis
npx http-server -p 8080 -c-1 .        # or any static server
# play:      http://localhost:8080/games/factory-universe/index.html
#            ?bot=300  lets the playtest bot build a factory and run 5 sim-minutes
#            ?fresh=1  ignore the autosave   ?seed=N  another world
# lab:       http://localhost:8080/lab/index.html
```

Controls: `1`-`8` pick a building, click or drag to place (belts follow
the drag), `R` rotate, right-click or `X` remove, `Esc` inspect mode,
`T` research, `WASD` or middle-drag to pan, wheel to zoom, `P` pause.
Speed buttons 1x/2x/4x sit next to the toolbar.

## Verify it

| Command | What it proves |
|---|---|
| `node --test qa/*.test.mjs` | 9 sim tests: seeded world gen, Factorio belt/smelter rates, brownout, determinism, save/load replay, research, bot playtest on seeds 1-5 |
| `node qa/shoot.mjs` | Real Chromium: boot, key+click build, right-click remove, bot factory delivering, real-time sim, frame cost, inspector, research, belt close-up, lab; screenshots to `qa/out/` |
| `node qa/visual-diff.mjs` | Every sprite re-baked and compared pixel for pixel with `qa/baselines/contact.png` |
| `node qa/bench.mjs` | EXP-001 ablation + sim throughput -> `experiments/results/` |
| `node tools/gen-roblox.mjs` | Regenerates the Roblox Content/AtlasData/Fixture modules and checks the JS replay |

## Status (2026-10-29)

**Working and verified here.**
- 64×64 procedural world: water, sand, rock, 14 infinite ore deposits.
  Richness grows with distance from the hub.
- Drills, belts, smelters, assemblers (8 recipes), coal generators, solar,
  poles, labs and 7 techs (3 infinite).
- Power networks with proportional brownout. The Core Hub is the item sink,
  the build bank and a 150 kW pole.
- Browser client: genome-baked sprites in 4 facings with power-state and
  animation frames, state-driven smoke/sparks/dust/embers, a hub beam that
  scales with delivery rate, MST pole wires, ghost placement, inspector,
  research panel, toasts and procedural Web Audio SFX with a factory hum.
- Measured at 1600×900: 61 fps, 3.6 ms frame. Sim: 1,641 entities in
  0.07 ms/tick.

**Implemented, not executed.** The Roblox slice (`games/factory-universe/roblox`).
Neither Lune nor Luau could be installed in the build container, so no Luau
line has run yet. See that folder's README for the first-run checklist.

**Not done yet.** Roblox SFX (that needs real sound assets), the water
animation on Roblox, gamepad input, splitters and undergrounds, blueprints,
the frontier backlog (EXP-006+).
