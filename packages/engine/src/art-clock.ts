/** Independent art and wall clocks: motion preferences never change source timestamps. */
export class ArtClock {
  time = 0;
  motion = 0.45;
  paused = false;
  reduced = false;
  advance(dt: number): number {
    const safe = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    const step = this.paused ? 0 : safe * (this.motion * 1.7) * (this.reduced ? 0.12 : 1);
    this.time += step;
    return step;
  }
}
