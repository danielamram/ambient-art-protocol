import { describe, expect, it } from 'vitest';
import { GestureMemory } from '../src/gesture-memory.js';

const drag = (hz: number) => {
  const memory = new GestureMemory();
  memory.advance([0.3, 0.5, 1], 1 / hz);
  for (let i = 1; i <= hz / 2; i++) memory.advance([0.3 + (i / hz) * 0.4, 0.5, 1], 1 / hz);
  return memory;
};

describe('GestureMemory', () => {
  it('starts without a jump, retains momentum on release, and recovers', () => {
    const memory = drag(60);
    expect(memory.uniform[2]).toBeGreaterThan(0.02);
    const before = memory.uniform[2] ?? 0;
    memory.advance([0.5, 0.5, 0], 1 / 60);
    expect(Math.abs((memory.uniform[2] ?? 0) - before)).toBeLessThan(0.01);
    for (let i = 0; i < 600; i++) memory.advance([0.5, 0.5, 0], 1 / 60);
    expect(Math.abs(memory.uniform[2] ?? 1)).toBeLessThan(0.00001);
  });
  it('gives comparable responses at 30, 60, and 120 Hz', () => {
    const offsets = [30, 60, 120].map((hz) => drag(hz).uniform[2] ?? 0);
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThan(0.01);
  });
  it('freezes during pause and consumes motion without a resume jump', () => {
    const memory = drag(60);
    const before = [...memory.uniform];
    memory.advance([0.9, 0.9, 1], 0);
    expect([...memory.uniform]).toEqual(before);
    memory.advance([0.9, 0.9, 1], 1 / 60);
    expect(Math.abs(memory.uniform[3] ?? 1)).toBeLessThan(0.00001);
  });
  it('does not accumulate hover motion and resets invalid samples', () => {
    const memory = new GestureMemory();
    memory.advance([0, 0, 0], 0.1);
    memory.advance([1, 1, 0], 0.1);
    memory.advance([1, 1, 1], 0.1);
    expect(memory.uniform[2]).toBe(0);
    memory.advance([Number.NaN, 0, 1], 0.1);
    expect([...memory.uniform]).toEqual([0.5, 0.5, 0, 0]);
  });
  it('bounds repeated extreme input and supports explicit reset', () => {
    const memory = new GestureMemory();
    for (let i = 0; i < 1000; i++) {
      memory.advance([i % 2, (i + 1) % 2, 1], 10);
      expect(Math.hypot(memory.uniform[2] ?? 0, memory.uniform[3] ?? 0)).toBeLessThan(0.4);
    }
    memory.reset();
    expect([...memory.uniform]).toEqual([0.5, 0.5, 0, 0]);
  });
});
