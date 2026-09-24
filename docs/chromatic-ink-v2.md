# Chromatic Ink v2

Ink now deposits continuously while holding or dragging, rather than relying on release
pulses. The renderer supplies a local `u_stroke` uniform with previous/current normalized
pointer positions (top-left origin). A segment brush fills the gap between frame samples.
Hover creates no pigment; paused pointer samples are consumed without painting across the
pause on resume. Theme changes clear the stroke start; quality changes preserve it.
No SDK protocol, app control, or source changes are required.

The shader uses bounded exponential deposition and density feedback in alpha. Pigment is
visible even outside the central autonomous composition. A localized swirl responds to holding,
and the existing `u_gesture` elastic memory contributes a decaying current after release.
Background advection continues to carry pigment until it dissipates. Flow leaving the canvas
is absorbed. This is artistic density advection, not an incompressible Navier–Stokes solver.

The material uses broad three-band noise folds, a directional pearlescent highlight, and a
small density-derived perturbation of the shading normal. Color is recomputed from density;
RGB is never reused as simulation state. Glacier, Ember, and Iris retain separate palettes.

## Validation

```sh
pnpm build
pnpm check
pnpm build:web
pnpm test:visual
node scripts/ink-check.mjs
```

Both browser scripts accept `CHROMIUM_PATH=/path/to/chromium`.
The dedicated check substitutes only the final display color of the real Ink shader with
its density, then reads the tone-mapped display. The reported sums are display intensities,
not conserved physical mass. It exercises real float and forced 8-bit render targets:

- no hover deposition;
- stationary hold beneath the pointer, including y-coordinate convention;
- deposition between widely spaced drag samples;
- release persistence and subsequent fade;
- exact zero-delta density preservation;
- feedback reset on scene selection;
- no connecting stroke across paused input.

It also generates six full-material captures across desktop/portrait and all three palettes
in `artifacts/ink-v2/`. Those captures are diagnostic artifacts, not exact replay promises.

Half-float feedback retains subtle pigment longer. RGBA8 subtracts a time-scaled quantization
floor so faint residue can reach zero; its trails fade faster. Numerical advection can differ
with frame schedule and resolution. Physical Safari/mobile thermal performance is unmeasured;
these checks use Chromium software WebGL.

## Integration with Claude's app work

Continue using `CanvasRenderer.setArt(form, pointer)` through the existing AmbientStage API.
Do not emit new wire signals or maintain your own stroke history. Cancellation should clear
pointer strength as it does today; an existing elastic wake may settle naturally afterward.
Pause and reduced motion continue to use existing art time. Saved looks restore settings,
not the feedback texture or a historical gesture.
