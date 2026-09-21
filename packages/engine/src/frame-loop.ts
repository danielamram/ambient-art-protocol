export type FrameCallback = (dtSeconds: number, nowSeconds: number) => void;

export interface FrameLoopOptions {
  /** Cap on dt so a background tab or breakpoint does not produce a giant jump. Default 0.1s. */
  readonly maxDt?: number;
  /** Override the scheduler. Defaults to requestAnimationFrame, or a 16ms timeout outside a browser. */
  readonly schedule?: (cb: (nowMs: number) => void) => () => void;
  readonly now?: () => number;
}

function defaultSchedule(cb: (nowMs: number) => void): () => void {
  const g = globalThis as {
    requestAnimationFrame?: (f: (t: number) => void) => number;
    cancelAnimationFrame?: (h: number) => void;
  };
  if (typeof g.requestAnimationFrame === 'function') {
    const handle = g.requestAnimationFrame(cb);
    return () => g.cancelAnimationFrame?.(handle);
  }
  const handle = setTimeout(() => cb(Date.now()), 16);
  return () => clearTimeout(handle);
}

/**
 * Calls `onFrame(dt, now)` once per animation frame with a clamped, seconds-based dt.
 * Isomorphic: uses requestAnimationFrame when present, a 16ms timer otherwise.
 */
export class FrameLoop {
  readonly maxDt: number;
  readonly #schedule: (cb: (nowMs: number) => void) => () => void;
  readonly #now: () => number;
  readonly #onFrame: FrameCallback;
  #cancel: (() => void) | undefined;
  #last: number | undefined;
  #running = false;

  constructor(onFrame: FrameCallback, options: FrameLoopOptions = {}) {
    this.#onFrame = onFrame;
    this.maxDt = options.maxDt ?? 0.1;
    this.#schedule = options.schedule ?? defaultSchedule;
    this.#now =
      options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  get running(): boolean {
    return this.#running;
  }

  start(): this {
    if (this.#running) return this;
    this.#running = true;
    this.#last = undefined;
    this.#arm();
    return this;
  }

  stop(): void {
    this.#running = false;
    this.#cancel?.();
    this.#cancel = undefined;
  }

  #arm(): void {
    this.#cancel = this.#schedule((nowMs) => {
      if (!this.#running) return;
      const now = Number.isFinite(nowMs) ? nowMs : this.#now();
      const dtRaw = this.#last === undefined ? 0 : (now - this.#last) / 1000;
      this.#last = now;
      const dt = Math.min(Math.max(dtRaw, 0), this.maxDt);
      this.#onFrame(dt, now / 1000);
      if (this.#running) this.#arm();
    });
  }
}
