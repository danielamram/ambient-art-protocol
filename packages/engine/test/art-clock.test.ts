import { describe, expect, it } from 'vitest';
import { ArtClock } from '../src/art-clock.js';

describe('ArtClock', () => {
  it('advances equally for 30, 60, and 120 Hz schedules', () => {
    const times = [30, 60, 120].map((fps) => {
      const clock = new ArtClock();
      for (let i = 0; i < fps * 4; i++) clock.advance(1 / fps);
      return clock.time;
    });
    expect(times[0]).toBeCloseTo(times[1] ?? 0, 8);
    expect(times[1]).toBeCloseTo(times[2] ?? 0, 8);
  });
  it('freezes completely on pause and resumes without catching up', () => {
    const clock = new ArtClock();
    clock.advance(0.1);
    const before = clock.time;
    clock.paused = true;
    expect(clock.advance(30)).toBe(0);
    expect(clock.time).toBe(before);
    clock.paused = false;
    expect(clock.advance(0.01)).toBeGreaterThan(0);
  });
  it('slows artwork for reduced motion and rejects invalid deltas', () => {
    const normal = new ArtClock();
    const reduced = new ArtClock();
    reduced.reduced = true;
    expect(reduced.advance(0.1)).toBeCloseTo(normal.advance(0.1) * 0.12);
    const before = reduced.time;
    for (const dt of [Number.NaN, -1, Infinity]) expect(reduced.advance(dt)).toBe(0);
    expect(reduced.time).toBe(before);
  });
});
