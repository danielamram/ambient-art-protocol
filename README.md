# Ambient Art Protocol

Turn real-time data streams into live WebGL ambient art.

Plug in a data source (a webhook, a WebSocket feed, a polling API), have it emit a few normalized
signals, and watch a fragment shader breathe with it. Sources know nothing about shaders. Shaders
know nothing about sources. A small, versioned JSON protocol sits in between.

**Status: early, but it renders.** The SDK, signal bus, plugin API, uniform mapper, a WebGL2
renderer, one shader theme, and a web app with a control overlay are implemented and tested.
Built-in sources and more themes are next. See the roadmap in `CLAUDE.md`.

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

## Try it

```
pnpm install
pnpm dev:web   # http://localhost:5173
```

Tap the canvas to send a pulse. The sliders emit `ambiance` and `current` signals onto the same
bus a plugin would, and the mock source toggle mounts a deterministic random source.

## Deploy

The repo is Vercel-ready: `vercel.json` builds `apps/web` with `pnpm build:web` and serves
`apps/web/dist`. Import the repository in the Vercel dashboard and deploy with the defaults.

## Develop

Requires Node 20+ and pnpm 10.

```
pnpm install
pnpm check       # typecheck + lint + test
pnpm dev         # watch a mock source stream signals through the bus
pnpm dev:engine  # same, through the mapper: targets vs damped values
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
