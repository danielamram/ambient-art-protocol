/** Small rolling-window helpers shared by the built-in sources. Pure and easy to test. */

/** Counts events inside a sliding time window and reports events per second. */
export class RateWindow {
  readonly windowMs: number;
  readonly #stamps: number[] = [];

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  push(now: number): void {
    this.#stamps.push(now);
    this.prune(now);
  }

  prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.#stamps.length > 0 && (this.#stamps[0] ?? 0) < cutoff) this.#stamps.shift();
  }

  count(now: number): number {
    this.prune(now);
    return this.#stamps.length;
  }

  perSecond(now: number): number {
    return this.count(now) / (this.windowMs / 1000);
  }

  clear(): void {
    this.#stamps.length = 0;
  }
}

/** Keeps the last `capacity` numeric samples and computes simple statistics over them. */
export class RollingSeries {
  readonly capacity: number;
  readonly #values: number[] = [];

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  push(v: number): void {
    this.#values.push(v);
    if (this.#values.length > this.capacity) this.#values.shift();
  }

  get size(): number {
    return this.#values.length;
  }

  first(): number | undefined {
    return this.#values[0];
  }

  last(): number | undefined {
    return this.#values[this.#values.length - 1];
  }

  mean(): number {
    if (this.#values.length === 0) return 0;
    let s = 0;
    for (const v of this.#values) s += v;
    return s / this.#values.length;
  }

  /** Population standard deviation. */
  stddev(): number {
    if (this.#values.length < 2) return 0;
    const m = this.mean();
    let s = 0;
    for (const v of this.#values) s += (v - m) * (v - m);
    return Math.sqrt(s / this.#values.length);
  }

  clear(): void {
    this.#values.length = 0;
  }
}

/** Deterministic [0, 1] pair from a string, so the same key always lands on the same spot. */
export function hashToPoint(key: string): { x: number; y: number } {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i += 1) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  // Keep away from the very edges so ripples stay visible.
  return { x: 0.08 + (h1 / 4294967296) * 0.84, y: 0.08 + (h2 / 4294967296) * 0.84 };
}
