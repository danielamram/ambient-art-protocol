# App experience

How `apps/web` handles settings, saved looks, share links, sources, input and diagnostics.
It describes what is implemented. Rendering, shaders and the engine are out of scope here.
See `visual-refinement.md` for those.

## Structure

- `src/state/*`: pure modules with no DOM access at import time, unit-tested in Node
  (`apps/web/test`).
  - `artwork-settings.ts`: `ArtworkSettingsV1`, validation against `SHADER_MANIFESTS`, the
    one palette-to-mood mapping (glacier 0, ember 0.5, iris 1), and transitions.
  - `apply-settings.ts`: `ArtworkStage` (the narrow stage interface) and `applySettings()`.
  - `look-codec.ts`: the URL fragment and startup precedence.
  - `look-storage.ts`: saved looks, the last look and device preferences over an injected store.
  - `source-coordinator.ts`: latest-request-wins source selection.
  - `share.ts`, `diagnostics.ts`: share/copy fallbacks and the diagnostics report.
- `src/stage-adapter.ts`: maps `ArtworkStage` and `SourceDriver` onto `AmbientStage`.
- `src/hooks/*`: stage lifecycle, source selection, saved looks, notices, shortcuts, cinema
  mode, the canvas pointer and fullscreen.
- `src/components/*`: `TuningPanel`, `SavedLooks`, `SourcePicker`, `SignalScope`, `Diagnostics`,
  `NoticeRegion`, `Slider`.

## Settings

```ts
interface ArtworkSettingsV1 {
  version: 1;
  scene: string; // a SHADER_MANIFESTS id
  palette: 'glacier' | 'ember' | 'iris';
  form: number; // finite, [0, 1], two decimals
  motion: number; // finite, [0, 1], two decimals
  glow: number | null; // null = the scene's own bloom; a number is an explicit override
}
```

Quality (`auto | high | low`) is a device preference (`aap:device-preferences:v1`), not part of a
look. Pause, the panel, the active source and readouts are session state and are never saved.

Transitions:

- Choosing a scene keeps palette, form, motion and pause, and returns glow to the new
  scene's default.
- Reset scene lighting runs the stage's `resetLook()` and clears the glow override. It
  leaves form and motion alone.
- Reset artwork restores palette, form, motion and glow to defaults, keeping the scene,
  pause and quality.
- Full looks (saved, shared, reset artwork) go through `applySettings()`: switch scene, clear
  post overrides, apply palette/form/motion, then an explicit glow. A failed scene switch
  changes nothing. If a later step throws, the previous look is restored best-effort. The UI
  only updates after the stage accepts the change.
- Live readouts never overwrite the sliders. Sources can shift what you see; the panel always
  shows what you chose.

## Share links

```
#look=1&scene=living-filaments&palette=iris&form=0.45&motion=0.35&glow=default
```

- Fields come in a fixed order, numbers are rounded to two decimals, and `0` is a valid value.
- Links are rejected whole on: a fragment over 2 KB, an unknown version, scene or palette, a
  number that isn't a strict decimal (empty, `NaN`, `Infinity`, hex, exponent, whitespace), or
  a duplicated known key.
- Unknown keys are ignored.
- Finite out-of-range numbers are clamped, with one notice.
- The share URL keeps the origin and deployment path and drops every query parameter
  (`capture`, `time`, `scene`, debug flags, anything else).
- Only Share writes a link: native share sheet, then clipboard, then a readonly field to copy
  by hand. The address bar is never changed.

Startup precedence:

1. `?capture`: unchanged capture behavior, with no saved or shared state applied.
2. A valid `#look=`. An invalid one opens the defaults with a notice. It never falls back to
   an unrelated saved look.
3. A valid legacy `?scene=`, with default settings.
4. The last look saved on this device (`aap:last-look:v1`).
5. Defaults: Living Filaments, Glacier, form 0.45, motion 0.45, scene glow, adaptive quality.

A `#look=` pasted while the app is open is applied once through `hashchange`. Going Back
to a URL without a look changes nothing. Links never start a live source.

## Saved looks

- `aap:saved-looks:v1` holds `{ version: 1, looks: SavedLookV1[] }`, capped at 30 looks.
- Names are trimmed, capped at 60 code points and shown as plain text. Documents over 256 KB
  are not parsed.
- Supported actions: save, load, rename, update to current settings, and delete with Undo.
- A loaded look that has been changed shows "modified" and an Update button. Saved looks are
  never overwritten silently.
- Invalid records, and duplicate ids after the first, are skipped with a single notice.
  Before rewriting a document that couldn't be fully read, the original is copied once to
  `aap:saved-looks:v1:unreadable-backup`.
- A document with a newer `version` is left untouched. Changes are kept in memory for this tab.
- If storage is blocked or full, changes stay in memory and the panel says they are not saved
  on this device. A save is never reported as durable after `setItem` throws.
- The last look is written 400 ms after a change and again on `pagehide`. Startup fallbacks
  never overwrite it.
- **Multiple tabs are best effort.** Each mutation re-reads storage and applies itself by id,
  and `storage` events refresh other tabs' lists. Writes are last-write-wins, so two tabs
  changing the list at the same instant can lose one change. Current (unsaved) settings are
  never replaced by another tab.

## Sources

`SourceCoordinator` implements latest-request-wins selection:

- Every request gets a generation number. One serialized worker stops the previous source
  before starting the next and re-reads the desired source after every `await`.
- An obsolete start that completes is stopped before the newest one starts.
- Status callbacks are ignored unless they come from the pending attempt of the current
  generation, or from the settled live source.
- A failed start shows "Source unavailable" with Retry and Autonomous. It is never labelled
  Live.
- Returning to Autonomous re-emits the palette selected at that moment, not one captured
  when the request was queued.
