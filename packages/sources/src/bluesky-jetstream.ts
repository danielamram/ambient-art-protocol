import { createSource, normalize, type SourceContext } from '@ambient/sdk';
import type { WebSocketLike } from './binance-trades.js';
import { waitForOpen } from './connect.js';
import { hashToPoint, RateWindow } from './stats.js';

/**
 * Public Bluesky activity from Jetstream, a JSON WebSocket view of the AT Protocol firehose.
 * Free, no key, no account.
 *
 * - Posts pulse, sized by length; reposts and follows make smaller pulses (likes are off by
 *   default: they multiply bandwidth).
 * - Each post's language picks its place on a ring, so languages gather in their own zones.
 * - The balance of warm and cold emoji over the last few seconds sets the mood; overall activity
 *   drives turbulence; the current drifts toward where recent pulses landed.
 * - With a watched word, only posts containing it pulse (strongly); everything else still
 *   counts toward turbulence and mood.
 *
 * Docs: https://github.com/bluesky-social/jetstream
 */

export const JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe';

export type BlueskyKind = 'post' | 'repost' | 'follow' | 'like';

const COLLECTION: Record<BlueskyKind, string> = {
  post: 'app.bsky.feed.post',
  repost: 'app.bsky.feed.repost',
  follow: 'app.bsky.graph.follow',
  like: 'app.bsky.feed.like',
};

/** The subset of a Jetstream event this source reads. */
export interface JetstreamEvent {
  readonly kind?: string;
  readonly commit?: {
    readonly operation?: string;
    readonly collection?: string;
    readonly record?: { readonly text?: unknown; readonly langs?: unknown };
  };
}

export interface BlueskyJetstreamConfig {
  /** Which activity to subscribe to. Default posts, reposts and follows. */
  readonly kinds?: readonly BlueskyKind[];
  /**
   * Returns the word to watch, or ''/undefined for none. Read on every post, so the word can
   * change while the source runs without reconnecting.
   */
  readonly watch?: () => string | undefined;
  /** Cap on pulses per second; busy periods are sampled. Default 4. */
  readonly maxPulsesPerSecond?: number;
  /** Events per second that map to turbulence 1.0. Default 120. */
  readonly maxEventsPerSecond?: number;
  /** How often to emit ambiance/current. Default 1500 ms. */
  readonly tickMs?: number;
  /** Rolling window for rates and emoji balance. Default 10000 ms. */
  readonly windowMs?: number;
  readonly connectTimeoutMs?: number;
  readonly WebSocket?: WebSocketLike;
  readonly url?: string;
}

export interface BlueskyActivity {
  readonly kind: BlueskyKind;
  readonly text: string;
  readonly lang: string;
}

/** Keep only newly created activity of a known kind. Pure, for tests. */
export function classifyEvent(ev: JetstreamEvent): BlueskyActivity | null {
  const c = ev.commit;
  if (ev.kind !== 'commit' || !c || c.operation !== 'create') return null;
  const kind = (Object.keys(COLLECTION) as BlueskyKind[]).find(
    (k) => COLLECTION[k] === c.collection,
  );
  if (!kind) return null;
  const text = typeof c.record?.text === 'string' ? c.record.text : '';
  const langs = Array.isArray(c.record?.langs) ? c.record.langs : [];
  const first = typeof langs[0] === 'string' ? langs[0] : '';
  // 'en-US' and 'en' share a zone.
  const lang = first.split('-')[0]?.toLowerCase() ?? '';
  return { kind, text, lang };
}

/** Each language has a fixed spot on a ring; posts scatter a little around it. Pure. */
export function languagePoint(lang: string, jitterKey: string): { x: number; y: number } {
  const zone = hashToPoint(`lang:${lang || 'unknown'}`);
  const angle = zone.x * Math.PI * 2;
  const radius = 0.22 + zone.y * 0.14;
  const j = hashToPoint(jitterKey);
  return {
    x: 0.5 + Math.cos(angle) * radius + (j.x - 0.5) * 0.08,
    y: 0.5 + Math.sin(angle) * radius + (j.y - 0.5) * 0.08,
  };
}

// Base code points, so variation selectors (❤️ = ❤ + U+FE0F) still match.
const WARM = [
  '❤',
  '♥',
  '🧡',
  '💛',
  '💚',
  '💙',
  '💜',
  '🥰',
  '😍',
  '😊',
  '😂',
  '🤣',
  '😄',
  '😁',
  '✨',
  '🎉',
  '🙌',
  '👏',
  '☀',
  '🌞',
];
const COLD = ['😢', '😭', '😡', '🤬', '💔', '😞', '😔', '😩', '😱', '😠', '😒', '😰'];
const countOf = (text: string, list: readonly string[]) =>
  list.reduce((n, e) => n + (text.split(e).length - 1), 0);

