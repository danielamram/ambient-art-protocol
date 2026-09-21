# Ambient Art Protocol

Turn real-time data streams into live WebGL ambient art.

Plug in a data source (a webhook, a WebSocket feed, a polling API), have it emit a few normalized
signals, and watch a fragment shader breathe with it. Sources know nothing about shaders. Shaders
know nothing about sources. A small, versioned JSON protocol sits in between.

**Status: Phase 1.** The SDK, signal bus, and plugin API are implemented and tested. The renderer,
built-in shaders, built-in sources, and web app are stubs. See the roadmap in `CLAUDE.md`.

## The protocol

Three signal shapes. Every numeric field is normalized to `[0, 1]`.

| Type | Fields | Meaning | Typical render |
|---|---|---|---|
| `pulse` | `magnitude`, `location?: {x, y}` | Something happened | Shockwave, flash, ripple |
| `current` | `x`, `y`, `velocity` | Things are flowing this way | Directional drift, streaks |
| `ambiance` | `moodScore`, `turbulence` | The overall feel | Palette, noise amplitude |

Each signal carries `{ v: 1, sourceId, ts }`. On the wire it's plain JSON:

```json
{ "v": 1, "sourceId": "github", "ts": 1758470400000, "type": "pulse", "magnitude": 0.8, "location": { "x": 0.5, "y": 0.5 } }
```

## Write a source

```ts
import { createSource, normalize } from '@ambient/sdk';

export const weather = createSource<{ city: string }>({
  id: 'weather',
  name: 'Weather',
  async start(ctx) {
    const tick = async () => {
      const w = await fetchWeather(ctx.config.city, { signal: ctx.signal });
      ctx.ambiance({
        moodScore: normalize(w.tempC, -10, 35),
        turbulence: normalize(w.windKph, 0, 100),
      });
    };
    await tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  },
});
```

`ctx.pulse`, `ctx.current`, and `ctx.ambiance` clamp every field into `[0, 1]`. In development a
`NaN` throws so you find bugs immediately; in production it clamps to `0`. `ctx.signal` is an
`AbortSignal` that fires when the source is stopped.

## Consume signals

```ts
import { DataSignalBus, mount } from '@ambient/sdk';

const registry = await mount([weather({ city: 'Lisbon' })]);
const { bus } = registry;

bus.on('ambiance').subscribe((a) => console.log(a.moodScore, a.turbulence));
bus.throttled('pulse', 100).subscribe(renderShockwave);
bus.latest('ambiance').subscribe(updatePalette);   // replays the current state to late subscribers

await registry.dispose();
```

## Develop

Requires Node 20+ and pnpm 10.

```
pnpm install
pnpm check     # typecheck + lint + test
pnpm dev       # watch a mock source stream signals through the bus
```

Packages:

- `@ambient/sdk`: protocol types, `DataSignalBus`, `createSource`, `SourceRegistry`, transports.
- `@ambient/engine`: signal-to-uniform mapper and WebGL2 renderer (Phase 2 and 3).
- `@ambient/sources`: built-in plugins (Phase 4).
- `@ambient/shaders`: GLSL themes (Phase 3).
- `apps/web`: Vite + React live canvas (Phase 5).

The design rationale, including what changed from the original pitch and why, is in
`docs/brainstorm.md`.

## License

MIT
