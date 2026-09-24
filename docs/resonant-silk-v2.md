# Resonant Silk v2

Silk owns a dedicated surface/material shader in `packages/shaders/src/resonant-silk.ts`.
The existing scene identifier, manifest registry order, and `filaments.ts` export remain
compatible with saved looks, presets, source pairings, and app controls.

## Visual behavior

A continuous tessellated sheet replaces the luminous parallel-line pass. Broad oscillations,
smaller folds, directional cloth-like sheen, and filtered thread detail give Silk a different
material identity from Filaments. Glacier, Ember, and Iris remain the three palette anchors.
The sheet tilts diagonally in portrait layouts. All autonomous movement uses art time.

Holding lifts a local region. Existing renderer gesture memory bends the surface after a
drag and settles on release. Existing source/touch pulses send a traveling displacement
through the sheet. Surface normals are computed from the deformed surface, so lighting
responds to both the folds and the gesture. No new engine, app, or SDK API is required.

This is an analytic, translucent satin study, not a physical cloth solver. The existing
additive pass has no opaque depth occlusion; layered intersections transmit light. It has
no collisions, tearing, physical thread simulation, or measured textile parameters.

## Rendering budget

The sheet uses 8,192 six-vertex cells at full detail and 2,048 at low detail. The old Silk
pass used 57,600/19,200 ribbon segments. The new vertex shader computes more surface samples
per vertex for normals, so these counts alone do not establish a frame-rate improvement.
No quality-controller thresholds or other scenes' budgets change.

## Verification

```sh
pnpm build
pnpm check
pnpm build:web
pnpm test:visual
node scripts/silk-check.mjs
```

The browser scripts support `CHROMIUM_PATH=/path/to/chromium`.
The dedicated check captures three art-time phases in desktop and portrait layouts and four
extreme form/palette combinations. It checks visibility, framing, highlight clipping, drag
memory, zero-delta freezing, recovery, and evolving pulse response. Gesture checks use low
geometry detail; phase captures use full detail. Captures go to `artifacts/silk-v2/`.
The existing 24-case harness covers all scenes at both quality levels and float/8-bit targets,
including context restoration and resizing.

Validation uses Chromium software WebGL. Physical iPhone/Safari, sustained performance, and
thermal endurance remain unverified. No application files are changed by this iteration.
