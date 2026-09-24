import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FetchLike, fetchJson, startPolling } from '../src/poll.js';

describe('fetchJson', () => {
  it('rejects non-2xx responses', async () => {
    const f: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await expect(fetchJson(f, 'u', new AbortController().signal, 1000)).rejects.toThrow('HTTP 503');
  });

  it('aborts the request when the source is stopped', async () => {
    let seen: AbortSignal | undefined;
    const f: FetchLike = (_url, init) => {
      seen = init?.signal;
      return new Promise((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    };
    const stop = new AbortController();
    const p = fetchJson(f, 'u', stop.signal, 60000);
    stop.abort();
    await expect(p).rejects.toThrow('aborted');
    expect(seen?.aborted).toBe(true);
  });
});

describe('startPolling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('tolerates transient failures and fails the source after too many in a row', async () => {
    const fail = vi.fn();
    let calls = 0;
    const results = [false, true, false, false, false];
    const stop = startPolling(
      { signal: new AbortController().signal, fail },
      1000,
      async () => {
        const ok = results[calls++];
        if (!ok) throw new Error(`poll ${calls}`);
      },
      3,
    );
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(5);
    expect(fail).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'poll 5' }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(5);
    stop();
  });

  it('stops scheduling after teardown', async () => {
    const tick = vi.fn(async () => undefined);
    const stop = startPolling(
      { signal: new AbortController().signal, fail: vi.fn() },
      1000,
      tick,
      3,
    );
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledOnce();
  });
});
