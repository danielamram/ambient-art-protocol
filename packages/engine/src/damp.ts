/**
 * Frame-rate independent exponential smoothing.
 *
 * Moves `current` toward `target` such that after `tau` seconds the remaining gap is 1/e of
 * what it was. Two ticks of dt/2 land exactly where one tick of dt does, so the feel is the
 * same at 30, 60, or 144 FPS.
 */
export function expDamp(current: number, target: number, tau: number, dt: number): number {
  if (tau <= 0 || dt <= 0) return target;
  const k = 1 - Math.exp(-dt / tau);
  return current + (target - current) * k;
}

/** Angle-aware damping for a 2D direction: shortest path around the circle. */
export function expDampAngle(current: number, target: number, tau: number, dt: number): number {
  const twoPi = Math.PI * 2;
  let delta = (target - current) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return expDamp(current, current + delta, tau, dt);
}
