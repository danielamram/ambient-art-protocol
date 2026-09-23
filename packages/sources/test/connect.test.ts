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

  it('rejects at once with an AbortError when the signal aborts mid-connect', async () => {
    const s = fake();
    const abort = new AbortController();
    const p = waitForOpen(s, 'thing', 15000, { signal: abort.signal });
    abort.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    // The timeout was cleared, and a late open changes nothing.
    expect(vi.getTimerCount()).toBe(0);
    s.onopen?.({});
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const p = waitForOpen(fake(), 'thing', 15000, { signal: abort.signal });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores an abort after the socket opened', async () => {
    const s = fake();
    const abort = new AbortController();
    const onClose = vi.fn();
    const p = waitForOpen(s, 'thing', 1000, { signal: abort.signal, onClose });
    s.onopen?.({});
    await expect(p).resolves.toBeUndefined();
    abort.abort();
    s.onclose?.({});
    expect(onClose).toHaveBeenCalledOnce();
  });
});
