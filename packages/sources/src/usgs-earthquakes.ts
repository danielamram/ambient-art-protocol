import { createSource, normalize, type SourceContext } from '@ambient/sdk';
import { type FetchLike, fetchJson, resolveFetch, startPolling } from './poll.js';

/**
 * Earthquakes worldwide from the USGS GeoJSON summary feeds. Free, no key, updated every minute.
 * Each new quake pulses at its real longitude/latitude (equirectangular, north up), sized by
 * magnitude. Recent depth sets the mood (shallow warm, deep cool); recent strength drives
 * turbulence, and the current leans toward the strongest recent quake.
 * Docs: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 */

export const USGS_FEED_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary';

/** The subset of a GeoJSON feature this source reads. */
export interface QuakeFeature {
  readonly id?: string;
  readonly properties?: { readonly mag?: number | null; readonly time?: number };
  readonly geometry?: { readonly coordinates?: readonly number[] };
}

export interface UsgsEarthquakesConfig {
  /** Summary feed name. Default 'all_hour'; e.g. '2.5_day' for fewer, stronger quakes. */
  readonly feed?: string;
  /** Poll interval. The feeds update about once a minute. Default 60000 ms. */
  readonly pollMs?: number;
  /** Magnitude that maps to pulse magnitude 1.0. Default 7. */
  readonly maxMagnitude?: number;
  /** Depth that reads as fully cool. Default 300 km. */
  readonly maxDepthKm?: number;
  /** On start, replay this many of the most recent quakes as pulses. Default 3. */
  readonly seedPulses?: number;
  /** Consecutive failed polls before the source reports failure. Default 5. */
  readonly maxFailures?: number;
  readonly requestTimeoutMs?: number;
  readonly fetch?: FetchLike;
  readonly url?: string;
}

export interface Quake {
  readonly id: string;
  readonly time: number;
  readonly mag: number;
  readonly depthKm: number;
  readonly location: { readonly x: number; readonly y: number };
}

/** Longitude/latitude to canvas coordinates (top-left origin), kept off the very edges. */
export function geoToCanvas(lon: number, lat: number): { x: number; y: number } {
  const x = normalize(lon, -180, 180);
  const y = normalize(90 - lat, 0, 180);
  return { x: 0.08 + x * 0.84, y: 0.08 + y * 0.84 };
}

/** Validate one feature. Pure, for tests. */
export function parseQuake(f: QuakeFeature): Quake | null {
  const mag = f.properties?.mag;
  const time = f.properties?.time;
  const [lon, lat, depth] = f.geometry?.coordinates ?? [];
  if (typeof f.id !== 'string' || typeof mag !== 'number' || !Number.isFinite(mag)) return null;
  if (typeof time !== 'number' || typeof lon !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return {
    id: f.id,
    time,
    mag,
    depthKm: typeof depth === 'number' && Number.isFinite(depth) ? Math.max(0, depth) : 0,
    location: geoToCanvas(lon, lat),
  };
}

export function parseFeed(doc: unknown): Quake[] {
  const features = (doc as { features?: unknown })?.features;
  if (!Array.isArray(features)) throw new Error('USGS feed: no features array');
  return features.flatMap((f) => parseQuake(f as QuakeFeature) ?? []);
}

export const quakePulse = (q: Quake, maxMagnitude: number): number =>
  0.12 + 0.88 * normalize(q.mag, 0, maxMagnitude);

/** Ambiance and current from the quakes in the feed. Pure, for tests. */
export function summarizeQuakes(
  quakes: readonly Quake[],
  cfg: { maxMagnitude: number; maxDepthKm: number },
): { moodScore: number; turbulence: number; current: { x: number; y: number; velocity: number } } {
  if (quakes.length === 0) {
    return { moodScore: 0.5, turbulence: 0, current: { x: 0.5, y: 0.5, velocity: 0 } };
  }
  let strongest = quakes[0] as Quake;
  let weight = 0;
  let depth = 0;
  for (const q of quakes) {
    if (q.mag > strongest.mag) strongest = q;
    // Stronger quakes count more toward the mood.
    const w = 1 + Math.max(0, q.mag);
    weight += w;
    depth += q.depthKm * w;
  }
  const moodScore = 1 - normalize(depth / weight, 0, cfg.maxDepthKm);
  const turbulence =
    0.6 * normalize(strongest.mag, 1, cfg.maxMagnitude - 1) + 0.4 * normalize(quakes.length, 0, 40);
  return {
    moodScore,
    turbulence,
    current: {
      x: strongest.location.x,
      y: strongest.location.y,
      velocity: normalize(strongest.mag, 2, cfg.maxMagnitude),
    },
  };
}

export const usgsEarthquakes = createSource<UsgsEarthquakesConfig | undefined>({
  id: 'usgs-earthquakes',
  name: 'USGS earthquakes',
  description: 'Earthquakes worldwide, placed where they happen. Free, no key.',
  async start(ctx: SourceContext<UsgsEarthquakesConfig | undefined>) {
    const cfg = ctx.config ?? {};
    const url = cfg.url ?? `${USGS_FEED_BASE}/${cfg.feed ?? 'all_hour'}.geojson`;
    const maxMagnitude = cfg.maxMagnitude ?? 7;
    const maxDepthKm = cfg.maxDepthKm ?? 300;
    const fetchImpl = resolveFetch(cfg.fetch);
    const timeoutMs = cfg.requestTimeoutMs ?? 15000;
    /** Quake id -> quake time, pruned to the last two hours past the newest seen. */
    const seen = new Map<string, number>();

    const load = async () => parseFeed(await fetchJson(fetchImpl, url, ctx.signal, timeoutMs));
    const publish = (quakes: readonly Quake[]) => {
      const s = summarizeQuakes(quakes, { maxMagnitude, maxDepthKm });
      ctx.ambiance({ moodScore: s.moodScore, turbulence: s.turbulence });
      ctx.current(s.current);
    };
    const remember = (quakes: readonly Quake[]) => {
      let newest = 0;
      for (const q of quakes) {
        seen.set(q.id, q.time);
        newest = Math.max(newest, q.time);
      }
      for (const [id, t] of seen) if (t < newest - 2 * 3600_000) seen.delete(id);
    };

    // 'running' means the first document arrived. Stopped while loading is not a failure.
    let first: Quake[];
    try {
      first = await load();
    } catch (err) {
      if (ctx.signal.aborted) return undefined;
      throw err;
    }
    if (ctx.signal.aborted) return undefined;
    const recent = [...first].sort((a, b) => b.time - a.time).slice(0, cfg.seedPulses ?? 3);
    for (const q of recent.reverse()) {
      ctx.pulse({ magnitude: quakePulse(q, maxMagnitude), location: q.location });
    }
    remember(first);
    publish(first);

    return startPolling(
      ctx,
      cfg.pollMs ?? 60000,
      async () => {
        const quakes = await load();
        const fresh = quakes.filter((q) => !seen.has(q.id)).sort((a, b) => a.time - b.time);
        for (const q of fresh) {
          ctx.pulse({ magnitude: quakePulse(q, maxMagnitude), location: q.location });
        }
        remember(quakes);
        publish(quakes);
      },
      cfg.maxFailures ?? 5,
    );
  },
});
