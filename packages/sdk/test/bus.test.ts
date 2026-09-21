import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { DataSignalBus } from '../src/bus.js';
import { BusDisposedError, SignalValidationError } from '../src/errors.js';
import { PROTOCOL_VERSION, type SignalOf, type VisualSignal } from '../src/protocol.js';
import type { SignalTransport } from '../src/transport.js';

const pulse: VisualSignal = {
  v: PROTOCOL_VERSION,
  sourceId: 'a',
  ts: 1,
  type: 'pulse',
  magnitude: 0.5,
};
const ambiance: VisualSignal = {
  v: PROTOCOL_VERSION,
  sourceId: 'a',
  ts: 2,
  type: 'ambiance',
  moodScore: 0.1,
  turbulence: 0.9,
};

describe('DataSignalBus', () => {
  it('is hot: late subscribers miss earlier signals', () => {
    const bus = new DataSignalBus();
    bus.emit(pulse);
    const seen: VisualSignal[] = [];
    bus.stream$.subscribe((s) => seen.push(s));
    bus.emit(ambiance);
    expect(seen).toEqual([ambiance]);
  });

  it('on(type) filters and narrows', () => {
    const bus = new DataSignalBus();
    const seen: SignalOf<'pulse'>[] = [];
    const pulses$ = bus.on('pulse');
    pulses$.subscribe((s) => {
      expectTypeOf(s.magnitude).toBeNumber();
      seen.push(s);
    });
    bus.emit(ambiance);
    bus.emit(pulse);
    expect(seen).toEqual([pulse]);
    expect(bus.on('pulse')).toBe(pulses$);
  });

  it('emitPayload stamps meta using the injected clock', () => {
    const bus = new DataSignalBus({ now: () => 12345 });
    const seen: VisualSignal[] = [];
    bus.stream$.subscribe((s) => seen.push(s));
    bus.emitPayload({ type: 'current', x: 0.2, y: 0.3, velocity: 0.4 }, 'src-1');
    expect(seen[0]).toEqual({
      v: 1,
      sourceId: 'src-1',
      ts: 12345,
      type: 'current',
      x: 0.2,
      y: 0.3,
      velocity: 0.4,
    });
  });

  it('validates when enabled and skips when disabled', () => {
    const strict = new DataSignalBus({ validate: true });
    expect(() => strict.emit({ ...pulse, magnitude: Number.NaN })).toThrow(SignalValidationError);
    const lenient = new DataSignalBus({ validate: false });
    expect(() => lenient.emit({ ...pulse, magnitude: Number.NaN })).not.toThrow();
  });

  it('forwards to a custom transport', () => {
    const publish = vi.fn();
    const transport: SignalTransport = {
      publish,
      subscribe: () => () => undefined,
      close: vi.fn(),
    };
    const bus = new DataSignalBus({ transport });
    bus.emit(pulse);
    expect(publish).toHaveBeenCalledWith(pulse);
    bus.dispose();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('dispose completes streams and rejects further emits', () => {
    const bus = new DataSignalBus();
    const completed = vi.fn();
    const completedTyped = vi.fn();
    bus.stream$.subscribe({ complete: completed });
    bus.on('ambiance').subscribe({ complete: completedTyped });
    bus.dispose();
    expect(completed).toHaveBeenCalledOnce();
    expect(completedTyped).toHaveBeenCalledOnce();
    expect(bus.disposed).toBe(true);
    expect(() => bus.emit(pulse)).toThrow(BusDisposedError);
    expect(() => bus.dispose()).not.toThrow();
  });
});

describe('DataSignalBus time operators', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('throttled keeps leading and trailing values per window', () => {
    const bus = new DataSignalBus();
    const seen: number[] = [];
    bus.throttled('pulse', 100).subscribe((s) => seen.push(s.ts));
    for (let i = 0; i < 5; i += 1) bus.emit({ ...pulse, ts: i });
    expect(seen).toEqual([0]);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([0, 4]);
  });

  it('buffered drops empty windows', () => {
    const bus = new DataSignalBus();
    const seen: number[][] = [];
    bus.buffered('ambiance', 50).subscribe((batch) => seen.push(batch.map((s) => s.ts)));
    vi.advanceTimersByTime(50);
    expect(seen).toEqual([]);
    bus.emit({ ...ambiance, ts: 1 });
    bus.emit({ ...ambiance, ts: 2 });
    vi.advanceTimersByTime(50);
    expect(seen).toEqual([[1, 2]]);
  });

  it('latest replays the most recent value to late subscribers', () => {
    const bus = new DataSignalBus();
    const latest$ = bus.latest('ambiance');
    const keepAlive = latest$.subscribe();
    bus.emit(ambiance);
    const seen: VisualSignal[] = [];
    latest$.subscribe((s) => seen.push(s));
    expect(seen).toEqual([ambiance]);
    keepAlive.unsubscribe();
  });
});
