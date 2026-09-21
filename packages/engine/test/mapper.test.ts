import { DataSignalBus } from '@ambient/sdk';
import { describe, expect, it } from 'vitest';
import { SignalToUniformMapper } from '../src/mapper.js';

const src = 'test';

describe('SignalToUniformMapper', () => {
  it('has sensible defaults before any signal', () => {
    const m = new SignalToUniformMapper();
    const s = m.snapshot();
    expect(s.u_time).toBe(0);
    expect(s.u_mood).toBe(0.5);
    expect(s.u_turbulence).toBe(0.2);
    expect(s.u_current).toEqual([0.5, 0.5, 0]);
    expect(s.u_pulse).toBe(0);
    expect(s.u_pulses).toHaveLength(32);
    expect(s.u_resolution).toEqual([1, 1]);
  });

  it('honors initial values and setResolution', () => {
    const m = new SignalToUniformMapper({
      initial: { mood: 0.9, turbulence: 0, current: [0, 1, 1] },
    });
    m.setResolution(1920, 1080);
    const s = m.snapshot();
    expect(s.u_mood).toBe(0.9);
    expect(s.u_turbulence).toBe(0);
    expect(s.u_current).toEqual([0, 1, 1]);
    expect(s.u_resolution).toEqual([1920, 1080]);
  });

  it('accumulates time and ignores bad dt', () => {
    const m = new SignalToUniformMapper();
    m.tick(0.5);
    m.tick(-1);
    m.tick(Number.NaN);
    m.tick(0.25);
    expect(m.snapshot().u_time).toBeCloseTo(0.75, 10);
  });

  it('glides toward ambiance targets instead of jumping', () => {
    const bus = new DataSignalBus();
    const m = new SignalToUniformMapper({ moodTau: 1, turbulenceTau: 1 }).attach(bus);
    bus.emitPayload({ type: 'ambiance', moodScore: 1, turbulence: 1 }, src);
    expect(m.targets()).toMatchObject({ mood: 1, turbulence: 1 });
    expect(m.snapshot().u_mood).toBe(0.5);
    m.tick(1);
    const after1 = m.snapshot();
    expect(after1.u_mood).toBeCloseTo(0.5 + 0.5 * (1 - Math.exp(-1)), 8);
    expect(after1.u_turbulence).toBeCloseTo(0.2 + 0.8 * (1 - Math.exp(-1)), 8);
    for (let i = 0; i < 20; i += 1) m.tick(1);
    expect(m.snapshot().u_mood).toBeCloseTo(1, 6);
  });

  it('is frame-rate independent end to end', () => {
    const a = new SignalToUniformMapper({ moodTau: 0.5 });
    const b = new SignalToUniformMapper({ moodTau: 0.5 });
    a.setTarget({ mood: 0 });
    b.setTarget({ mood: 0 });
    a.tick(1);
    for (let i = 0; i < 60; i += 1) b.tick(1 / 60);
    expect(a.snapshot().u_mood).toBeCloseTo(b.snapshot().u_mood, 10);
  });

  it('damps the current vector component-wise', () => {
    const bus = new DataSignalBus();
    const m = new SignalToUniformMapper({ currentTau: 0.5 }).attach(bus);
    bus.emitPayload({ type: 'current', x: 1, y: 0, velocity: 1 }, src);
    m.tick(0.5);
    const k = 1 - Math.exp(-1);
    const [x, y, v] = m.snapshot().u_current;
    expect(x).toBeCloseTo(0.5 + 0.5 * k, 8);
    expect(y).toBeCloseTo(0.5 - 0.5 * k, 8);
    expect(v).toBeCloseTo(k, 8);
  });

  it('pulses land at full strength immediately and decay', () => {
    const bus = new DataSignalBus();
    const m = new SignalToUniformMapper({ pulses: { decay: 1, lifetime: 10 } }).attach(bus);
    bus.emitPayload({ type: 'pulse', magnitude: 0.7, location: { x: 0.25, y: 0.75 } }, src);
    m.tick(0);
    let s = m.snapshot();
    expect(s.u_pulse).toBeCloseTo(0.7, 6);
    expect(Array.from(s.u_pulses.slice(0, 4))).toEqual([0.25, 0.75, 0, expect.closeTo(0.7, 6)]);
    m.tick(1);
    s = m.snapshot();
    expect(s.u_pulse).toBeCloseTo(0.7 * Math.exp(-1), 6);
  });

  it('settle() snaps to targets', () => {
    const m = new SignalToUniformMapper();
    m.setTarget({ mood: 0.1, turbulence: 0.9, current: [0, 0, 1] });
    m.settle();
    const s = m.snapshot();
    expect(s.u_mood).toBe(0.1);
    expect(s.u_turbulence).toBe(0.9);
    expect(s.u_current).toEqual([0, 0, 1]);
  });

  it('detach() and dispose() stop listening', () => {
    const bus = new DataSignalBus();
    const m = new SignalToUniformMapper().attach(bus);
    expect(m.attached).toBe(true);
    m.detach();
    expect(m.attached).toBe(false);
    bus.emitPayload({ type: 'ambiance', moodScore: 1, turbulence: 1 }, src);
    expect(m.targets().mood).toBe(0.5);
    m.attach(bus);
    bus.emitPayload({ type: 'pulse', magnitude: 1 }, src);
    m.dispose();
    m.tick(0);
    expect(m.attached).toBe(false);
    expect(m.snapshot().u_pulse).toBe(0);
  });

  it('re-attaching swaps buses cleanly', () => {
    const a = new DataSignalBus();
    const b = new DataSignalBus();
    const m = new SignalToUniformMapper().attach(a).attach(b);
    a.emitPayload({ type: 'ambiance', moodScore: 0, turbulence: 0 }, src);
    expect(m.targets().mood).toBe(0.5);
    b.emitPayload({ type: 'ambiance', moodScore: 1, turbulence: 0 }, src);
    expect(m.targets().mood).toBe(1);
  });
});
