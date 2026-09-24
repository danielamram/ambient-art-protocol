import { clamp01, createSource, normalize, type SourceContext } from '@ambient/sdk';
import { type FetchLike, fetchJson, resolveFetch, startPolling } from './poll.js';

/**
 * Space weather from NOAA's Space Weather Prediction Center. Free, no key, US public domain.
 * The planetary K index (geomagnetic activity, 0–9) drives turbulence, so aurora-like scenes grow
 * restless when the real aurora does. Solar wind speed drives the current's velocity, the
 * interplanetary magnetic field (By, Bz) steers it, and a southward Bz (which feeds aurorae)
 * shifts the mood. A sharp rise in Kp sends a pulse.
 * Docs: https://www.swpc.noaa.gov/content/data-access
 */

export const SWPC_BASE = 'https://services.swpc.noaa.gov';
export const SWPC_KP_URL = `${SWPC_BASE}/json/planetary_k_index_1m.json`;
export const SWPC_PLASMA_URL = `${SWPC_BASE}/products/solar-wind/plasma-5-minute.json`;
export const SWPC_MAG_URL = `${SWPC_BASE}/products/solar-wind/mag-5-minute.json`;

export interface SpaceWeatherConfig {
  /** Poll interval. Default 60000 ms. */
  readonly pollMs?: number;
  /** Kp increase between polls that sends a pulse. Default 0.3. */
  readonly pulseOnKpRise?: number;
  /** Consecutive failed polls before the source reports failure. Default 5. */
  readonly maxFailures?: number;
  readonly requestTimeoutMs?: number;
  readonly fetch?: FetchLike;
  readonly urls?: { readonly kp?: string; readonly plasma?: string; readonly mag?: string };
}

export interface SpaceWeatherReading {
  /** Estimated planetary K index, 0–9. */
  readonly kp: number;
  /** Solar wind speed in km/s, when available. */
  readonly speed?: number;
  /** IMF components in nT (GSM), when available. */
  readonly by?: number;
  readonly bz?: number;
}

const finite = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** Latest Kp from `[{ time_tag, kp_index, estimated_kp }, …]`. Pure, for tests. */
export function parseKp(doc: unknown): number {
  if (!Array.isArray(doc)) throw new Error('SWPC Kp: not an array');
  for (let i = doc.length - 1; i >= 0; i -= 1) {
    const row = doc[i] as { estimated_kp?: unknown; kp_index?: unknown } | null;
    const kp = finite(row?.estimated_kp) ?? finite(row?.kp_index);
    if (kp !== undefined) return Math.max(0, Math.min(9, kp));
  }
  throw new Error('SWPC Kp: no readings');
}

/**
 * Latest value of `column` from SWPC's table products: `[["time_tag", "speed", …], [...], …]`
 * with values as strings. undefined when missing. Pure, for tests.
 */
export function parseTableColumn(doc: unknown, column: string): number | undefined {
  if (!Array.isArray(doc) || !Array.isArray(doc[0])) return undefined;
  const index = (doc[0] as unknown[]).indexOf(column);
  if (index < 0) return undefined;
  for (let i = doc.length - 1; i >= 1; i -= 1) {
    const row = doc[i];
    if (!Array.isArray(row)) continue;
    const v = finite(row[index]);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Signals for one reading. Pure, for tests. */
export function mapSpaceWeather(r: SpaceWeatherReading): {
  moodScore: number;
  turbulence: number;
  current: { x: number; y: number; velocity: number };
} {
  return {
    turbulence: normalize(r.kp, 0, 9),
    // Southward (negative) Bz couples the solar wind into the magnetosphere: aurora weather.
    moodScore: r.bz === undefined ? 0.5 : normalize(-r.bz, -10, 10),
    current: {
      x: r.by === undefined ? 0.5 : clamp01(0.5 + r.by / 40),
      y: r.bz === undefined ? 0.5 : clamp01(0.5 - r.bz / 40),
      velocity: r.speed === undefined ? 0 : normalize(r.speed, 250, 800),
    },
  };
}

export const spaceWeather = createSource<SpaceWeatherConfig | undefined>({
  id: 'space-weather',
  name: 'Space weather',
  description: 'Geomagnetic activity and solar wind from NOAA SWPC. Free, no key.',
  async start(ctx: SourceContext<SpaceWeatherConfig | undefined>) {
    const cfg = ctx.config ?? {};
    const fetchImpl = resolveFetch(cfg.fetch);
    const timeoutMs = cfg.requestTimeoutMs ?? 15000;
    const rise = cfg.pulseOnKpRise ?? 0.3;
    const get = (url: string) => fetchJson(fetchImpl, url, ctx.signal, timeoutMs);
    let lastKp: number | undefined;

    const read = async (): Promise<SpaceWeatherReading> => {
      const [kp, plasma, mag] = await Promise.allSettled([
        get(cfg.urls?.kp ?? SWPC_KP_URL),
        get(cfg.urls?.plasma ?? SWPC_PLASMA_URL),
        get(cfg.urls?.mag ?? SWPC_MAG_URL),
      ]);
      // Kp is required; the solar wind products are optional and read as neutral when missing.
      if (kp.status === 'rejected') throw kp.reason;
      const speed =
        plasma.status === 'fulfilled' ? parseTableColumn(plasma.value, 'speed') : undefined;
      const by = mag.status === 'fulfilled' ? parseTableColumn(mag.value, 'by_gsm') : undefined;
      const bz = mag.status === 'fulfilled' ? parseTableColumn(mag.value, 'bz_gsm') : undefined;
      return {
        kp: parseKp(kp.value),
        ...(speed === undefined ? {} : { speed }),
        ...(by === undefined ? {} : { by }),
        ...(bz === undefined ? {} : { bz }),
      };
    };
    const publish = (r: SpaceWeatherReading) => {
      const s = mapSpaceWeather(r);
      if (lastKp !== undefined && r.kp - lastKp >= rise) {
        ctx.pulse({ magnitude: 0.3 + 0.7 * normalize(r.kp, 0, 9) });
      }
      lastKp = r.kp;
      ctx.ambiance({ moodScore: s.moodScore, turbulence: s.turbulence });
      ctx.current(s.current);
    };

    // 'running' means a first reading arrived. Stopped while loading is not a failure.
    let first: SpaceWeatherReading;
    try {
      first = await read();
    } catch (err) {
      if (ctx.signal.aborted) return undefined;
      throw err;
    }
    if (ctx.signal.aborted) return undefined;
    publish(first);
    return startPolling(
      ctx,
      cfg.pollMs ?? 60000,
      async () => publish(await read()),
      cfg.maxFailures ?? 5,
    );
  },
});
