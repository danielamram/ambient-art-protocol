import { describe, expect, it } from 'vitest';
import { PulseBuffer } from '../src/pulse-buffer.js';

describe('PulseBuffer', () => {
  it('starts empty and packs zeros', () => {
    const b = new PulseBuffer({ capacity: 4 });
    b.tick(0);
    expect(b.size).toBe(0);
    expect(b.peak()).toBe(0);
    expect(Array.from(b.packed)).toEqual(new Array(16).fill(0));
  });

  it('uses the default location when a pulse has none', () => {
    const b = new PulseBuffer();
    b.push({ magnitude: 1 });
    expect(b.list()[0]).toMatchObject({ x: 0.5, y: 0.5, age: 0, intensity: 1 });
    const custom = new PulseBuffer({ defaultLocation: () => ({ x: 0.1, y: 0.9 }) });
    custom.push({ magnitude: 1 });
    expect(custom.list()[0]).toMatchObject({ x: 0.1, y: 0.9 });
  });

  it('decays intensity exponentially and drops expired pulses', () => {
    const b = new PulseBuffer({ decay: 1, lifetime: 2 });
    b.push({ magnitude: 0.8, location: { x: 0.2, y: 0.3 } });
    b.tick(1);
    expect(b.peak()).toBeCloseTo(0.8 * Math.exp(-1), 6);
    expect(Array.from(b.packed.slice(0, 4))).toEqual([
      expect.closeTo(0.2, 6),
      expect.closeTo(0.3, 6),
      1,
      expect.closeTo(0.8 * Math.exp(-1), 6),
    ]);
    b.tick(1);
    expect(b.size).toBe(0);
    expect(b.peak()).toBe(0);
  });

  it('overwrites the oldest pulse when full', () => {
    const b = new PulseBuffer({ capacity: 2, lifetime: 100 });
    b.push({ magnitude: 0.1, location: { x: 0.1, y: 0 } });
    b.tick(0.5);
    b.push({ magnitude: 0.2, location: { x: 0.2, y: 0 } });
    b.tick(0.5);
    b.push({ magnitude: 0.3, location: { x: 0.3, y: 0 } });
    b.tick(0);
    const xs = b
      .list()
      .map((p) => p.x)
      .sort();
    expect(xs).toEqual([0.2, 0.3]);
    expect(b.size).toBe(2);
  });

  it('peak() reports the strongest live intensity', () => {
    const b = new PulseBuffer({ decay: 0 });
    b.push({ magnitude: 0.3 });
    b.push({ magnitude: 0.9 });
    b.push({ magnitude: 0.5 });
    b.tick(0.1);
    expect(b.peak()).toBeCloseTo(0.9, 6);
  });

  it('clear() empties the ring and the packed array', () => {
    const b = new PulseBuffer({ capacity: 2 });
    b.push({ magnitude: 1 });
    b.tick(0);
    b.clear();
    expect(b.size).toBe(0);
    expect(Array.from(b.packed)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
