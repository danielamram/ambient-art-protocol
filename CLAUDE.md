# Ambient Art Protocol - Architecture & Guidelines

## Overview
A developer-first, open-source framework that ingests real-time data streams (WebSockets, REST,
webhooks) and translates them into live WebGL ambient art shaders.

Read `docs/brainstorm.md` for the design critique and the reasoning behind the decisions below.

## Key Design Principles
1. **Signal decoupling.** Data sources NEVER touch WebGL code. Sources emit standardized
   `VisualSignal` events (`pulse`, `current`, `ambiance`) onto a `DataSignalBus`. The engine
   subscribes to the bus and owns all rendering. Package dependency direction is one way:
   `sources -> sdk <- engine`. `sources` must never import `engine`, and vice versa.
2. **Developer-first SDK.** Adding a source means calling `createSource()` from `@ambient/sdk`
   with a small typed definition. No engine knowledge required.
3. **Two clocks.** Data arrives at arbitrary, bursty rates. Rendering runs on
   `requestAnimationFrame`. The bus is push-based and unthrottled. The engine's mapper owns a
   *target* state written by subscriptions and a *current* state advanced per frame with
   frame-rate-independent damping. No RxJS on the render loop.
4. **The protocol is the product.** `VisualSignal` is plain, versioned JSON (`v: 1`). Anything that
   can produce JSON (Python, curl, an ESP32) can be a source once the relay exists.

## Directory Structure
- `packages/sdk` (`@ambient/sdk`): protocol types, `DataSignalBus`, `createSource()`,
  `SourceRegistry`, `SignalTransport`, `ShaderManifest`. Isomorphic: no DOM, no Node-only APIs.
  `@ambient/sdk/testing` ships `createMockSource` and `collect`.
- `packages/engine` (`@ambient/engine`): `SignalToUniformMapper`, `PulseBuffer`, `FrameLoop`,
  `QualityController`, and `CanvasRenderer` (WebGL2 fullscreen triangle that loads a
  `ShaderManifest` and runs it through a post stack: scene FBO with a ping-pong pair for feedback,
  bright pass + separable blur for bloom, then a composite pass with chromatic aberration,
  vignette, ACES tonemap, grain and dither). Pure pieces (`post/settings.ts`, `post/plan.ts`,
  `post/shaders.ts`, `quality.ts`, `energy.ts`) are unit-tested in Node; only `renderer.ts` and
  `gl/targets.ts` touch WebGL.
- `packages/sources` (`@ambient/sources`): built-in plugins. Shipped: `wikipedia-edits` (Wikimedia
  EventStreams over SSE) and `binance-trades` (public WebSocket), both keyless and browser-native,
  with injectable `EventSource`/`WebSocket` constructors for tests and Node. `waitForOpen` makes
  `start()` resolve only once connected, so 'running' means live.
- `packages/shaders` (`@ambient/shaders`): GLSL ES 3.00 themes as `ShaderManifest` objects.
  Shipped: `aurora-drift` (warped light curtains), `fluid-field` (feedback-advected ink), and
  `cybernetic-mesh` (raymarched wire sphere over a floor grid). Shared chunks live in
  `src/lib/glsl.ts` (noise, palette, pulse helpers, standard uniform block).
- `apps/web`: Vite + React full-screen canvas with a floating overlay (theme picker, sliders that
  emit onto the bus, tap-to-pulse, drag-to-steer, post FX and quality controls, mock source
  toggle, live readout). The overlay and cursor hide after a few idle seconds; `space` pulses,
  `1..n` pick a theme, `h` hides the panel, `f` goes fullscreen. Deployed to Vercel from
  `vercel.json` at the root.

## Code Conventions
- Strict TypeScript, ESM only, `module: NodeNext`. Relative imports use the `.js` extension.
- `verbatimModuleSyntax` is on: use `import type` / `type` modifiers for type-only imports.
- RxJS 7 for streams. Import from `'rxjs'` only, never `'rxjs/operators'`.
- **Every numeric signal field is in [0, 1].** The SDK clamps at the boundary (`normalizePayload`).
  In dev (`validate: true`, the default outside `NODE_ENV=production`), a NaN or non-finite value
  throws `SignalValidationError` so plugin bugs surface immediately. In prod it clamps to 0.
- Signals are plain JSON: no `Date`, no class instances, no `Infinity`.
- Biome for lint and format (`pnpm lint`, `pnpm lint:fix`). No ESLint or Prettier.
- Tests live in `packages/*/test/*.test.ts` and run with vitest from the root. Use
  `vi.useFakeTimers()` *before* subscribing when testing time-based operators.
- Renderer is raw WebGL2 (fullscreen triangle + fragment shader). No Three.js.
- **Theme authoring.** Themes output linear, HDR-ish colour and never tonemap, gamma-correct or
  vignette themselves; the engine's composite pass does. Standard uniforms are the ones in
  `STANDARD_UNIFORMS`: besides the signal uniforms there is `u_energy` (activity envelope, 0..1),
  `u_dt` (seconds since last frame) and, for `feedback: true` themes, `sampler2D u_prevFrame`
  (last frame's scene). Feedback decay must be frame-rate independent:
  `prev * pow(retentionPerSecond, u_dt)`, minus `1.5/255.0` so 8-bit fallbacks reach black.
  Themes may branch on the `AAP_QUALITY` define (1 full, 0 cheap) for adaptive quality.

## Commands
```
pnpm install
pnpm build        # tsc per package, topological order
pnpm typecheck
pnpm lint         # biome check
pnpm test         # vitest run
pnpm dev          # tsx demo: mock source -> bus -> stdout, exits after 3s
pnpm dev:engine   # tsx demo: mock source -> bus -> mapper -> uniform snapshots, exits after 3s
pnpm dev:web      # vite dev server for apps/web
pnpm build:web    # production bundle to apps/web/dist (what Vercel runs)
pnpm check        # typecheck + lint + test
```

## Roadmap
- Phase 1 (done): workspace, `@ambient/sdk`, tests, demo.
- Phase 2 (done): `SignalToUniformMapper`, `PulseBuffer` (ring of 8), `FrameLoop` in `engine`.
  Targets are written by bus subscriptions; `tick(dt)` damps current state with `expDamp`.
- Phase 3 (done): `CanvasRenderer` with the post stack (feedback, bloom, tonemap, grain),
  adaptive `QualityController`, and the `aurora-drift`, `fluid-field` (feedback-advected ink,
  not a Navier-Stokes solver) and `cybernetic-mesh` themes.
- Phase 4 (partial): `wikipedia-edits` and `binance-trades` are done and toggleable in the web app.
  Still to do: `webhook-pulse` (Node HTTP endpoint) plus the WebSocket relay transport so Node-side
  sources can feed a browser renderer. Plugins that die after starting call `ctx.fail(err)`.
- Phase 5 (partial): `apps/web` has the overlay, cinema mode (idle auto-hide), keyboard
  shortcuts, drag-to-steer, post FX and quality controls. Still to do: signal scope sparklines,
  source presets, recorder/replayer.
