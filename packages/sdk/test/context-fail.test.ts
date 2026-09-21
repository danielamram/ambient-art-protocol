import { describe, expect, it, vi } from 'vitest';
import { DataSignalBus } from '../src/bus.js';
import { createSource, type SourceContext } from '../src/source.js';

describe('ctx.fail', () => {
  it('moves a running source to error, runs teardown, and aborts the signal', async () => {
    const bus = new DataSignalBus();
    const teardown = vi.fn();
    let ctx: SourceContext | undefined;
    const src = createSource({
      id: 'dropper',
      name: 'Dropper',
      start(c) {
        ctx = c;
        return teardown;
      },
    })();
    await src.start(bus);
    const boom = new Error('socket closed');
    ctx?.fail(boom);
    expect(src.status).toBe('error');
    expect(src.error).toBe(boom);
    expect(teardown).toHaveBeenCalledOnce();
    expect(ctx?.signal.aborted).toBe(true);
    // A second fail, or a fail after stop, does nothing.
    ctx?.fail(new Error('again'));
    expect(src.error).toBe(boom);
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('is a no-op before running and after stop', async () => {
    const bus = new DataSignalBus();
    let ctx: SourceContext | undefined;
    const src = createSource({
      id: 'quiet',
      name: 'Quiet',
      start(c) {
        ctx = c;
        c.fail(new Error('too early'));
        return undefined;
      },
    })();
    await src.start(bus);
    expect(src.status).toBe('running');
    await src.stop();
    ctx?.fail(new Error('too late'));
    expect(src.status).toBe('stopped');
  });

  it('allows a retry after fail', async () => {
    const bus = new DataSignalBus();
    let ctx: SourceContext | undefined;
    const src = createSource({
      id: 'retry',
      name: 'Retry',
      start(c) {
        ctx = c;
        return undefined;
      },
    })();
    await src.start(bus);
    ctx?.fail(new Error('drop'));
    expect(src.status).toBe('error');
    await src.start(bus);
    expect(src.status).toBe('running');
  });
});
