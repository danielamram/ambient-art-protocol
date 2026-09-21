import { describe, expect, it } from 'vitest';
import { expDamp, expDampAngle } from '../src/damp.js';

describe('expDamp', () => {
  it('moves toward the target and never overshoots', () => {
    let v = 0;
    for (let i = 0; i < 100; i += 1) {
      const next = expDamp(v, 1, 0.5, 1 / 60);
      expect(next).toBeGreaterThan(v);
      expect(next).toBeLessThanOrEqual(1);
      v = next;
    }
    expect(v).toBeCloseTo(1, 1);
  });

  it('closes 1 - 1/e of the gap after tau seconds', () => {
    expect(expDamp(0, 1, 1, 1)).toBeCloseTo(1 - Math.exp(-1), 10);
  });

  it('is frame-rate independent: many small steps equal one large step', () => {
    let small = 0;
    for (let i = 0; i < 16; i += 1) small = expDamp(small, 1, 0.4, 1 / 16);
    const large = expDamp(0, 1, 0.4, 1);
    expect(small).toBeCloseTo(large, 10);
  });

  it('snaps when tau or dt is non-positive', () => {
    expect(expDamp(0, 1, 0, 0.016)).toBe(1);
    expect(expDamp(0, 1, 0.5, 0)).toBe(1);
  });
});

describe('expDampAngle', () => {
  it('takes the short way around the circle', () => {
    const from = 0.1;
    const to = Math.PI * 2 - 0.1; // just below a full turn, i.e. -0.1 rad
    const next = expDampAngle(from, to, 0.1, 10);
    expect(next).toBeCloseTo(-0.1, 4);
  });
});
