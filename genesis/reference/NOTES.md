# Reference research notes

Images in `reference/img/` are third-party screenshots kept for private
visual study only. They are git-ignored and must not be redistributed.

## Sources read (2026-10-29)

All 13 pages fetched successfully. One gap: the Factorio Research page was
cut off mid-page, so per-unit pack costs and times were not verified there.

**Factorio wiki.** Transport belts: 256 positions per tile, 64 between items,
4 items per lane per tile, 8/16/24/32 positions per tick for basic, fast,
express and turbo. Basic belt: 1.875 tiles/s, 7.5 items/s per lane.
Electric mining drill: 0.5/s, 90 kW. Stone furnace: crafting speed 1, iron
plate 0.3125/s. Assembler 1: speed 0.5, 75 kW. Gear: 2 plates, 0.5 s.
Circuit: 3 cable + 1 plate, 0.5 s. Steam engine 900 kW. Brownout: "all
machines will slow down proportionally to the power available"; solar
generates first. Research: labs holding one unit's packs consume them and
progress; T = T0·P / (L·S).

**Shapez 2** (site + Steam): "all buildings are free, resources never run
out and there are no enemies or time limits"; animated open buildings so
you "see exactly what's happening inside"; multi-layer factories; placing
hundreds of buildings with one click; blueprints; undo/redo.

## What Factory Universe took (principles, not assets)

1. **Neutral bodies, saturated accents.** Shapez 2 machines are dark grey
   with orange/blue function colour. Our machines use steel/dark bodies with
   one accent material per machine type (orange drill, blue assembler, brick
   smelter, copper generator).
2. **Quiet belts, loud items.** Belts are dark and low-contrast; items are
   the brightest thing on them (FAIL-003 is the counter-example we hit).
3. **Visible internal state.** Factorio labs show the packs they hold; Shapez
   opens buildings up. Our machines animate only while the sim says they
   work, smelter mouths and chimneys light only while smelting, and
   unpowered/brownout machines show a bolt icon.
4. **Free-ish building, infinite resources.** Deposits never deplete
   (richness grows with distance) and removing refunds 100 %, which keeps
   the incremental loop about throughput, not scarcity.
5. **Factorio's numbers as the calibration baseline** for belts, drills,
   smelting and brownout, so the sim can be tested against known values.
   Assembler speed (0.75) and the hub's built-in power are deliberate
   departures.

## Not studied in this pass

Noita, Octopath Traveler II, The Last Night and Hyper Light Drifter were in
the brief, but no pages for them were fetched in this session. Their
principles (per-pixel material simulation; HD-2D lighting; cinematic
pixel lighting; limited coherent palettes) informed the backlog (EXP-009,
EXP-010), but no claims about their techniques are recorded here.
