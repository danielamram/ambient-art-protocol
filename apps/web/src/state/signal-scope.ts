import type { VisualSignal } from '@ambient/sdk';

/**
 * A small history of what reached the bus, for the signal scope sparklines. Pure and O(1) per
 * signal: `record()` folds a signal into the open bucket, `tick()` closes it on a fixed cadence
 * chosen by the caller (a few times a second, never per frame).
 *
 * Every wire value is already in [0, 1], so the series need no scaling.
 */
export const SCOPE_CHANNELS = ['pulse', 'mood', 'turbulence', 'current'] as const;
export type ScopeChannel = (typeof SCOPE_CHANNELS)[number];

export const SCOPE_LABEL: Readonly<Record<ScopeChannel, string>> = {
  pulse: 'Pulses',
  mood: 'Mood',
  turbulence: 'Turbulence',
  current: 'Current',
};

export class SignalScope {
  readonly length: number;
  readonly #series: Record<ScopeChannel, Float32Array>;
  /** Next ring slot to write. */
  #head = 0;
  #filled = 0;
  /** The open bucket. Pulses peak within it; the others hold their latest value (NaN = none yet). */
  #open: Record<ScopeChannel, number> = {
    pulse: 0,
    mood: Number.NaN,
    turbulence: Number.NaN,
    current: Number.NaN,
  };

  constructor(length = 60) {
    this.length = length;
    this.#series = {
      pulse: new Float32Array(length),
      mood: new Float32Array(length),
      turbulence: new Float32Array(length),
      current: new Float32Array(length),
    };
  }

  record(signal: VisualSignal): void {
    switch (signal.type) {
      case 'pulse':
        this.#open.pulse = Math.max(this.#open.pulse, signal.magnitude);
        break;
      case 'ambiance':
        this.#open.mood = signal.moodScore;
        this.#open.turbulence = signal.turbulence;
        break;
      case 'current':
        this.#open.current = signal.velocity;
        break;
    }
  }

  /** Close the open bucket into the ring and start a new one. */
  tick(): void {
    for (const ch of SCOPE_CHANNELS) this.#series[ch][this.#head] = this.#open[ch];
    this.#head = (this.#head + 1) % this.length;
    this.#filled = Math.min(this.#filled + 1, this.length);
    this.#open.pulse = 0;
  }

  /** Start a fresh history. Held mood/turbulence/current values are kept: they are still true. */
  clearHistory(): void {
    this.#head = 0;
    this.#filled = 0;
    this.#open.pulse = 0;
  }

  /** Closed buckets, oldest first. null where a channel had no value yet. */
  series(ch: ScopeChannel): (number | null)[] {
    const out: (number | null)[] = [];
    const data = this.#series[ch];
    for (let i = 0; i < this.#filled; i++) {
      const v = data[(this.#head - this.#filled + i + this.length) % this.length] as number;
      out.push(Number.isNaN(v) ? null : v);
    }
    return out;
  }

  /** The most recent closed value, or null. */
  latest(ch: ScopeChannel): number | null {
    if (this.#filled === 0) return null;
    const v = this.#series[ch][(this.#head - 1 + this.length) % this.length] as number;
    return Number.isNaN(v) ? null : v;
  }
}

/**
 * An SVG polyline path for a series in a `width` x `height` box, y up. Gaps (null) break the
 * line. Points are right-aligned so the newest value is always at the right edge.
 */
export function sparklinePath(
  values: readonly (number | null)[],
  capacity: number,
  width: number,
  height: number,
): string {
  if (capacity < 2) return '';
  const step = width / (capacity - 1);
  const offset = capacity - values.length;
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = (offset + i) * step;
    const y = height - Math.max(0, Math.min(1, v)) * height;
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  });
  return d;
}