/** Warm and cold emoji in a text. Pure, for tests. */
export function emojiBalance(text: string): { warm: number; cold: number } {
  return { warm: countOf(text, WARM), cold: countOf(text, COLD) };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive, Unicode-aware match. An empty word matches nothing. Pure. */
export function containsWord(text: string, word: string): boolean {
  const w = word.trim();
  if (!w) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(w)}($|[^\\p{L}\\p{N}_])`, 'iu').test(text);
}

/** Pulse size per activity. Pure, for tests. */
export function activityPulse(a: BlueskyActivity, watchedMatch: boolean): number {
  if (watchedMatch) return 0.85;
  switch (a.kind) {
    case 'post':
      return 0.25 + 0.45 * normalize([...a.text].length, 0, 300);
    case 'repost':
      return 0.2;
    case 'follow':
      return 0.15;
    case 'like':
      return 0.1;
  }
}

function resolveWebSocket(cfg: BlueskyJetstreamConfig): WebSocketLike {
  if (cfg.WebSocket) return cfg.WebSocket;
  const g = globalThis as { WebSocket?: WebSocketLike };
  if (g.WebSocket) return g.WebSocket;
  throw new Error('WebSocket is not available. In Node 20, pass { WebSocket } from "ws".');
}

export function jetstreamUrl(base: string, kinds: readonly BlueskyKind[]): string {
  const query = kinds.map((k) => `wantedCollections=${encodeURIComponent(COLLECTION[k])}`);
  return `${base}?${query.join('&')}`;
}

export const blueskyJetstream = createSource<BlueskyJetstreamConfig | undefined>({
  id: 'bluesky-jetstream',
  name: 'Bluesky',
  description: 'Public Bluesky posts, reposts and follows, live. Free, no key.',
  async start(ctx: SourceContext<BlueskyJetstreamConfig | undefined>) {
    const cfg = ctx.config ?? {};
    const kinds = cfg.kinds ?? ['post', 'repost', 'follow'];
    const tickMs = cfg.tickMs ?? 1500;
    const windowMs = cfg.windowMs ?? 10000;
    const minGapMs = 1000 / (cfg.maxPulsesPerSecond ?? 4);
    const maxRate = cfg.maxEventsPerSecond ?? 120;
    const WS = resolveWebSocket(cfg);

    const events = new RateWindow(windowMs);
    // Emoji counts decay with the window rather than being stored per event.
    const decay = Math.exp(-tickMs / windowMs);
    let warm = 0;
    let cold = 0;
    let lastPulse = Number.NEGATIVE_INFINITY;
    let cx = 0.5;
    let cy = 0.5;

    const ws = new WS(cfg.url ?? jetstreamUrl(JETSTREAM_URL, kinds));
    ws.onmessage = (ev) => {
      let parsed: JetstreamEvent;
      try {
        parsed = JSON.parse(String(ev.data)) as JetstreamEvent;
      } catch {
        return;
      }
      const a = classifyEvent(parsed);
      if (!a) return;
      const now = ctx.now();
      events.push(now);
      if (a.text) {
        const e = emojiBalance(a.text);
        warm += e.warm;
        cold += e.cold;
      }
      const word = cfg.watch?.() ?? '';
      const watching = word.trim() !== '';
      const match = watching && a.kind === 'post' && containsWord(a.text, word);
      if (watching && !match) return;
      // Watched posts are rare and always shown; the general stream is sampled.
      if (!match && now - lastPulse < minGapMs) return;
      lastPulse = now;
      const location = languagePoint(a.lang, `${now}:${a.text.slice(0, 32)}`);
      cx += (location.x - cx) * 0.2;
      cy += (location.y - cy) * 0.2;
      ctx.pulse({ magnitude: activityPulse(a, match), location });
    };

    try {
      await waitForOpen(ws, 'Bluesky Jetstream', cfg.connectTimeoutMs ?? 15000, {
        signal: ctx.signal,
        onClose: () => {
          if (!ctx.signal.aborted) ctx.fail(new Error('Bluesky Jetstream: connection closed'));
        },
      });
    } catch (err) {
      ws.close();
      // Stopped while connecting: not a failure. The SDK sees the abort and ends 'stopped'.
      if (ctx.signal.aborted) return undefined;
      throw err;
    }

    const timer = setInterval(() => {
      const now = ctx.now();
      // A small prior keeps a single emoji from swinging the whole palette.
      const moodScore = (warm + 1) / (warm + cold + 2);
      const rate = events.perSecond(now);
      ctx.ambiance({ moodScore, turbulence: normalize(rate, 0, maxRate) });
      ctx.current({ x: cx, y: cy, velocity: normalize(rate, 0, maxRate) });
      warm *= decay;
      cold *= decay;
    }, tickMs);

    return () => {
      clearInterval(timer);
      ws.close();
    };
  },
});
