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
- `packages/engine` (`@ambient/engine`): `SignalToUniformMapper`, `PulseBuffer`, `FrameLoop` (done),
  and the WebGL2 fullscreen-quad canvas controller (**Phase 3, not yet**). Isomorphic: no DOM types.
- `packages/sources` (`@ambient/sources`): built-in source plugins. **Phase 4, stub today.**
- `packages/shaders` (`@ambient/shaders`): GLSL themes as `ShaderManifest` objects.
  **Phase 3, stub today.**
- `apps/web`: Vite + React canvas and dev overlay. **Phase 5, stub today.**

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
- Renderer will be raw WebGL2 (fullscreen triangle + fragment shader). No Three.js.

## Commands
```
pnpm install
pnpm build        # tsc per package, topological order
pnpm typecheck
pnpm lint         # biome check
pnpm test         # vitest run
pnpm dev          # tsx demo: mock source -> bus -> stdout, exits after 3s
pnpm dev:engine   # tsx demo: mock source -> bus -> mapper -> uniform snapshots, exits after 3s
pnpm check        # typecheck + lint + test
```

## Roadmap
- Phase 1 (done): workspace, `@ambient/sdk`, tests, demo.
- Phase 2 (done): `SignalToUniformMapper`, `PulseBuffer` (ring of 8), `FrameLoop` in `engine`.
  Targets are written by bus subscriptions; `tick(dt)` damps current state with `expDamp`.
- Phase 3: WebGL2 canvas controller + two themes (`cybernetic-mesh`, `fluid-field`).
- Phase 4: `mock-crypto` and `webhook-pulse` sources, plus a WebSocket relay transport so
  Node-side sources can feed a browser renderer.
- Phase 5: `apps/web` with the floating overlay (manual sliders, theme switcher).
