# EXP-001 — Genome ray-cast rasterizer: stage ablation

**Status:** verified (2026-10-29, Node v22.22.0, this container's CPU). Re-run: `node qa/bench.mjs`.

**Hypothesis.** Rendering compact part-list genomes with an analytic
isometric ray caster, then quantising onto hue-shifted material ramps with
selective outlines, gives coherent pixel-art sprites for every facing and
state at interactive bake cost, from a representation far smaller than the
sprite atlas it replaces.

**Prior work.** Rendering 3D models to sprites is long established
(pre-rendered isometric games; "3D-to-pixel" pipelines such as those in
Dead Cells' art process). Hue-shifted ramps and selective outlining are
standard pixel-art practice. Ordered (Bayer) dithering is textbook. What is
specific here is the combination: analytic per-pixel rays against a tiny
primitive set (box, cylinder, toothed gear, sphere) at native resolution,
patterns evaluated in part-local coordinates, and gameplay-bound animation
parameters in the same genome. No claim of novelty is made.

**Method.** Six machine genomes, six variants each (A raw continuous
shading → B ramps → C +dither → D +outline → E +shadows = shipping config;
F = E without dither). Metrics on each sprite against the grass backdrop:
unique colours, high-frequency noise (mean |Laplacian| of luminance over
interior pixels), silhouette contrast (mean |ΔL| of edge pixels vs the
backdrop), median bake ms of 7.

| Machine | colours raw → ramps | HF noise E (dither) / F (none) | silhouette contrast C → D (outline) | bake ms (E) |
|---|---|---|---|---|
| drill | 64 → 23 | 92.9 / 88.9 | 57.8 → 111.8 | 5.6 |
| smelter | 58 → 25 | 99.7 / 97.3 | 36.2 → 110.1 | 3.9 |
| assembler | 47 → 24 | 96.0 / 95.5 | 69.6 → 108.8 | 3.6 |
| generator | 118 → 20 | 92.7 / 90.0 | 50.0 → 111.3 | 6.1 |
| lab | 331 → 20 | 78.4 / 69.4 | 56.8 → 108.8 | 2.2 |
| hub | 100 → 23 | 77.0 / 75.4 | 52.9 → 109.2 | 6.9 |

Compactness: 5 genomes = **3,585 bytes** of JSON (1,561 gzipped) produce
180 frames (4 facings × 8 phases + off state) whose PNG atlas is
**192,721 bytes** — a 53.8× ratio, baked in 778 ms (4.3 ms/frame).

**Findings.**
1. Ramps are the cheapest win: 2–16× fewer colours, and they also make the
   bake *faster* (less per-pixel blending), with no visible loss.
2. Selective outlines roughly double silhouette contrast against grass for
   every machine (36–70 → 109–112). This is the stage that makes machines
   read at 1× zoom.
3. Ordered dither adds 1–13 % HF noise (largest on the curved lab dome,
   where it is also the only place it visibly helps the gradient). On
   flat-faced machines the difference is invisible at game zoom. Verdict:
   *mixed* — kept on by default, candidate for a per-material switch.
4. Cast/contact shadows cost ~25 % extra bake time and ground the sprite;
   no metric captures that, visual review does (see `results/exp001-sheet.png`).

**Weaknesses.** Metrics are proxies; "silhouette contrast" rewards any
dark border. No perceptual study. Bake cost was measured in V8, not Luau,
which is why the Roblox build ships pre-baked RLE sprites instead (EXP-004).
