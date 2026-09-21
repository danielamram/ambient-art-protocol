/**
 * Adaptive quality with hysteresis. Feed it the measured fps each window; it answers with a new
 * level only when one should change. Pure so the thresholds are unit-tested.
 */
export interface QualityLevel {
  readonly name: string;
  /** Scene resolution as a fraction of the canvas. */
  readonly renderScale: number;
  readonly blurIterations: 1 | 2;
  /** Value of the `AAP_QUALITY` define handed to themes (1 = full, 0 = cheap). */
  readonly shaderQuality: 0 | 1;
}

/** From best to cheapest. The controller walks down on sustained low fps and back up when it can. */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { name: 'full', renderScale: 1, blurIterations: 2, shaderQuality: 1 },
  { name: 'three-quarter', renderScale: 0.75, blurIterations: 2, shaderQuality: 1 },
  { name: 'half', renderScale: 0.5, blurIterations: 1, shaderQuality: 1 },
  { name: 'low', renderScale: 0.5, blurIterations: 1, shaderQuality: 0 },
];

export interface QualityControllerOptions {
  readonly levels?: readonly QualityLevel[];
  /** Fps below this, sustained for `downAfterSeconds`, steps quality down. Default 45. */
  readonly lowFps?: number;
  /** Fps above this, sustained for `upAfterSeconds`, steps quality up. Default 58. */
  readonly highFps?: number;
  readonly downAfterSeconds?: number;
  readonly upAfterSeconds?: number;
  /** Ignore readings this long after `reset()` (shader compile stalls, tab switches). Default 2. */
  readonly warmupSeconds?: number;
  readonly initialIndex?: number;
}

export class QualityController {
  readonly levels: readonly QualityLevel[];
  readonly lowFps: number;
  readonly highFps: number;
  readonly downAfterSeconds: number;
  readonly upAfterSeconds: number;
  readonly warmupSeconds: number;
  #index: number;
  #lowFor = 0;
  #highFor = 0;
  #warm = 0;

  constructor(options: QualityControllerOptions = {}) {
    this.levels = options.levels ?? QUALITY_LEVELS;
    if (this.levels.length === 0) throw new Error('QualityController needs at least one level');
    this.lowFps = options.lowFps ?? 45;
    this.highFps = options.highFps ?? 58;
    this.downAfterSeconds = options.downAfterSeconds ?? 2;
    this.upAfterSeconds = options.upAfterSeconds ?? 10;
    this.warmupSeconds = options.warmupSeconds ?? 2;
    this.#index = Math.min(this.levels.length - 1, Math.max(0, options.initialIndex ?? 0));
  }

  get level(): QualityLevel {
    return this.levels[this.#index] as QualityLevel;
  }

  get index(): number {
    return this.#index;
  }

  /** Forget accumulated evidence and start a new warmup, e.g. after a theme switch. */
  reset(): void {
    this.#lowFor = 0;
    this.#highFor = 0;
    this.#warm = 0;
  }

  /** Jump to a level directly (host picked a fixed mode). */
  set(index: number): QualityLevel {
    this.#index = Math.min(this.levels.length - 1, Math.max(0, Math.floor(index)));
    this.reset();
    return this.level;
  }

  /**
   * Report one measurement window. `dt` is the window length in seconds.
   * Returns the new level when it changed, otherwise undefined.
   */
  feed(fps: number, dt: number): QualityLevel | undefined {
    if (!Number.isFinite(fps) || !Number.isFinite(dt) || dt <= 0) return undefined;
    if (this.#warm < this.warmupSeconds) {
      this.#warm += dt;
      return undefined;
    }
    if (fps < this.lowFps) {
      this.#lowFor += dt;
      this.#highFor = 0;
      if (this.#lowFor >= this.downAfterSeconds && this.#index < this.levels.length - 1) {
        this.#index += 1;
        this.#lowFor = 0;
        return this.level;
      }
      return undefined;
    }
    if (fps > this.highFps) {
      this.#highFor += dt;
      this.#lowFor = 0;
      if (this.#highFor >= this.upAfterSeconds && this.#index > 0) {
        this.#index -= 1;
        this.#highFor = 0;
        return this.level;
      }
      return undefined;
    }
    this.#lowFor = 0;
    this.#highFor = 0;
    return undefined;
  }
}
