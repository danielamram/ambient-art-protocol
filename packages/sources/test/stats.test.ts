import { describe, expect, it } from 'vitest';
import { hashToPoint, RateWindow, RollingSeries } from '../src/stats.js';

describe('RateWindow', () => {
  it('counts only events inside the window', () => {
    const w = new RateWindow(1000);
    w.push(0);
    w.push(500);
    w.push(999);
    expect(w.count(999)).toBe(3);
    expect(w.count(1500)).toBe(2);
    expect(w.count(2500)).toBe(0);
  });

  it('reports events per second', () => {
    const w = new RateWindow(2000);
    for (let t = 0; t < 2000; t += 100) w.push(t);
    expect(w.perSecond(1999)).toBe(10);
  });
});

describe('RollingSeries', () => {
  it('keeps the last N values and computes mean and stddev', () => {
    const s = new RollingSeries(3);
    for (const v of [1, 2, 3, 4]) s.push(v);
    expect(s.size).toBe(3);
    expect(s.first()).toBe(2);
    expect(s.last()).toBe(4);
    expect(s.mean()).toBe(3);
    expect(s.stddev()).toBeCloseTo(Math.sqrt(2 / 3), 10);
  });

  it('returns 0 stddev for fewer than two samples', () => {
    const s = new RollingSeries(5);
    expect(s.stddev()).toBe(0);
    s.push(7);
    expect(s.stddev()).toBe(0);
  });
});

describe('hashToPoint', () => {
  it('is deterministic, in range, and spreads different keys apart', () => {
    const a = hashToPoint('en.wikipedia.org/Cat');
    const b = hashToPoint('en.wikipedia.org/Cat');
    const c = hashToPoint('en.wikipedia.org/Dog');
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    for (const p of [a, c]) {
      expect(p.x).toBeGreaterThanOrEqual(0.08);
      expect(p.x).toBeLessThanOrEqual(0.92);
      expect(p.y).toBeGreaterThanOrEqual(0.08);
      expect(p.y).toBeLessThanOrEqual(0.92);
    }
  });
});
