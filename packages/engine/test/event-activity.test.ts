import { DataSignalBus } from '@ambient/sdk';
import { describe, expect, it } from 'vitest';
import { EventActivity } from '../src/event-activity.js';
import { SignalToUniformMapper } from '../src/mapper.js';

describe('event activity', () => {
  it('stays silent without pulses and ignores invalid magnitudes', () => {
    const a = new EventActivity();
    for (const value of [0, -1, Number.NaN, Infinity]) a.push(value);
    a.tick(20);
    expect(a.value).toBe(0);
  });
  it('rises smoothly, reflects magnitude, and decays after activity stops', () => {
    const small = new EventActivity();
    const large = new EventActivity();
    small.push(0.2);
    large.push(0.8);
    expect(large.value).toBe(0);
    small.tick(0.5);
    large.tick(0.5);
    expect(large.value).toBeGreaterThan(small.value);
    expect(large.value).toBeGreaterThan(0.1);
    large.tick(120);
    expect(large.value).toBeLessThan(0.000001);
  });
  it('bounds a burst and counts pulses beyond the rendering ring capacity', () => {
    const a = new EventActivity();
    for (let i = 0; i < 10000; i++) a.push(1);
    a.tick(1);
    expect(a.value).toBeGreaterThan(0.7);
    expect(a.value).toBeLessThanOrEqual(1);
  });
  it('integrates the same schedule equally at 30/60/120 Hz', () => {
    const results = [30, 60, 120].map((hz) => {
      const a = new EventActivity();
      for (let i = 0; i < hz * 6; i++) {
        if (i % hz === 0) a.push(0.5);
        a.tick(1 / hz);
      }
      return a.value;
    });
    expect(results[0]).toBeCloseTo(results[1] ?? 0, 10);
    expect(results[1]).toBeCloseTo(results[2] ?? 0, 10);
  });
  it('freezes for zero/invalid time and clears on disposal', () => {
    const a = new EventActivity();
    a.push(1);
    a.tick(1);
    const before = a.value;
    for (const dt of [0, -1, Number.NaN, Infinity]) a.tick(dt);
    expect(a.value).toBe(before);
    a.clear();
    expect(a.value).toBe(0);
  });
  it('uses bus pulses and direct pulses consistently; other signals cannot create activity', () => {
    const bus = new DataSignalBus();
    const live = new SignalToUniformMapper().attach(bus);
    const direct = new SignalToUniformMapper();
    bus.emitPayload({ type: 'current', x: 0.2, y: 0.8, velocity: 1 }, 'source');
    bus.emitPayload({ type: 'ambiance', moodScore: 1, turbulence: 1 }, 'source');
    live.tick(1);
    expect(live.snapshot().u_activity).toBe(0);
    bus.emitPayload({ type: 'pulse', magnitude: 0.8 }, 'source');
    direct.pushPulse({ magnitude: 0.8 });
    live.tick(0.5);
    direct.tick(0.5);
    expect(live.snapshot().u_activity).toBe(direct.snapshot().u_activity);
    live.dispose();
    expect(live.snapshot().u_activity).toBe(0);
    bus.emitPayload({ type: 'pulse', magnitude: 1 }, 'source');
    live.tick(1);
    expect(live.snapshot().u_activity).toBe(0);
    direct.dispose();
  });
});
