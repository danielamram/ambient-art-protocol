import { DataSignalBus, type VisualSignal } from '@ambient/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  binanceTrades,
  mapTrade,
  summarizeWindow,
  type WebSocketInstance,
} from '../src/binance-trades.js';
import { RollingSeries } from '../src/stats.js';

class FakeWebSocket implements WebSocketInstance {
  static instances: FakeWebSocket[] = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  open(): void {
    this.onopen?.({});
  }
  emit(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  close(): void {
    this.closed = true;
  }
}

describe('mapTrade', () => {
  const cfg = { maxNotional: 100000, pulseFloor: 0.08 };

  it('ignores tiny or malformed trades', () => {
    expect(mapTrade({ p: '50000', q: '0.0001' }, cfg)).toBeNull();
    expect(mapTrade({ p: 'abc', q: '1' }, cfg)).toBeNull();
    expect(mapTrade({}, cfg)).toBeNull();
  });

  it('scales with notional and places buys right, sells left', () => {
    const buy = mapTrade({ p: '50000', q: '1', m: false }, cfg);
    const sell = mapTrade({ p: '50000', q: '1', m: true }, cfg);
    expect(buy?.magnitude).toBe(0.5);
    expect(buy?.location.x).toBeGreaterThan(0.5);
    expect(sell?.location.x).toBeLessThan(0.5);
    expect(mapTrade({ p: '50000', q: '10', m: false }, cfg)?.magnitude).toBe(1);
  });
});

describe('summarizeWindow', () => {
  const cfg = { maxVolatility: 0.0004, maxReturn: 0.002 };

  it('is neutral on a flat market', () => {
    const p = new RollingSeries(10);
    const r = new RollingSeries(10);
    for (let i = 0; i < 5; i += 1) {
      p.push(100);
      r.push(0);
    }
    const s = summarizeWindow(p, r, cfg);
    expect(s.moodScore).toBe(0.5);
    expect(s.turbulence).toBe(0);
    expect(s.current.velocity).toBe(0);
  });

  it('warms and points right on a rally, cools and points left on a drop', () => {
    const up = new RollingSeries(10);
    const upR = new RollingSeries(10);
    up.push(100);
    up.push(100.1);
    upR.push(Math.log(100.1 / 100));
    const s1 = summarizeWindow(up, upR, cfg);
    expect(s1.moodScore).toBeGreaterThan(0.5);
    expect(s1.current.x).toBe(1);

    const down = new RollingSeries(10);
    down.push(100);
    down.push(99.7);
    const s2 = summarizeWindow(down, upR, cfg);
    expect(s2.moodScore).toBe(0);
    expect(s2.current.x).toBe(0);
    expect(s2.current.velocity).toBe(1);
  });

  it('maps volatility to turbulence', () => {
    const p = new RollingSeries(10);
    const r = new RollingSeries(10);
    p.push(100);
    p.push(100);
    for (const v of [0.001, -0.001, 0.001, -0.001]) r.push(v);
    expect(summarizeWindow(p, r, cfg).turbulence).toBe(1);
  });
});

describe('binanceTrades source', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  it('connects, pulses big trades, emits ambiance, and closes on stop', async () => {
    const bus = new DataSignalBus();
    const seen: VisualSignal[] = [];
    bus.stream$.subscribe((s) => seen.push(s));
    const src = binanceTrades({ WebSocket: FakeWebSocket, symbol: 'ETHUSDT', tickMs: 500 });
    const starting = src.start(bus);
    const ws = FakeWebSocket.instances[0];
    expect(ws?.url).toBe('wss://data-stream.binance.vision/ws/ethusdt@trade');
    expect(src.status).toBe('starting');
    ws?.open();
    await starting;
    expect(src.status).toBe('running');

    ws?.emit({ e: 'trade', p: '3000', q: '0.001', m: true }); // tiny: no pulse
    ws?.emit({ e: 'trade', p: '3010', q: '10', m: false }); // 30k notional: pulse
    ws?.emit('not json');
    expect(seen.filter((s) => s.type === 'pulse')).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'pulse', magnitude: 0.301 });

    vi.advanceTimersByTime(500);
    const amb = seen.find((s) => s.type === 'ambiance');
    expect(amb).toBeDefined();
    expect(amb).toMatchObject({ moodScore: 1 }); // +0.33% in the window saturates mood
    expect(seen.find((s) => s.type === 'current')).toMatchObject({ x: 1 });

    await src.stop();
    expect(ws?.closed).toBe(true);
  });

  it('stays quiet until it has two prices', async () => {
    const bus = new DataSignalBus();
    const seen: VisualSignal[] = [];
    bus.stream$.subscribe((s) => seen.push(s));
    const src = binanceTrades({ WebSocket: FakeWebSocket, tickMs: 100 });
    const starting = src.start(bus);
    FakeWebSocket.instances[0]?.open();
    await starting;
    vi.advanceTimersByTime(300);
    expect(seen).toHaveLength(0);
    await src.stop();
  });

  it('goes to "error" when the socket cannot connect', async () => {
    const src = binanceTrades({ WebSocket: FakeWebSocket });
    const starting = src.start(new DataSignalBus());
    FakeWebSocket.instances[0]?.onerror?.({});
    await expect(starting).rejects.toThrow(/connection failed/);
    expect(src.status).toBe('error');
    expect(FakeWebSocket.instances[0]?.closed).toBe(true);
  });

  it('goes to "error" when a live socket closes', async () => {
    const src = binanceTrades({ WebSocket: FakeWebSocket });
    const starting = src.start(new DataSignalBus());
    const ws = FakeWebSocket.instances[0];
    ws?.open();
    await starting;
    expect(src.status).toBe('running');
    ws?.onclose?.({ code: 1006 });
    expect(src.status).toBe('error');
    expect(src.error).toBeInstanceOf(Error);
    expect(ws?.closed).toBe(true);
  });

  it('stops promptly while still connecting: socket closed, "stopped", never live', async () => {
    const bus = new DataSignalBus();
    const seen: VisualSignal[] = [];
    bus.stream$.subscribe((sig) => seen.push(sig));
    const src = binanceTrades({ WebSocket: FakeWebSocket, connectTimeoutMs: 15000 });
    const starting = src.start(bus);
    const ws = FakeWebSocket.instances[0];
    expect(src.status).toBe('starting');
    // No open, error or timeout: stop must not wait for any of them.
    await src.stop();
    await expect(starting).resolves.toBeUndefined();
    expect(src.status).toBe('stopped');
    expect(ws?.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    ws?.open();
    vi.advanceTimersByTime(20000);
    expect(src.status).toBe('stopped');
    expect(seen).toHaveLength(0);
  });

  it('can start again after being stopped while connecting', async () => {
    const src = binanceTrades({ WebSocket: FakeWebSocket });
    const bus = new DataSignalBus();
    const first = src.start(bus);
    await src.stop();
    await first;
    const second = src.start(bus);
    FakeWebSocket.instances[1]?.open();
    await second;
    expect(src.status).toBe('running');
    await src.stop();
  });
});
