import { DataSignalBus, type VisualSignal } from '@ambient/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../src/poll.js';
import {
  mapSpaceWeather,
  parseKp,
  parseTableColumn,
  SWPC_KP_URL,
  SWPC_MAG_URL,
  SWPC_PLASMA_URL,
  spaceWeather,
} from '../src/space-weather.js';

const kpDoc = (...kps: number[]) =>
  kps.map((kp, i) => ({
    time_tag: `2026-09-24T00:0${i}:00`,
    kp_index: Math.round(kp),
    estimated_kp: kp,
    kp: `${kp}`,
  }));
const plasma = (speed: string) => [
  ['time_tag', 'density', 'speed', 'temperature'],
  ['2026-09-24 00:00:00.000', '4.1', '380.0', '90000'],
  ['2026-09-24 00:05:00.000', '4.3', speed, '91000'],
];
const mag = (by: string, bz: string) => [
  ['time_tag', 'bx_gsm', 'by_gsm', 'bz_gsm', 'lon_gsm', 'lat_gsm', 'bt'],
  ['2026-09-24 00:05:00.000', '1.0', by, bz, '10', '-20', '6.0'],
];

describe('parsers', () => {
  it('reads the latest estimated Kp, falling back to the integer index', () => {
    expect(parseKp(kpDoc(2.33, 4.67))).toBe(4.67);
    expect(parseKp([{ kp_index: 3 }, { estimated_kp: null, kp_index: 5 }])).toBe(5);
    expect(() => parseKp([])).toThrow();
    expect(() => parseKp({})).toThrow();
  });

  it('reads the latest numeric value of a named column from table products', () => {
    expect(parseTableColumn(plasma('512.3'), 'speed')).toBe(512.3);
    expect(parseTableColumn(plasma('null'), 'speed')).toBe(380);
    expect(parseTableColumn(plasma('500'), 'missing')).toBeUndefined();
    expect(parseTableColumn('nope', 'speed')).toBeUndefined();
  });
});

describe('mapSpaceWeather', () => {
  it('turns Kp into turbulence and a southward Bz into a higher mood', () => {
    const calm = mapSpaceWeather({ kp: 1, speed: 300, by: 0, bz: 5 });
    const storm = mapSpaceWeather({ kp: 8, speed: 750, by: 10, bz: -10 });
    expect(storm.turbulence).toBeGreaterThan(calm.turbulence);
    expect(storm.moodScore).toBe(1);
    expect(storm.current.velocity).toBeGreaterThan(calm.current.velocity);
    expect(storm.current.x).toBeGreaterThan(0.5);
  });

  it('is neutral where solar wind data is missing', () => {
    expect(mapSpaceWeather({ kp: 0 })).toEqual({
      turbulence: 0,
      moodScore: 0.5,
      current: { x: 0.5, y: 0.5, velocity: 0 },
    });
  });
});

describe('spaceWeather source', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes a reading on start, pulses on a sharp Kp rise, and survives missing wind data', async () => {
    let kp = [2];
    let windUp = true;
    const fetch: FetchLike = async (url) => {
      if (url === SWPC_KP_URL) return { ok: true, status: 200, json: async () => kpDoc(...kp) };
      if (!windUp) return { ok: false, status: 502, json: async () => null };
      if (url === SWPC_PLASMA_URL)
        return { ok: true, status: 200, json: async () => plasma('650') };
      if (url === SWPC_MAG_URL) return { ok: true, status: 200, json: async () => mag('4', '-8') };
      throw new Error(url);
    };
    const bus = new DataSignalBus();
    const seen: VisualSignal[] = [];
    bus.stream$.subscribe((s) => seen.push(s));
    const src = spaceWeather({ fetch, pollMs: 1000 });
    await src.start(bus);
    expect(src.status).toBe('running');
    expect(seen.find((s) => s.type === 'ambiance')).toMatchObject({
      turbulence: expect.closeTo(2 / 9, 5),
    });
    expect(seen.find((s) => s.type === 'current')).toMatchObject({
      velocity: expect.closeTo(400 / 550, 5),
    });
    expect(seen.filter((s) => s.type === 'pulse')).toHaveLength(0);

    kp = [2, 6];
    windUp = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen.filter((s) => s.type === 'pulse')).toHaveLength(1);
    const last = seen.filter((s) => s.type === 'current').at(-1);
    expect(last).toMatchObject({ x: 0.5, y: 0.5, velocity: 0 });
    expect(src.status).toBe('running');
    await src.stop();
  });

  it('cannot start without Kp', async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 503, json: async () => null });
    const src = spaceWeather({ fetch });
    await expect(src.start(new DataSignalBus())).rejects.toThrow('HTTP 503');
    expect(src.status).toBe('error');
  });
});
