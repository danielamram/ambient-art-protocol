/** Bounded screen-space drag inertia. Uses art time: pause and reduced motion are respected.
 * The host may already smooth pointer samples; this does not require new DOM events.
 * One local elastic wake, not a particle simulation or a full gesture path recorder.
 */
export class GestureMemory {
  readonly uniform = new Float32Array([0.5, 0.5, 0, 0]);
  #last: readonly [number, number] | undefined;
  #vx = 0;
  #vy = 0;

  reset(): void {
    this.uniform.set([0.5, 0.5, 0, 0]);
    this.#last = undefined;
    this.#vx = this.#vy = 0;
  }

  advance(pointer: readonly [number, number, number], dt: number): void {
    if (!pointer.every(Number.isFinite)) {
      this.reset();
      return;
    }
    const x = Math.max(0, Math.min(1, pointer[0]));
    const y = Math.max(0, Math.min(1, pointer[1]));
    const held = pointer[2] > 0.2;
    // Consume samples while frozen; resuming must not interpret them as a large drag.
    if (!Number.isFinite(dt) || dt <= 0) {
      this.#last = held ? [x, y] : undefined;
      return;
    }
    const step = Math.min(dt, 0.1);
    if (held) {
      this.uniform[0] = x;
      this.uniform[1] = y;
      if (this.#last) {
        const dx = x - this.#last[0];
        const dy = y - this.#last[1];
        const length = Math.hypot(dx, dy);
        // Limit sampled speed and total momentum, including tab-resume discontinuities.
        const scale = length > 0 ? Math.min(1, (step * 2) / length) : 0;
        this.#vx += dx * scale * 14;
        this.#vy += dy * scale * 14;
      }
      this.#last = [x, y];
    } else this.#last = undefined;
    const speed = Math.hypot(this.#vx, this.#vy);
    if (speed > 1.5) {
      this.#vx *= 1.5 / speed;
      this.#vy *= 1.5 / speed;
    }
    // Exact underdamped spring solution for each sample interval (decay=3, frequency=6).
    const decay = Math.exp(-3 * step);
    const cos = Math.cos(6 * step);
    const sin = Math.sin(6 * step);
    const integrate = (position: number, velocity: number): [number, number] => [
      decay * (position * cos + ((velocity + 3 * position) / 6) * sin),
      decay * (velocity * cos - ((3 * velocity + 45 * position) / 6) * sin),
    ];
    [this.uniform[2], this.#vx] = integrate(this.uniform[2] ?? 0, this.#vx);
    [this.uniform[3], this.#vy] = integrate(this.uniform[3] ?? 0, this.#vy);
  }
}