- On unmount the coordinator closes first: no UI updates and no new starts after that.
- Loading a saved or shared look while a source is live returns to Autonomous first, with a
  short notice.

**Stopping while connecting:** `waitForOpen` in `packages/sources/src/connect.ts` takes the
source's `ctx.signal`. When a source is stopped mid-connect, the built-in sources close their
socket and settle at once as `stopped` (not `error`), so the next selection starts without
waiting for the 15 s connect timeout. Third-party plugins that ignore `ctx.signal` still delay
their own `stop()` until their `start()` settles; the coordinator's abort still prevents them
from emitting.

## Signal scope

"Signal scope" under the source picker shows sparklines of what reaches the bus. It shows the
input to the artwork, not the rendered result.

- **Channels:** Pulses (the strongest in each bucket), Mood, Turbulence and Current
  velocity. Values are already normalized to [0, 1] on the wire.
- **Sources:** everything on the bus is included: live feeds, your taps and the palette.
- **Recording:** `state/signal-scope.ts` records each signal in O(1) from the moment the
  stage is created, so the current mood is known as soon as the scope opens.
- **Sampling:** only while the scope is expanded inside an open panel. It samples every
  250 ms (15 s of history), or every 1 s with reduced motion (60 s). It pauses in hidden
  tabs and never runs per frame. Collapsing the scope stops React updates.
- **Accessibility:** graphs are `aria-hidden` SVG, and each row shows its latest value as
  text. Nothing is announced as values change.

## Input and accessibility

- The panel is a non-modal `aside` labelled by its heading:
  - Tune sets `aria-expanded` and `aria-controls`.
  - Opening moves focus to the heading without scrolling. Closing returns focus to Tune if
    focus was inside the panel.
  - Escape closes it only while it is open.
- Shortcuts: `1..6` scenes, `P` pause, `H` panel, `F` fullscreen (when supported), `Space`
  pulse.
  - They are ignored in text fields and selects, and with Ctrl/Cmd/Alt.
  - Held keys don't repeat, and a held Space sends one pulse.
- Cinema mode fades chrome after 7 s. It never hides chrome that holds keyboard focus.
  Keyboard or pointer activity wakes it.
- Notices use a polite live region. The source failure is an alert. FPS updates are never
  announced.
- Canvas gesture:
  - Hold to gather, release to pulse (0.7), one pointer at a time.
  - Cancel, lost capture, window blur and unmount end the gesture without a pulse.
  - Zero-sized bounds are ignored.
- Mobile layout:
  - 44 px primary icon buttons and safe-area insets.
  - `dvh`-based panel height; the panel scrolls internally with overscroll containment and
    `touch-action: pan-y`.
  - Checked for horizontal overflow at 320 px.
- Fullscreen is hidden when the document can't go fullscreen (for example iPhone Safari). A
  refused request shows a quiet notice.

## Diagnostics

Studio settings shows:

- The stage's aggregate FPS sample.
- The effective quality tier and render scale.
- Whether the internal float render target is available. This concerns the offscreen buffers,
  not HDR display output.

Copy diagnostics produces a local JSON report containing: timestamp, app version, and commit
(`VERCEL_GIT_COMMIT_SHA` or `AAP_COMMIT` at build time, otherwise `unknown`), scene, paused,
source id, quality preference, tier, render scale, FPS, float target, viewport, device pixel
ratio, reduced motion, visibility and user agent. It includes no payloads, no GPU identifiers,
and no network calls.

FPS is averaged over roughly half-second windows while frames render. **p95 frame time and
GPU timing are not measured**, and the report says so.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check          # includes apps/web/test (pure state modules)
pnpm build:web
pnpm test:visual    # shader/GPU gate (24 combinations), unchanged
pnpm test:app       # app flows in Chromium
```

If the Playwright-managed Chromium does not match the installed Playwright version, set
`CHROMIUM_PATH=/absolute/path/to/chromium` for both browser commands.

`pnpm test:app` starts its own loopback Vite server and aborts all non-loopback requests.
It stubs `requestAnimationFrame` as `test:visual` does, and uses a dev-only `window.__aapStage`
handle; production builds strip it. It covers:

- Defaults, save/reload/restore, rename/update/delete/undo, and markup in names.
- Clipboard share into a clean context; share-sheet cancel; manual copy fallback.
- Invalid and pasted links; pause kept across scene changes and look loads; reset lighting.
- Keyboard focus, Escape and held keys; pointer cancel and blur.
- Source failure, retry, pending start versus a loaded look, and rapid switching, using a
  routed fake Wikimedia stream.
- 390 px and 320 px layouts; reduced motion; unsupported fullscreen.
- The signal scope; diagnostics; capture and legacy URLs.

Screenshots go to `artifacts/app-check/`.

These checks run in Linux Chromium with software WebGL and viewport emulation. They are not
physical Safari, Android, battery or thermal testing. Use `device-checklist.md` for real devices.

## Handoffs for the rendering thread

- **Per-frame timing.** A user needs to report stutter, not just an average FPS. The smallest
  contract is `AmbientStage.onFrameTiming(cb: (cpuMs: number, gpuMs: number | null) => void)`,
  batched about once a second as a fixed-size array. Units are milliseconds and it is
  wall-clock based. GPU time uses `EXT_disjoint_timer_query_webgl2` when present, else `null`.
  It must be off unless subscribed. Acceptance: diagnostics can report p50/p95 frame time on a
  device without that extension, with `gpuMs: null`.
- **Quality policy.** Quality levels reduce render scale before the ribbon instance count.
  Filaments and Silk may be geometry-bound on phones, so lowering the scale may not recover
  frame rate. Measurements from `test:app` diagnostics and the device checklist should go back
  to that thread before any tier is retuned. Tier thresholds were not changed here.
