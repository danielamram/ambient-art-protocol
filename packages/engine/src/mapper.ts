import type { DataSignalBus } from '@ambient/sdk';
import type { Subscription } from 'rxjs';
import { expDamp } from './damp.js';
import { addEnergy, decayEnergy } from './energy.js';
import { EventActivity } from './event-activity.js';
import { PulseBuffer, type PulseBufferOptions } from './pulse-buffer.js';

/** The values a shader reads each frame. Every scalar is in [0, 1] except u_time. */
export interface UniformState {
  /** Seconds since the mapper started ticking. */
  u_time: number;
  /** Canvas size in pixels. Set by the renderer, passed through untouched. */
  u_resolution: readonly [number, number];
  /** Peak intensity across live pulses. Convenient for shaders that want one number. */
  u_pulse: number;
  /** capacity * vec4(x, y, age, intensity). */
  u_pulses: Float32Array;
  /** [x, y, velocity] of the damped current. */
  u_current: readonly [number, number, number];
  u_turbulence: number;
  u_mood: number;
  /** Activity envelope, 0..1. Rises with every pulse, decays with `energyTau`. */
  u_energy: number;
  /** Smoothed long-lived pulse activity. Optional for older renderer callers. */
  u_activity?: number;
  /** Seconds advanced by the last `tick`. Feedback shaders scale their decay by it. */
  u_dt: number;
}

export interface MapperOptions {
  /** Time constant in seconds for mood smoothing. Default 2.5 (slow, palette-like). */
  readonly moodTau?: number;
  /** Time constant for turbulence. Default 1.0. */
  readonly turbulenceTau?: number;
  /** Time constant for the current vector. Default 0.6. */
  readonly currentTau?: number;
  /** Time constant for the energy envelope's decay. Default 1.5. */
  readonly energyTau?: number;
  /** How much of a pulse's magnitude is added to energy. Default 0.35. */
  readonly energyGain?: number;
  /** Initial values before any signal arrives. */
  readonly initial?: Partial<{
    mood: number;
    turbulence: number;
    current: [number, number, number];
  }>;
  readonly pulses?: PulseBufferOptions;
}

/**
 * Subscribes to a DataSignalBus and maintains the uniform state a renderer reads each frame.
 *
 * Signals write *targets* immediately. `tick(dt)` moves the *current* state toward those
 * targets with frame-rate independent damping, so bursty, chaotic data becomes soft motion.
 * Pulses bypass damping: they land in the ring buffer at full strength and decay over time.
 *
 * The mapper never touches WebGL. It does not schedule frames either; pair it with FrameLoop or
 * call `tick` yourself.
 */
export class SignalToUniformMapper {
  readonly pulses: PulseBuffer;
  readonly moodTau: number;
  readonly turbulenceTau: number;
  readonly currentTau: number;
  readonly energyTau: number;
  readonly energyGain: number;

  #activity = new EventActivity();
  #energy = 0;
  #dt = 0;
  #target = { mood: 0.5, turbulence: 0.2, current: [0.5, 0.5, 0] as [number, number, number] };
  #current = { mood: 0.5, turbulence: 0.2, current: [0.5, 0.5, 0] as [number, number, number] };
  #time = 0;
  #resolution: [number, number] = [1, 1];
  #subs: Subscription[] = [];
  #attachedTo: DataSignalBus | undefined;

  constructor(options: MapperOptions = {}) {
    this.moodTau = options.moodTau ?? 2.5;
    this.turbulenceTau = options.turbulenceTau ?? 1.0;
    this.currentTau = options.currentTau ?? 0.6;
    this.energyTau = options.energyTau ?? 1.5;
    this.energyGain = options.energyGain ?? 0.35;
    this.pulses = new PulseBuffer(options.pulses);
    const init = options.initial ?? {};
    if (init.mood !== undefined) this.#target.mood = this.#current.mood = init.mood;
    if (init.turbulence !== undefined) {
      this.#target.turbulence = this.#current.turbulence = init.turbulence;
    }
    if (init.current) {
      this.#target.current = [...init.current];
      this.#current.current = [...init.current];
    }
  }

  /** Begin listening. Calling attach twice detaches the previous bus first. */
  attach(bus: DataSignalBus): this {
    this.detach();
    this.#attachedTo = bus;
    this.#subs = [
      bus
        .on('ambiance')
        .subscribe((a) => this.setTarget({ mood: a.moodScore, turbulence: a.turbulence })),
      bus.on('current').subscribe((c) => this.setTarget({ current: [c.x, c.y, c.velocity] })),
      bus.on('pulse').subscribe((p) => {
        this.pushPulse(p);
      }),
    ];
    return this;
  }

  detach(): void {
    for (const s of this.#subs) s.unsubscribe();
    this.#subs = [];
    this.#attachedTo = undefined;
  }

  get attached(): boolean {
    return this.#attachedTo !== undefined;
  }

  /** Set targets directly. The dev overlay's manual sliders use this. */
  setTarget(
    patch: Partial<{ mood: number; turbulence: number; current: [number, number, number] }>,
  ): void {
    if (patch.mood !== undefined) this.#target.mood = patch.mood;
    if (patch.turbulence !== undefined) this.#target.turbulence = patch.turbulence;
    if (patch.current) this.#target.current = [...patch.current];
  }

  /** Snap current state to targets. Useful right after attaching to avoid a long initial glide. */
  settle(): void {
    this.#current.mood = this.#target.mood;
    this.#current.turbulence = this.#target.turbulence;
    this.#current.current = [...this.#target.current];
  }

  setResolution(width: number, height: number): void {
    this.#resolution = [width, height];
  }

  /** Advance by `dt` seconds. Negative or NaN dt is treated as 0. */
  tick(dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.#time += step;
    this.#dt = step;
    this.#activity.tick(step);
    this.#energy = decayEnergy(this.#energy, step, this.energyTau);
    const c = this.#current;
    const t = this.#target;
    c.mood = expDamp(c.mood, t.mood, this.moodTau, step);
    c.turbulence = expDamp(c.turbulence, t.turbulence, this.turbulenceTau, step);
    c.current = [
      expDamp(c.current[0], t.current[0], this.currentTau, step),
      expDamp(c.current[1], t.current[1], this.currentTau, step),
      expDamp(c.current[2], t.current[2], this.currentTau, step),
    ];
    this.pulses.tick(step);
  }

  /** The uniform state for this frame. `u_pulses` is a live view; do not mutate. */
  snapshot(): UniformState {
    return {
      u_time: this.#time,
      u_resolution: this.#resolution,
      u_pulse: this.pulses.peak(),
      u_pulses: this.pulses.packed,
      u_current: this.#current.current,
      u_turbulence: this.#current.turbulence,
      u_mood: this.#current.mood,
      u_energy: this.#energy,
      u_activity: this.#activity.value,
      u_dt: this.#dt,
    };
  }

  /** Targets, for the dev overlay's "target vs current" scope. */
  targets(): Readonly<{
    mood: number;
    turbulence: number;
    current: readonly [number, number, number];
  }> {
    return {
      mood: this.#target.mood,
      turbulence: this.#target.turbulence,
      current: this.#target.current,
    };
  }

  /** Push a pulse straight into the buffer and energy envelope, bypassing the bus. */
  pushPulse(pulse: Parameters<PulseBuffer['push']>[0]): void {
    this.pulses.push(pulse);
    this.#activity.push(pulse.magnitude);
    this.#energy = addEnergy(this.#energy, pulse.magnitude, this.energyGain);
  }

  dispose(): void {
    this.detach();
    this.pulses.clear();
    this.#activity.clear();
    this.#energy = 0;
  }
}
