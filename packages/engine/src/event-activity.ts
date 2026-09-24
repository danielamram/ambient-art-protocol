/** Smooth, bounded memory of received pulses. No timer, polling, or synthetic events.
 * Reservoir decays over 8 art seconds; the visible response follows over 0.6 seconds.
 * Closed-form integration keeps identical event schedules independent of frame rate.
 */
export class EventActivity {
  #reservoir = 0;
  #value = 0;
  get value(): number {
    return this.#value;
  }
  push(magnitude: number): void {
    if (!Number.isFinite(magnitude) || magnitude <= 0) return;
    const weight = Math.min(1, magnitude);
    this.#reservoir = 1 - (1 - this.#reservoir) * Math.exp(-weight * 0.3);
  }
  tick(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const slow = Math.exp(-dt / 8);
    const fast = Math.exp(-dt / 0.6);
    this.#value = Math.max(
      0,
      Math.min(1, this.#value * fast + (this.#reservoir * (slow - fast)) / (1 - 0.6 / 8)),
    );
    this.#reservoir *= slow;
  }
  clear(): void {
    this.#reservoir = this.#value = 0;
  }
}
