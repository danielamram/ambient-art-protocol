import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSignalBus } from '../src/bus.js';
import { SignalValidationError, SourceStateError } from '../src/errors.js';
import type { VisualSignal } from '../src/protocol.js';
import { createSource, type SourceStatus } from '../src/source.js';

function record(bus: DataSignalBus): VisualSignal[] {
  const seen: VisualSignal[] = [];
  bus.stream$.subscribe((s) => seen.push(s));
  return seen;
}

describe('createSource', () => {
  it('returns a factory that exposes its definition and builds independent instances', () => {
    const def = { id: 'thing', name: 'Thing', start: () => undefined };
    const factory = createSource(def);
    expect(factory.definition).toBe(def);
    const a = factory();
    const b = factory(undefined, { instanceId: 'thing-2' });
    expect(a.id).toBe('thing');
    expect(b.id).toBe('thing-2');
    expect(b.definitionId).toBe('thing');
    expect(a).not.toBe(b);
  });

  it('walks idle -> starting -> running and stamps emitted signals', async () => {
    const bus = new DataSignalBus({ now: () => 777 });
    const seen = record(bus);
    const statuses: SourceStatus[] = [];
    const src = createSource({
      id: 'emitter',
      name: 'Emitter',
      start(ctx) {
        ctx.pulse({ magnitude: 4, location: { x: 0.5, y: -1 } });
        return undefined;
      },
    })();
    src.status$.subscribe((s) => statuses.push(s));
    await src.start(bus);
    expect(statuses).toEqual(['idle', 'starting', 'running']);
    expect(seen).toEqual([
      {
        v: 1,
        sourceId: 'emitter',
        ts: 777,
        type: 'pulse',
        magnitude: 1,
        location: { x: 0.5, y: 0 },
      },
    ]);
  });

  it('passes config through the context', async () => {
    const bus = new DataSignalBus();
    const seen = record(bus);
    const scaled = createSource<{ scale: number }>({
      id: 'scaled',
      name: 'Scaled',
      start(ctx) {
        ctx.ambiance({ moodScore: 0.25 * ctx.config.scale, turbulence: 0 });
        return undefined;
      },
    });
    await scaled({ scale: 2 }).start(bus);
    expect(seen[0]).toMatchObject({ moodScore: 0.5 });
  });

  it('shares one in-flight promise across concurrent start() calls', async () => {
    const bus = new DataSignalBus();
    const start = vi.fn(async () => undefined);
    const src = createSource({ id: 'once', name: 'Once', start })();
    await Promise.all([src.start(bus), src.start(bus)]);
    expect(start).toHaveBeenCalledOnce();
    await src.start(bus);
    expect(start).toHaveBeenCalledOnce();
  });

  it('stop() aborts the signal, awaits teardown, and drops later emits', async () => {
    const bus = new DataSignalBus();
    const seen = record(bus);
    const teardown = vi.fn(async () => undefined);
    let leakedCtx: Parameters<Parameters<typeof createSource>[0]['start']>[0] | undefined;
    const src = createSource({
      id: 'stoppable',
      name: 'Stoppable',
      start(ctx) {
        leakedCtx = ctx;
        return teardown;
      },
    })();
    await src.start(bus);
    expect(leakedCtx?.signal.aborted).toBe(false);
    await src.stop();
    expect(leakedCtx?.signal.aborted).toBe(true);
    expect(teardown).toHaveBeenCalledOnce();
    expect(src.status).toBe('stopped');
    leakedCtx?.pulse({ magnitude: 1 });
    expect(seen).toEqual([]);
    await expect(src.stop()).resolves.toBeUndefined();
  });

  it('marks error when start throws, and allows a retry', async () => {
    const bus = new DataSignalBus();
    let attempts = 0;
    const src = createSource({
      id: 'flaky',
      name: 'Flaky',
      start() {
        attempts += 1;
        if (attempts === 1) throw new Error('boom');
        return undefined;
      },
    })();
    await expect(src.start(bus)).rejects.toThrow('boom');
    expect(src.status).toBe('error');
    expect(src.error).toBeInstanceOf(Error);
    await src.start(bus);
    expect(src.status).toBe('running');
    expect(src.error).toBeUndefined();
  });

  it('marks error when teardown throws', async () => {
    const bus = new DataSignalBus();
    const src = createSource({
      id: 'bad-teardown',
      name: 'Bad teardown',
      start: () => () => {
        throw new Error('teardown failed');
      },
    })();
    await src.start(bus);
    await expect(src.stop()).rejects.toThrow('teardown failed');
    expect(src.status).toBe('error');
  });

  it('rejects start() while stopping', async () => {
    const bus = new DataSignalBus();
    let release: () => void = () => undefined;
    const src = createSource({
      id: 'slow-stop',
      name: 'Slow stop',
      start: () => () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    })();
    await src.start(bus);
    const stopping = src.stop();
    expect(src.status).toBe('stopping');
    await expect(src.start(bus)).rejects.toThrow(SourceStateError);
    release();
    await stopping;
    expect(src.status).toBe('stopped');
  });

  it('honors stop() requested during an async start', async () => {
    const bus = new DataSignalBus();
    const teardown = vi.fn();
    let resolveStart: (t: () => void) => void = () => undefined;
    const src = createSource({
      id: 'slow-start',
      name: 'Slow start',
      start: () =>
        new Promise<() => void>((resolve) => {
          resolveStart = resolve;
        }),
    })();
    const starting = src.start(bus);
    const stopping = src.stop();
    resolveStart(teardown);
    await Promise.all([starting, stopping]);
    expect(teardown).toHaveBeenCalledOnce();
    expect(src.status).toBe('stopped');
  });

  it('surfaces NaN from a plugin in validate mode', async () => {
    const bus = new DataSignalBus({ validate: true });
    const src = createSource({
      id: 'nan',
      name: 'NaN',
      start(ctx) {
        ctx.ambiance({ moodScore: Number.NaN, turbulence: 0 });
        return undefined;
      },
    })();
    await expect(src.start(bus)).rejects.toThrow(SignalValidationError);
    expect(src.status).toBe('error');
  });

  it('clamps NaN silently when validation is off for the instance', async () => {
    const bus = new DataSignalBus({ validate: true });
    const seen = record(bus);
    const src = createSource({
      id: 'nan-ok',
      name: 'NaN ok',
      start(ctx) {
        ctx.ambiance({ moodScore: Number.NaN, turbulence: 0 });
        return undefined;
      },
    })(undefined, { validate: false });
    await src.start(bus);
    expect(seen[0]).toMatchObject({ moodScore: 0 });
  });
});

describe('createSource throttleMs', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drops same-type emits inside the throttle window, per type', async () => {
    const bus = new DataSignalBus();
    const seen = record(bus);
    const src = createSource({
      id: 'throttled',
      name: 'Throttled',
      throttleMs: 100,
      start(ctx) {
        ctx.ambiance({ moodScore: 0.1, turbulence: 0 });
        ctx.ambiance({ moodScore: 0.2, turbulence: 0 });
        ctx.pulse({ magnitude: 0.3 });
        vi.advanceTimersByTime(100);
        ctx.ambiance({ moodScore: 0.4, turbulence: 0 });
        return undefined;
      },
    })();
    await src.start(bus);
    expect(seen.map((s) => (s.type === 'ambiance' ? s.moodScore : s.type))).toEqual([
      0.1,
      'pulse',
      0.4,
    ]);
  });
});
