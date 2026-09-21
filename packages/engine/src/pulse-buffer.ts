import type { PulseEvent } from '@ambient/sdk';

export interface LivePulse {
  x: number;
  y: number;
  /** Seconds since the pulse arrived. */
  age: number;
  /** Original magnitude, 0..1. */
  magnitude: number;
  /** magnitude * exp(-age * decay): what the shader should actually use. */
  intensity: number;
}

export interface PulseBufferOptions {
  /** Ring size. Shaders receive exactly this many vec4 slots. Default 8. */
  readonly capacity?: number;
  /** Per-second exponential decay rate of intensity. Default 2.0 (half-life ~0.35s). */
  readonly decay?: number;
  /** Pulses older than this many seconds are dropped. Default 3. */
  readonly lifetime?: number;
  /** Where a pulse lands when it carries no location. Default canvas center. */
  readonly defaultLocation?: (magnitude: number) => { x: number; y: number };
}

/**
 * Fixed-capacity ring of recent pulses. When full, the oldest pulse is overwritten, so a burst
 * of events never silently collapses into one shockwave.
 */
export class PulseBuffer {
  readonly capacity: number;
  readonly decay: number;
  readonly lifetime: number;
  readonly #defaultLocation: (magnitude: number) => { x: number; y: number };
  readonly #slots: LivePulse[] = [];
  /** Packed [x, y, age, intensity] * capacity, ready for gl.uniform4fv. */
  readonly packed: Float32Array;

  constructor(options: PulseBufferOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? 8));
    this.decay = options.decay ?? 2.0;
    this.lifetime = options.lifetime ?? 3;
    this.#defaultLocation = options.defaultLocation ?? (() => ({ x: 0.5, y: 0.5 }));
    this.packed = new Float32Array(this.capacity * 4);
  }

  push(pulse: Pick<PulseEvent, 'magnitude' | 'location'>): void {
    const loc = pulse.location ?? this.#defaultLocation(pulse.magnitude);
    const live: LivePulse = {
      x: loc.x,
      y: loc.y,
      age: 0,
      magnitude: pulse.magnitude,
      intensity: pulse.magnitude,
    };
    if (this.#slots.length < this.capacity) {
      this.#slots.push(live);
    } else {
      // Overwrite the oldest slot.
      let oldest = 0;
      for (let i = 1; i < this.#slots.length; i += 1) {
        if ((this.#slots[i]?.age ?? 0) > (this.#slots[oldest]?.age ?? 0)) oldest = i;
      }
      this.#slots[oldest] = live;
    }
  }

  /** Age every pulse by `dt` seconds, drop expired ones, and refresh `packed`. */
  tick(dt: number): void {
    for (let i = this.#slots.length - 1; i >= 0; i -= 1) {
      const p = this.#slots[i];
      if (!p) continue;
      p.age += dt;
      if (p.age >= this.lifetime) {
        this.#slots.splice(i, 1);
        continue;
      }
      p.intensity = p.magnitude * Math.exp(-p.age * this.decay);
    }
    this.packed.fill(0);
    for (let i = 0; i < this.#slots.length; i += 1) {
      const p = this.#slots[i];
      if (!p) continue;
      const o = i * 4;
      this.packed[o] = p.x;
      this.packed[o + 1] = p.y;
      this.packed[o + 2] = p.age;
      this.packed[o + 3] = p.intensity;
    }
  }

  /** The strongest current intensity, 0 when nothing is live. Drives the scalar `u_pulse`. */
  peak(): number {
    let max = 0;
    for (const p of this.#slots) if (p.intensity > max) max = p.intensity;
    return max;
  }

  get size(): number {
    return this.#slots.length;
  }

  /** A read-only snapshot, mostly for tests and the dev overlay. */
  list(): readonly Readonly<LivePulse>[] {
    return this.#slots.map((p) => ({ ...p }));
  }

  clear(): void {
    this.#slots.length = 0;
    this.packed.fill(0);
  }
}
