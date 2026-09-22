# Ambient Art Protocol

Turn real-time data streams into live WebGL ambient art.

Plug in a data source (a webhook, a WebSocket feed, a polling API), have it emit a few normalized
signals, and watch a fragment shader breathe with it. Sources know nothing about shaders. Shaders
know nothing about sources. A small, versioned JSON protocol sits in between.

**Six real-time studies, one signal protocol.** The default collection is now Living Filaments
(instanced 3D ribbons), Chromatic Ink (density feedback with pearlescent shading), and Resonant
Silk (an interference surface). Aurora Drift, Fluid Field, and Cybernetic Mesh remain available
in the scene selector. See [the visual implementation notes](docs/visual-refinement.md).

![Living Filaments](docs/visuals/living-filaments.png)

Hold the canvas to gather light; release to send a pulse. Open the tuning panel for palette,
form, motion, glow, live source, and quality. Press **P** to pause, **1–6** for scenes, **F** for
fullscreen, **H** for controls, or **Space** to pulse. System reduced-motion preferences slow
the artwork; pause freezes it. Live sources are opt-in.

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

Switch on a live source: **Wikipedia edits** (every human edit on Wikimedia, over Server-Sent
Events) or **BTC/USDT trades** (Binance public WebSocket). Both are free, need no key, and run in
the browser. Hold and release the canvas to send a pulse by hand. Sources still emit normalized signals on
the same bus; local form, pointer, and playback controls belong to the renderer.

## Deploy

The repo is Vercel-ready. Import the repository in the Vercel dashboard and set **Root Directory**
to `apps/web` (keep "Include source files outside of the Root Directory" enabled, which is the
default). `apps/web/vercel.json` installs the whole workspace, runs `pnpm -w run build:web`, and
serves `dist`. Leaving Root Directory at the repo root also works: the root `vercel.json` does the
same from there.

## Develop

Requires Node 20+ and pnpm 10.

```
pnpm install
pnpm build       # build workspace declarations first
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
