import type { Unit } from './protocol.js';

/**
 * Clamp a number into [0, 1].
 * NaN and -Infinity become 0, +Infinity becomes 1, -0 becomes 0.
 * Use `assertFinite` first if you want NaN to be an error instead.
 */
export function clamp01(n: number): Unit {
  if (Number.isNaN(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

/** True when `n` is a finite number inside [0, 1]. */
export function isUnit(n: unknown): n is Unit {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

/** Linearly map `n` from [inMin, inMax] onto [0, 1], clamped. Handy for plugin authors. */
export function normalize(n: number, inMin: number, inMax: number): Unit {
  if (inMax === inMin) return 0;
  return clamp01((n - inMin) / (inMax - inMin));
}
