import type { VisualSignal } from '@ambient/sdk';
import { describe, expect, it } from 'vitest';
import { SignalScope, sparklinePath } from '../src/state/signal-scope.js';

const meta = { v: 1 as const, sourceId: 't', ts: 0 };
const pulse = (magnitude: number): VisualSignal => ({ ...meta, type: 'pulse', magnitude });
const ambiance = (moodScore: number, turbulence: number): VisualSignal => ({
  ...meta,
  type: 'ambiance',
  moodScore,
  turbulence,
});
const current = (velocity: number): VisualSignal => ({
  ...meta,
  type: 'current',
  x: 0.5,
  y: 0.5,
  velocity,
});

describe('SignalScope', () => {
  it('keeps the strongest pulse per bucket and drops to zero in quiet buckets', () => {
    const s = new SignalScope(4);
    s.record(pulse(0.3));
    s.record(pulse(0.9));
    s.record(pulse(0.5));
    s.tick();
    s.tick();
    expect(s.series('pulse')).toEqual([expect.closeTo(0.9, 5), 0]);
  });

  it('holds mood, turbulence and current between signals, with gaps before the first', () => {
    const s = new SignalScope(4);
    s.tick();
    s.record(ambiance(0.25, 0.75));
    s.record(current(0.5));
    s.tick();
    s.tick();
    expect(s.series('mood')).toEqual([null, 0.25, 0.25]);
    expect(s.series('turbulence')).toEqual([null, 0.75, 0.75]);
    expect(s.series('current')).toEqual([null, 0.5, 0.5]);
    expect(s.latest('mood')).toBe(0.25);
  });

  it('is a ring: only the newest `length` buckets remain, oldest first', () => {
    const s = new SignalScope(3);
    for (const m of [0.25, 0.5, 0.75, 1]) {
      s.record(pulse(m));
      s.tick();
    }
    expect(s.series('pulse')).toEqual([0.5, 0.75, 1]);
  });

  it('clearing history keeps held values, which are still true', () => {
    const s = new SignalScope(3);
    s.record(ambiance(1, 0));
    s.record(pulse(1));
    s.tick();
    s.clearHistory();
    expect(s.series('mood')).toEqual([]);
    expect(s.latest('mood')).toBeNull();
    s.tick();
    expect(s.series('mood')).toEqual([1]);
    expect(s.series('pulse')).toEqual([0]);
  });
});

describe('sparklinePath', () => {
  it('right-aligns points, flips y, and breaks at gaps', () => {
    expect(sparklinePath([0, 1], 3, 100, 10)).toBe('M50.0 10.0L100.0 0.0');
    expect(sparklinePath([0.5, null, 0.5], 3, 100, 10)).toBe('M0.0 5.0M100.0 5.0');
    expect(sparklinePath([], 3, 100, 10)).toBe('');
  });
});
