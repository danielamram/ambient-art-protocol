import { createSource, normalize, type SourceContext } from '@ambient/sdk';
import { waitForOpen } from './connect.js';
import { hashToPoint, RateWindow } from './stats.js';

/**
 * Wikipedia recent changes, streamed over Server-Sent Events from Wikimedia.
 * Free, no key, CORS-enabled, works in any browser and in Node with an EventSource polyfill.
 * Docs: https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams
 */

export const WIKIMEDIA_RECENTCHANGE_URL = 'https://stream.wikimedia.org/v2/stream/recentchange';

/** The subset of a recentchange event this source reads. */
export interface RecentChange {
  readonly type?: string;
  readonly title?: string;
  readonly wiki?: string;
  readonly server_name?: string;
  readonly bot?: boolean;
  readonly minor?: boolean;
  readonly length?: { readonly old?: number; readonly new?: number };
  readonly meta?: { readonly domain?: string };
}

export interface WikipediaEditsConfig {
  /** Only these wikis, e.g. ['en.wikipedia.org']. Default: all Wikimedia projects. */
  readonly domains?: readonly string[];
  /** Include edits flagged as bot. Default false. */
  readonly includeBots?: boolean;
  /** How often to emit ambiance/current from the rolling window. Default 2000 ms. */
  readonly tickMs?: number;
  /** Rolling window for the edit rate. Default 10000 ms. */
  readonly windowMs?: number;
  /** Edits per second that map to turbulence 1.0. Default 8 (all projects, humans only). */
  readonly maxEditsPerSecond?: number;
  /** Byte delta that maps to pulse magnitude 1.0. Default 2000. */
  readonly maxBytes?: number;
  /** Give up on the initial connection after this long. Default 15000 ms. */
  readonly connectTimeoutMs?: number;
  /** Override the SSE constructor (tests, Node polyfills). Default globalThis.EventSource. */
  readonly EventSource?: EventSourceLike;
  readonly url?: string;
}

/** Minimal EventSource surface so tests and Node polyfills can substitute one. */
export interface EventSourceInstance {
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onopen: ((ev: unknown) => void) | null;
  close(): void;
}
export type EventSourceLike = new (url: string) => EventSourceInstance;

/** Decide whether an event counts, and what pulse it produces. Pure, for tests. */
export function mapRecentChange(
  rc: RecentChange,
  cfg: { domains?: readonly string[]; includeBots?: boolean; maxBytes: number },
): { magnitude: number; location: { x: number; y: number }; delta: number; isNew: boolean } | null {
  if (rc.type !== 'edit' && rc.type !== 'new') return null;
  if (rc.bot && !cfg.includeBots) return null;
  const domain = rc.meta?.domain ?? rc.server_name;
  if (cfg.domains && cfg.domains.length > 0 && (!domain || !cfg.domains.includes(domain))) {
    return null;
  }
  const delta = (rc.length?.new ?? 0) - (rc.length?.old ?? 0);
  const size = Math.abs(delta);
  // Small edits still make a visible blip; large ones dominate.
  const magnitude = 0.15 + 0.85 * normalize(size, 0, cfg.maxBytes);
  return {
    magnitude,
    location: hashToPoint(`${domain ?? ''}/${rc.title ?? ''}`),
    delta,
    isNew: rc.type === 'new',
  };
}

function resolveEventSource(cfg: WikipediaEditsConfig): EventSourceLike {
  if (cfg.EventSource) return cfg.EventSource;
  const g = globalThis as { EventSource?: EventSourceLike };
  if (g.EventSource) return g.EventSource;
  throw new Error(
    'EventSource is not available. In Node, pass { EventSource } from a polyfill such as "eventsource".',
  );
}

export const wikipediaEdits = createSource<WikipediaEditsConfig | undefined>({
  id: 'wikipedia-edits',
  name: 'Wikipedia edits',
  description: 'Every edit on Wikimedia projects, live. Free, no key.',
  async start(ctx: SourceContext<WikipediaEditsConfig | undefined>) {
    const cfg = ctx.config ?? {};
    const tickMs = cfg.tickMs ?? 2000;
    const windowMs = cfg.windowMs ?? 10000;
    const maxRate = cfg.maxEditsPerSecond ?? 8;
    const maxBytes = cfg.maxBytes ?? 2000;
    const ES = resolveEventSource(cfg);

    const rate = new RateWindow(windowMs);
    let windowAdds = 0;
    let windowTotal = 0;
    let windowNew = 0;

    const es = new ES(cfg.url ?? WIKIMEDIA_RECENTCHANGE_URL);
    es.onmessage = (ev) => {
      let rc: RecentChange;
      try {
        rc = JSON.parse(ev.data) as RecentChange;
      } catch {
        return;
      }
      const mapped = mapRecentChange(rc, {
        maxBytes,
        ...(cfg.domains ? { domains: cfg.domains } : {}),
        ...(cfg.includeBots !== undefined ? { includeBots: cfg.includeBots } : {}),
      });
      if (!mapped) return;
      rate.push(ctx.now());
      if (mapped.isNew) windowNew += 1;
      if (mapped.delta >= 0) windowAdds += 1;
      windowTotal += 1;
      ctx.pulse({ magnitude: mapped.magnitude, location: mapped.location });
    };

    // Resolve only once the stream is actually open, so 'running' means connected.
    // After that, EventSource reconnects on its own, so later errors are not fatal.
    try {
      await waitForOpen(es, 'Wikimedia EventStreams', cfg.connectTimeoutMs ?? 15000);
    } catch (err) {
      es.close();
      throw err;
    }

    const timer = setInterval(() => {
      const perSecond = rate.perSecond(ctx.now());
      const turbulence = normalize(perSecond, 0, maxRate);
      // 0.5 is neutral; more additions than removals warms the palette.
      const moodScore = windowTotal === 0 ? 0.5 : windowAdds / windowTotal;
      ctx.ambiance({ moodScore, turbulence });
      ctx.current({
        x: windowTotal === 0 ? 0.5 : 1 - windowNew / windowTotal,
        y: moodScore,
        velocity: turbulence * 0.7,
      });
      windowAdds = 0;
      windowTotal = 0;
      windowNew = 0;
    }, tickMs);

    return () => {
      clearInterval(timer);
      es.close();
    };
  },
});
