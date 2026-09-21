import { DataSignalBus, type VisualSignal } from '@ambient/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type EventSourceInstance,
  mapRecentChange,
  wikipediaEdits,
} from '../src/wikipedia-edits.js';

class FakeEventSource implements EventSourceInstance {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
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

const edit = (over: Record<string, unknown> = {}) => ({
  type: 'edit',
  title: 'Cat',
  bot: false,
  meta: { domain: 'en.wikipedia.org' },
  length: { old: 1000, new: 1400 },
  ...over,
});

describe('mapRecentChange', () => {
  const cfg = { maxBytes: 2000 };

  it('turns edits and new pages into pulses and ignores the rest', () => {
    expect(mapRecentChange(edit(), cfg)).toMatchObject({ delta: 400, isNew: false });
    expect(mapRecentChange(edit({ type: 'new' }), cfg)).toMatchObject({ isNew: true });
    expect(mapRecentChange(edit({ type: 'log' }), cfg)).toBeNull();
    expect(mapRecentChange(edit({ type: 'categorize' }), cfg)).toBeNull();
  });

  it('skips bots unless asked, and filters by domain', () => {
    expect(mapRecentChange(edit({ bot: true }), cfg)).toBeNull();
    expect(mapRecentChange(edit({ bot: true }), { ...cfg, includeBots: true })).not.toBeNull();
    expect(mapRecentChange(edit(), { ...cfg, domains: ['de.wikipedia.org'] })).toBeNull();
    expect(mapRecentChange(edit(), { ...cfg, domains: ['en.wikipedia.org'] })).not.toBeNull();
  });

  it('scales magnitude with byte delta but keeps a floor', () => {
    const tiny = mapRecentChange(edit({ length: { old: 100, new: 101 } }), cfg);
    const huge = mapRecentChange(edit({ length: { old: 0, new: 50000 } }), cfg);
    expect(tiny?.magnitude).toBeGreaterThan(0.1);
    expect(tiny?.magnitude).toBeLessThan(0.2);
    expect(huge?.magnitude).toBe(1);
  });

  it('places the same page at the same spot', () => {
    const a = mapRecentChange(edit(), cfg);
    const b = mapRecentChange(edit({ length: { old: 5, new: 6 } }), cfg);
    const c = mapRecentChange(edit({ title: 'Dog' }), cfg);
    expect(a?.location).toEqual(b?.location);
    expect(a?.location).not.toEqual(c?.location);
  });
});

describe('wikipediaEdits source', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  it('is "starting" until the stream opens, then pulses per edit and emits ambiance', async () => {
    let now = 0;
    const bus = new DataSignalBus({ now: () => now });
    const seen: VisualSignal[] = [];
    bus.stream$.subscribe((s) => seen.push(s));
    const src = wikipediaEdits({
      EventSource: FakeEventSource,
      tickMs: 1000,
      windowMs: 10000,
      maxEditsPerSecond: 1,
    });
    const starting = src.start(bus);
    const es = FakeEventSource.instances[0];
    expect(es?.url).toContain('stream.wikimedia.org');
    expect(src.status).toBe('starting');
    es?.open();
    await starting;
    expect(src.status).toBe('running');

    es?.emit(edit());
    es?.emit(edit({ title: 'Dog', length: { old: 500, new: 200 } }));
    es?.emit(edit({ bot: true }));
    es?.emit({ type: 'log' });
    expect(seen.filter((s) => s.type === 'pulse')).toHaveLength(2);

    now = 1000;
    vi.advanceTimersByTime(1000);
    const amb = seen.find((s) => s.type === 'ambiance');
    expect(amb).toMatchObject({ moodScore: 0.5, turbulence: 0.2 });
    const cur = seen.find((s) => s.type === 'current');
    expect(cur).toMatchObject({ x: 1, velocity: expect.closeTo(0.14, 6) });

    await src.stop();
    expect(es?.closed).toBe(true);
    const before = seen.length;
    es?.emit(edit());
    expect(seen.length).toBe(before);
  });

  it('goes to "error" when the stream cannot connect', async () => {
    const src = wikipediaEdits({ EventSource: FakeEventSource, connectTimeoutMs: 200 });
    const starting = src.start(new DataSignalBus());
    const es = FakeEventSource.instances[0];
    es?.onerror?.({});
    await expect(starting).rejects.toThrow(/connection failed/);
    expect(src.status).toBe('error');
    expect(es?.closed).toBe(true);
  });

  it('goes to "error" on connect timeout', async () => {
    const src = wikipediaEdits({ EventSource: FakeEventSource, connectTimeoutMs: 200 });
    const starting = src.start(new DataSignalBus());
    vi.advanceTimersByTime(200);
    await expect(starting).rejects.toThrow(/no connection after 200 ms/);
    expect(src.status).toBe('error');
  });

  it('fails clearly when no EventSource exists', async () => {
    const g = globalThis as { EventSource?: unknown };
    const saved = g.EventSource;
    g.EventSource = undefined;
    try {
      const src = wikipediaEdits(undefined);
      await expect(src.start(new DataSignalBus())).rejects.toThrow(/EventSource/);
    } finally {
      g.EventSource = saved;
    }
  });
});
