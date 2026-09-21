# Ambient Art Protocol: design brainstorm

A critique of the original five-phase pitch, what was kept, what was changed, and why. This is a
living document; update it when a decision below is revisited.

## What is genuinely good about the idea

- **Signal decoupling is the whole product.** "Sources emit normalized signals, shaders consume
  uniforms, nothing in between knows about the other" is the right cut. It makes sources trivially
  testable and shaders swappable. This is rule #1 and is enforced by package boundaries: `sources`
  and `engine` both depend on `sdk` and never on each other.
- **Three primitive signal shapes is enough.** Pulse (discrete event), Current (directional flow),
  Ambiance (slow-moving state) cover most real-world feeds. Resist adding a fourth until two real
  sources demand it.
- **Normalizing to 0..1 at the SDK boundary** is the right place: plugin authors do the domain math
  once; the engine never sees dollars, knots, or requests-per-second.

## Weak spots in the original pitch, and the fix for each

1. **The browser/Node split was unaddressed.** A webhook source (HTTP endpoint) must run in Node;
   the renderer must run in a browser. Putting both on one in-memory bus cannot work.
   *Fix:* `SignalTransport` is an interface in the SDK from day one. Phase 1 ships only
   `InMemoryTransport`. Phase 4 adds a WebSocket relay transport that forwards Node-side signals into
   the browser bus. Sources and the engine stay transport-agnostic; only the bus constructor changes.

2. **"60 FPS uniform updates from RxJS" conflates two clocks.** Data arrives at arbitrary, bursty
   rates; rendering runs on `requestAnimationFrame`.
   *Fix:* the bus is push-based and unthrottled. The engine's `SignalToUniformMapper` owns a *target*
   state written by subscriptions and a *current* state advanced per frame with critically-damped
   smoothing (frame-rate independent, using `dt`). Pulses decay exponentially; ambiance lerps;
   currents slerp direction. No RxJS on the render loop. Sources can opt into `throttleMs` if a feed
   is absurdly chatty.

3. **Three.js is dead weight for a fullscreen fragment shader.**
   *Fix:* raw WebGL2. One canvas controller (~200 lines): compile program, bind a fullscreen
   triangle, cache uniform locations, `setUniforms(state)` each frame. WebGPU can slot in later
   behind the same interface.

4. **Shader authoring needs a contract, not just files.**
   *Fix:* each theme is a `ShaderManifest` (`{ id, name, fragment, uniforms: [...] }`) declared in
   `@ambient/sdk`, so the UI can list themes, the engine can validate that a theme consumes only
   uniforms the mapper provides, and third parties can ship shader packs exactly like source packs.

5. **Pulse "location" was underspecified.**
   *Fix:* optional normalized canvas coords `{ x, y }`, top-left origin. When absent the engine
   picks. Multiple simultaneous pulses need a small ring buffer in the mapper (last 8 pulses as
   `vec4[8]` of x, y, age, magnitude; `u_pulses` in `STANDARD_UNIFORMS`) rather than a single
   `u_pulse` float, or overlapping shockwaves would visibly overwrite each other.

6. **Mood is one number; palettes are many.**
   *Fix:* map `u_mood` through a palette in GLSL (cosine palette or 1D texture) so each theme can
   define its own ramp rather than hardcoding two colors.

7. **"Protocol" implies a wire spec. Lean into it.**
   *Fix:* `VisualSignal` is versioned plain JSON (`v: 1`), built fresh by `normalizePayload` and
   checked by `validateSignal`, so non-TypeScript producers (a Python script, curl, an IoT board)
   can POST or WebSocket signals directly once the relay exists. This is the project's best growth
   lever.

## Phase 1 decisions worth knowing

- **Validation policy.** `validate` defaults to `isDev()` (`NODE_ENV !== 'production'`, or `true`
  when `process` is undefined). Dev throws `SignalValidationError` on non-finite numbers; prod
  clamps NaN to 0. Both always clamp to [0, 1]. Override per bus or per source instance.
- **Source lifecycle** is a small state machine: `idle -> starting -> running -> stopping ->
  stopped`, with `error` reachable from start or teardown failures and a retry allowed from
  `error`. Concurrent `start()` calls share one promise. `stop()` during an async `start()` is
  honored as soon as start settles. Emits after stop are dropped silently.
- **`SourceRegistry.startAll()`** uses `allSettled` and throws one `AggregateError`, so a broken
  plugin never prevents healthy ones from running.
- **Tooling:** pnpm workspaces, tsc project builds, vitest, Biome (single lint+format dependency),
  `tsx` for the demo. RxJS is a peer dependency of the SDK to guarantee one copy.

## Ideas for the roadmap (after Phase 5)

- **Signal recorder/replayer**: record a session to JSONL and replay it. Big win for shader
  development without live feeds and for reproducible bug reports.
- **Dev overlay "signal scope"**: tiny sparklines of each uniform's target vs. current value.
- **Source presets that sell the project**: GitHub webhook (pulse per push, mood from CI pass rate),
  Spotify now-playing (current from tempo, mood from valence), weather (turbulence from wind),
  server metrics (pulse per error, mood from p99 latency).
- **Headless/embed mode**: an `<ambient-art src="wss://...">` web component.
- **OBS / Electron wallpaper target**: the literal "ambient art on a wall" use case.

## Open questions (settle before Phase 3)

- Does mood need hue *and* energy, or does one scalar plus turbulence suffice? Starting with one.
- Should the engine coalesce sources emitting above 60 Hz, or should the SDK rate-limit? Currently:
  opt-in `throttleMs` per source, default off; the mapper will coalesce regardless.
- Should `location` grow a `z` for 3D themes? Not until a theme needs it.
