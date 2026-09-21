import { createSource, normalize, type SourceContext } from '@ambient/sdk';
import { waitForOpen } from './connect.js';
import { RollingSeries } from './stats.js';

/**
 * Binance public trade stream for one symbol, over WebSocket. Free, no key.
 * Uses the market-data-only host, which serves public streams without an account.
 * Docs: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
 */

export const BINANCE_MARKET_DATA_WS = 'wss://data-stream.binance.vision/ws';

export interface BinanceTrade {
  readonly e?: string;
  /** Price as a decimal string. */
  readonly p?: string;
  /** Quantity as a decimal string. */
  readonly q?: string;
  /** True when the buyer is the market maker, i.e. the taker sold. */
  readonly m?: boolean;
  readonly T?: number;
}

export interface BinanceTradesConfig {
  /** Lowercase symbol, e.g. 'btcusdt'. Default 'btcusdt'. */
  readonly symbol?: string;
  /** Emit ambiance/current this often. Default 1500 ms. */
  readonly tickMs?: number;
  /** How many recent trade prices feed the volatility estimate. Default 200. */
  readonly window?: number;
  /** Quote-currency notional of one trade that maps to pulse magnitude 1.0. Default 100000. */
  readonly maxNotional?: number;
  /** Minimum pulse magnitude to bother emitting. Default 0.08. */
  readonly pulseFloor?: number;
  /** Std-dev of log returns (per trade) that maps to turbulence 1.0. Default 0.0004. */
  readonly maxVolatility?: number;
  /** Absolute window return that maps mood to 0 or 1. Default 0.002 (0.2%). */
  readonly maxReturn?: number;
  /** Give up on the initial connection after this long. Default 15000 ms. */
  readonly connectTimeoutMs?: number;
  /** Override the WebSocket constructor (tests, Node polyfills). Default globalThis.WebSocket. */
  readonly WebSocket?: WebSocketLike;
  readonly url?: string;
}

export interface WebSocketInstance {
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  close(): void;
}
export type WebSocketLike = new (url: string) => WebSocketInstance;

/** Pulse for a single trade, or null when it is too small to show. Pure, for tests. */
export function mapTrade(
  t: BinanceTrade,
  cfg: { maxNotional: number; pulseFloor: number },
): { magnitude: number; location: { x: number; y: number }; price: number } | null {
  const price = Number(t.p);
  const qty = Number(t.q);
  if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return null;
  const magnitude = normalize(price * qty, 0, cfg.maxNotional);
  if (magnitude < cfg.pulseFloor) return null;
  // Taker buys land on the right half, taker sells on the left; bigger trades sit higher.
  const buy = t.m === false;
  const x = buy ? 0.62 + magnitude * 0.3 : 0.38 - magnitude * 0.3;
  const y = 0.75 - magnitude * 0.5;
  return { magnitude, location: { x, y }, price };
}

/** Ambiance and current from a window of prices. Pure, for tests. */
export function summarizeWindow(
  prices: RollingSeries,
  returns: RollingSeries,
  cfg: { maxVolatility: number; maxReturn: number },
): { moodScore: number; turbulence: number; current: { x: number; y: number; velocity: number } } {
  const first = prices.first();
  const last = prices.last();
  const ret = first && last ? Math.log(last / first) : 0;
  const turbulence = normalize(returns.stddev(), 0, cfg.maxVolatility);
  const moodScore = normalize(ret, -cfg.maxReturn, cfg.maxReturn);
  const velocity = normalize(Math.abs(ret), 0, cfg.maxReturn);
  return {
    moodScore,
    turbulence,
    current: { x: ret >= 0 ? 1 : 0, y: 0.5 - (moodScore - 0.5) * 0.6, velocity },
  };
}

function resolveWebSocket(cfg: BinanceTradesConfig): WebSocketLike {
  if (cfg.WebSocket) return cfg.WebSocket;
  const g = globalThis as { WebSocket?: WebSocketLike };
  if (g.WebSocket) return g.WebSocket;
  throw new Error(
    'WebSocket is not available. In Node 20, pass { WebSocket } from the "ws" package.',
  );
}

export const binanceTrades = createSource<BinanceTradesConfig | undefined>({
  id: 'binance-trades',
  name: 'Binance trades',
  description: 'Live trades for one symbol. Big trades pulse, volatility drives turbulence.',
  async start(ctx: SourceContext<BinanceTradesConfig | undefined>) {
    const cfg = ctx.config ?? {};
    const symbol = (cfg.symbol ?? 'btcusdt').toLowerCase();
    const tickMs = cfg.tickMs ?? 1500;
    const maxNotional = cfg.maxNotional ?? 100000;
    const pulseFloor = cfg.pulseFloor ?? 0.08;
    const maxVolatility = cfg.maxVolatility ?? 0.0004;
    const maxReturn = cfg.maxReturn ?? 0.002;
    const WS = resolveWebSocket(cfg);

    const prices = new RollingSeries(cfg.window ?? 200);
    const returns = new RollingSeries(cfg.window ?? 200);
    let lastPrice: number | undefined;

    const ws = new WS(cfg.url ?? `${BINANCE_MARKET_DATA_WS}/${symbol}@trade`);
    ws.onmessage = (ev) => {
      let t: BinanceTrade;
      try {
        t = JSON.parse(String(ev.data)) as BinanceTrade;
      } catch {
        return;
      }
      const price = Number(t.p);
      if (Number.isFinite(price) && price > 0) {
        prices.push(price);
        if (lastPrice !== undefined) returns.push(Math.log(price / lastPrice));
        lastPrice = price;
      }
      const mapped = mapTrade(t, { maxNotional, pulseFloor });
      if (mapped) ctx.pulse({ magnitude: mapped.magnitude, location: mapped.location });
    };

    // 'running' means connected. A close after that is fatal for a WebSocket (no auto-reconnect),
    // so report it through ctx.fail and let the user toggle the source to reconnect.
    try {
      await waitForOpen(ws, `Binance ${symbol}@trade`, cfg.connectTimeoutMs ?? 15000, {
        onClose: () => {
          if (!ctx.signal.aborted)
            ctx.fail(new Error(`Binance ${symbol}@trade: connection closed`));
        },
      });
    } catch (err) {
      ws.close();
      throw err;
    }

    const timer = setInterval(() => {
      if (prices.size < 2) return;
      const s = summarizeWindow(prices, returns, { maxVolatility, maxReturn });
      ctx.ambiance({ moodScore: s.moodScore, turbulence: s.turbulence });
      ctx.current(s.current);
    }, tickMs);

    return () => {
      clearInterval(timer);
      ws.close();
    };
  },
});
