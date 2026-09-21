import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSignalBus } from '../src/bus.js';
import type { VisualSignal } from '../src/protocol.js';
import { createMockSource, mulberry32 } from '../src/testing/index.js';

describe('mulberry32', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i += 1) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('createMockSource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function run(seed: number, types?: ('pulse' | 'current' | 'ambiance')[]) {
    const bus = new DataSignalBus({ now: () => 0 });
    const seen: VisualSignal[] = [];
    bus.stream$.subscribe((s) => seen.push(s));
    const src = createMockSource(
      types ? { seed, intervalMs: 10, types } : { seed, intervalMs: 10 },
    );
    await src.start(bus);
    vi.advanceTimersByTime(60);
    await src.stop();
    vi.advanceTimersByTime(60);
    return seen;
  }

  it('produces identical sequences for the same seed', async () => {
    const a = await run(7);
    const b = await run(7);
    expect(a).toEqual(b);
    expect(a).toHaveLength(6);
  });

  it('round-robins the requested types and stops cleanly', async () => {
    const seen = await run(1, ['pulse', 'ambiance']);
    expect(seen.map((s) => s.type)).toEqual([
      'pulse',
      'ambiance',
      'pulse',
      'ambiance',
      'pulse',
      'ambiance',
    ]);
  });
});
