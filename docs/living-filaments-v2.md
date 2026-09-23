# Living Filaments v2

The flagship now opens and gathers over independent slow rhythms, with evolving folds and
rotation. Closed integer windings preserve connected strands. The form slider still controls
tube width and folding depth. All choreography uses existing art time, so motion speed,
pause, reduced motion, and deterministic time inspection keep their existing meanings.

Rear strands are dimmer and highlights travel through selected bands. Lower emission and
bloom preserve color at overlaps. This remains additive luminous geometry, not an opaque
surface or physically based transparency. Resonant Silk retains its existing shape/material.

## Elastic interaction

`GestureMemory` consumes the renderer's existing normalized pointer samples and art delta.
It creates one bounded screen-space elastic wake, retaining drag momentum after release and
settling through an underdamped spring. It is not a complete path recorder or 3D raycast.
The shader receives renderer-local `u_gesture` = (center x, center y, displacement x, displacement y).
Positive y is down before the shader converts to its projected coordinate system.

The app already smooths pointer samples; no new event API or app code is needed. A strength
threshold distinguishes a held/smoothing pointer from hover. Zero art delta freezes the spring
and consumes input samples to avoid a resume jump. Scene changes/context restoration reset
memory; shader quality recompilation preserves it. Failed shader compilation keeps it intact.
The existing release pulse is unchanged. Pointer cancellation still depends on the host clearing
its pointer; existing cancellation handlers remain in place.

This is intentionally independent of the public signal protocol. No source, SDK, React control,
URL, or saved-look behavior changes. Claude's app handoff remains compatible.

## Verification

```sh
pnpm build
pnpm check
pnpm build:web
pnpm test:visual
node scripts/filaments-check.mjs
```

Both browser scripts support `CHROMIUM_PATH=/path/to/chromium`.
The dedicated check captures five art-time phases at desktop and portrait sizes, checks
silhouette margins and white clipping, checks extreme form/palette combinations, and isolates
release inertia, zero-delta freezing, and recovery with shader time held constant.
Captures are generated under ignored `artifacts/filaments-v2/`; they are browser renders.
Unit tests cover recovery, sampling at 30/60/120 Hz, pause/resume, hover, invalid input, and bounds.

These automated checks run with Chromium software WebGL. Physical iPhone/Safari performance,
thermal endurance, and subjective motion assessment remain release-review tasks. No new
hardware performance claim is made. Segment counts are unchanged in this iteration.
