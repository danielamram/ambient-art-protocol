import { DataSignalBus, type VisualSignal } from '@ambient/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../src/poll.js';
import {
  geoToCanvas,
  parseFeed,
  parseQuake,
  summarizeQuakes,
  usgsEarthquakes,
} from '../src/usgs-earthquakes.js';

const quake = (id: string, mag: number, lon: number, lat: number, depth: number, time: number) => ({
  type: 'Feature',
  id,
  properties: { mag, time, place: 'somewhere' },
  geometry: { type: 'Point', coordinates: [lon, lat, depth] },
});
const feed = (...features: unknown[]) => ({ type: 'FeatureCollection', metadata: {}, features });
const cfg = { maxMagnitude: 7, maxDepthKm: 300 };

describe('geoToCanvas', () => {
  it('maps the globe to the canvas with north up and a margin', () => {
    expect(geoToCanvas(-180, 90)).toEqual({ x: 0.08, y: 0.08 });
    expect(geoToCanvas(0, 0)).toEqual({ x: 0.5, y: 0.5 });
    expect(geoToCanvas(180, -90)).toEqual({
      x: expect.closeTo(0.92, 9),
      y: expect.closeTo(0.92, 9),
    });
  });
});

describe('parseQuake / parseFeed', () => {
  it('skips features without a magnitude or coordinates', () => {
    expect(
      parseQuake({
        id: 'a',
        properties: { mag: null, time: 1 },
        geometry: { coordinates: [0, 0, 5] },
      }),
    ).toBeNull();
    expect(parseQuake({ id: 'b', properties: { mag: 2, time: 1 }, geometry: {} })).toBeNull();
    expect(parseQuake(quake('c', 2.5, 10, 20, -1, 5))).toMatchObject({
      id: 'c',
      mag: 2.5,
      depthKm: 0,
    });
  });

  it('rejects a document that is not a feed', () => {
    expect(() => parseFeed({ nope: true })).toThrow(/features/);
    expect(parseFeed(feed(quake('a', 1, 0, 0, 10, 1), { junk: 1 }))).toHaveLength(1);
  });
});

describe('summarizeQuakes', () => {
  it('is neutral with no quakes', () => {
    expect(summarizeQuakes([], cfg)).toEqual({
      moodScore: 0.5,
      turbulence: 0,
      current: { x: 0.5, y: 0.5, velocity: 0 },
    });
  });

  it('shallow quakes read warm, deep quakes cool, and the current leans to the strongest', () => {
    const shallow = parseFeed(feed(quake('a', 5, 140, 35, 10, 1), quake('b', 1, 0, 0, 5, 2)));
    const deep = parseFeed(feed(quake('c', 5, 140, 35, 550, 1)));
    const s = summarizeQuakes(shallow, cfg);
    expect(s.moodScore).toBeGreaterThan(0.9);
    expect(summarizeQuakes(deep, cfg).moodScore).toBe(0);
    expect(s.current).toMatchObject(geoToCanvas(140, 35));
    expect(s.turbulence).toBeGreaterThan(
      summarizeQuakes(parseFeed(feed(quake('d', 1, 0, 0, 5, 1))), cfg).turbulence,
    );
  });
});

describe('usgsEarthquakes source', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness(docs: unknown[]) {
    const urls: string[] = [];
    let n = 0;
    const fetch: FetchLike = async (url) => {
      urls.push(url);
      const doc = docs[Math.min(n++, docs.length - 1)];
      if (doc instanceof Error) throw doc;
      return { ok: true, status: 200, json: async () => doc };
    };
    const bus = new DataSignalBus();
    const seen: VisualSignal[] = [];
    bus.stream$.subscribe((s) => seen.push(s));
    return { fetch, bus, seen, urls };
  }

  it('replays a few recent quakes on start, then pulses only new ones', async () => {
    const h = harness([
      feed(
        quake('a', 1, 0, 0, 10, 1),
        quake('b', 2, 10, 10, 10, 2),
        quake('c', 3, 20, 20, 10, 3),
        quake('d', 4, 30, 30, 10, 4),
      ),
      feed(quake('d', 4, 30, 30, 10, 4), quake('e', 6, -70, -30, 30, 5)),
    ]);
    const src = usgsEarthquakes({ fetch: h.fetch, seedPulses: 2, pollMs: 60000 });
    await src.start(h.bus);
    expect(src.status).toBe('running');
    expect(h.urls[0]).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
    );
    const pulses = () => h.seen.filter((s) => s.type === 'pulse');
    // The two most recent, oldest first.
    expect(pulses().map((p) => p.type === 'pulse' && p.location)).toEqual([
      geoToCanvas(20, 20),
      geoToCanvas(30, 30),
    ]);
    expect(h.seen.some((s) => s.type === 'ambiance')).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(pulses()).toHaveLength(3);
    expect(pulses()[2]).toMatchObject({ location: geoToCanvas(-70, -30) });
    await src.stop();
    expect(src.status).toBe('stopped');
  });

  it('goes to error when the first request fails, and keeps running through a transient failure', async () => {
    const bad = harness([new Error('offline')]);
    const src = usgsEarthquakes({ fetch: bad.fetch });
    await expect(src.start(bad.bus)).rejects.toThrow('offline');
    expect(src.status).toBe('error');

    const flaky = harness([
      feed(quake('a', 1, 0, 0, 10, 1)),
      new Error('blip'),
      feed(quake('b', 3, 5, 5, 10, 2)),
    ]);
    const s2 = usgsEarthquakes({ fetch: flaky.fetch, pollMs: 1000 });
    await s2.start(flaky.bus);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s2.status).toBe('running');
    expect(flaky.seen.filter((s) => s.type === 'pulse')).toHaveLength(2);
    await s2.stop();
  });

  it('stops promptly while the first request is still in flight', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    const src = usgsEarthquakes({ fetch });
    const starting = src.start(new DataSignalBus());
    await src.stop();
    await expect(starting).resolves.toBeUndefined();
    expect(src.status).toBe('stopped');
  });
});
