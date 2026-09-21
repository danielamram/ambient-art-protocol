import type { SignalType } from '../protocol.js';
import { createSource } from '../source.js';

export interface MockSourceConfig {
  /** How often to emit, in ms. Default 500. */
  readonly intervalMs?: number;
  /** Seed for the deterministic PRNG. Default 1. */
  readonly seed?: number;
  /** Which signal types to emit. Default all three, round-robin. */
  readonly types?: readonly SignalType[];
}

/** mulberry32: tiny, deterministic, good enough for demo noise. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A deterministic source that emits random-but-repeatable signals on a timer.
 * Useful for shader development, demos, and tests.
 */
export const createMockSource = createSource<MockSourceConfig>({
  id: 'mock',
  name: 'Mock Source',
  description: 'Deterministic pseudo-random signals on an interval.',
  start(ctx) {
    const intervalMs = ctx.config?.intervalMs ?? 500;
    const rand = mulberry32(ctx.config?.seed ?? 1);
    const types = ctx.config?.types ?? ['ambiance', 'current', 'pulse'];
    let i = 0;
    const tick = () => {
      const type = types[i % types.length];
      i += 1;
      switch (type) {
        case 'pulse':
          ctx.pulse({ magnitude: rand(), location: { x: rand(), y: rand() } });
          break;
        case 'current':
          ctx.current({ x: rand(), y: rand(), velocity: rand() });
          break;
        case 'ambiance':
          ctx.ambiance({ moodScore: rand(), turbulence: rand() });
          break;
        default:
          break;
      }
    };
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  },
});
