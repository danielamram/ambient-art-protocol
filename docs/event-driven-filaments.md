# Event-driven Filaments

Filaments now distinguishes an arriving event from accumulated activity. It consumes the
existing normalized `pulse` stream; no pointer gesture is needed. Sources, configuration,
saved looks and the version-1 wire protocol are unchanged.

## Mapping

- Arrival: a localized light packet moves along the closed strand loop, accompanied by a
  small local deformation. Its progress comes from pulse age, not a repeating shader timer.
- Magnitude: controls packet intensity, with a compressive response to avoid burst blowout.
- Location: existing normalized x/y select an origin and strand bundle deterministically.
  This is an artistic mapping, not a geographic projection or category legend. Missing
  locations retain the existing center default; no invented categories are assigned.
- Accumulated activity: every received pulse contributes to a bounded reservoir, including
  pulses beyond the eight visible ring slots. A smooth follower opens the silhouette,
  strengthens folding, and gathers strands into bands.
- Silence: the reservoir decays; no new packet or synthetic pulse is generated. Subtle idle
  motion remains, substantially slower than the previous autonomous choreography. The old
  independently moving glints are removed from the active Filaments material.

`EventActivity` has an eight-art-second reservoir and a 0.6-art-second follower. Closed-form
integration gives matching results for identical event schedules at different frame rates.
Activity is not a raw event count or a calibrated rate: source normalization and saturation
are intentional. Large bursts cannot make brightness/deformation grow without bound.

## Contracts and lifecycle

The mapper adds optional `UniformState.u_activity`, with renderer fallback zero for older
callers. This is engine-local state, not a new wire signal or an SDK manifest requirement.
Other themes ignore it. Bus subscriptions and direct pushPulse feed the same path; disposal
clears it. Scene/quality switches do not reset source activity. The existing eight-slot pulse
ring limits individually visible packets; accumulated activity still includes all arrivals.

A paused or zero-motion art clock does not advance packet age or the activity follower.
Pulses received while paused can accumulate in the reservoir and existing bounded pulse ring;
on resume, that bounded latest state becomes visible. This preserves the existing mapper
policy rather than introducing a replay queue. Reduced motion slows the response through
art time. This is not a claim of real-world seconds while motion speed is changed.

User-triggered test pulses and explicit demo sources still use the same protocol and can
exercise the effect. Nothing auto-starts a feed or injects demo events. Existing source status
UI distinguishes a disconnected source from a quiet one; the shader itself cannot infer
connection state. Selecting Autonomous does not manufacture activity.

## Verification

```sh
pnpm build
pnpm check
pnpm build:web
pnpm test:visual
node scripts/event-filaments-check.mjs
```

Both browser scripts support `CHROMIUM_PATH=/path/to/chromium`.
Unit tests check silence, invalid input, magnitude, burst bounds, 30/60/120 Hz equivalence,
pause, disposal, and bus/direct input parity. The dedicated GPU check injects a deterministic
fixture through DataSignalBus with no pointer input, holds shader time fixed, and checks
silence, arrival, travel, magnitude, location, burst framing, persistent shape memory,
pause and recovery in desktop/portrait. Captures are generated in
`artifacts/event-filaments/`. These are synthetic test fixtures, not claimed live events.

Physical iPhone performance, source-specific artistic calibration, and event-category mapping
are not verified/implemented here. Configurable field/filter/category mapping remains app/source
work; this iteration supplies the visual response for existing configured pulse-producing feeds.
