import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Openable, waitForOpen } from '../src/connect.js';

function fake(): Openable & { onclose: ((ev: unknown) => void) | null } {
  return { onopen: null, onerror: null, onclose: null };
}

describe('waitForOpen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves on open and keeps forwarding later events', async () => {
    const s = fake();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const p = waitForOpen(s, 'thing', 1000, { onOpen, onClose });
    s.onopen?.({});
    await expect(p).resolves.toBeUndefined();
    s.onclose?.({ code: 1006 });
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith({ code: 1006 });
  });

  it('rejects on error before open', async () => {
    const s = fake();
    const p = waitForOpen(s, 'thing', 1000);
    s.onerror?.({});
    await expect(p).rejects.toThrow('thing: connection failed');
  });

  it('rejects on close before open', async () => {
    const s = fake();
    const p = waitForOpen(s, 'thing', 1000);
    s.onclose?.({});
    await expect(p).rejects.toThrow('closed before connecting');
  });

  it('rejects on timeout', async () => {
    const s = fake();
    const p = waitForOpen(s, 'thing', 500);
    vi.advanceTimersByTime(500);
    await expect(p).rejects.toThrow('no connection after 500 ms');
  });
});
