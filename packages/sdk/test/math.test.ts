import { describe, expect, it } from 'vitest';
import { clamp01, isUnit, normalize } from '../src/math.js';

describe('clamp01', () => {
  it('leaves in-range values alone', () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
  });

  it('clamps out-of-range values', () => {
    expect(clamp01(1.7)).toBe(1);
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('maps NaN and -0 to 0', () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(Object.is(clamp01(-0), 0)).toBe(true);
  });
});

describe('isUnit', () => {
  it.each([
    [0, true],
    [1, true],
    [0.25, true],
    [-0.01, false],
    [1.01, false],
    [Number.NaN, false],
    ['0.5', false],
    [null, false],
  ])('isUnit(%p) -> %p', (value, expected) => {
    expect(isUnit(value)).toBe(expected);
  });
});

describe('normalize', () => {
  it('maps a range onto [0, 1]', () => {
    expect(normalize(50, 0, 100)).toBe(0.5);
    expect(normalize(-10, -10, 35)).toBe(0);
    expect(normalize(35, -10, 35)).toBe(1);
  });

  it('clamps values outside the input range', () => {
    expect(normalize(200, 0, 100)).toBe(1);
    expect(normalize(-5, 0, 100)).toBe(0);
  });

  it('returns 0 for a degenerate range', () => {
    expect(normalize(5, 3, 3)).toBe(0);
  });
});
