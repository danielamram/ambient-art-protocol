import type { SourceStatus } from '@ambient/sdk';
import { describe, expect, it } from 'vitest';
import {
  SourceCoordinator,
  type SourceDriver,
  type SourceView,
} from '../src/state/source-coordinator.js';

interface Deferred {
  resolve(): void;
  reject(err: Error): void;
  promise: Promise<void>;
}
const deferred = (): Deferred => {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
};
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Models the SDK Source lifecycle: stop() during a start aborts it, but still waits for the
 * in-flight connection attempt to settle, and an aborted start ends 'stopped', never 'running'.
 */
function harness() {
  const statuses = new Map<string, SourceStatus>();
  const pending = new Map<string, Deferred>();
  const aborted = new Set<string>();
  const log: string[] = [];
  const views: SourceView[] = [];
  let restoredWith: string | undefined;
  let palette = 'glacier';
  const set = (id: string, s: SourceStatus) => {
    statuses.set(id, s);
    coordinator.status(id, s);
  };
  const driver: SourceDriver = {
    start(id) {
      log.push(`start:${id}`);
      aborted.delete(id);
      const d = deferred();
      pending.set(id, d);
      set(id, 'starting');
      return d.promise.then(
        () => {
          pending.delete(id);
          set(id, aborted.has(id) ? 'stopped' : 'running');
        },
        (err: Error) => {
          pending.delete(id);
          set(id, 'error');
          throw err;
        },
      );
    },
    async stop(id) {
      log.push(`stop:${id}`);
      const s = statuses.get(id);
      if (!s || s === 'idle' || s === 'stopped') return;
      aborted.add(id);
      const d = pending.get(id);
      if (d) {
        await d.promise.catch(() => undefined);
        await flush();
        return;
      }
      set(id, 'stopping');
      set(id, 'stopped');
    },
    restoreAutonomous() {
      log.push('restore');
      restoredWith = palette;
    },
  };
  const coordinator = new SourceCoordinator(driver, (v) => views.push(v));
  const running = () => [...statuses].filter(([, s]) => s === 'running').map(([id]) => id);
  return {
    coordinator,
    log,
    views,
    running,
    pending,
    statuses,
    setPalette: (p: string) => {
      palette = p;
    },
    restoredWith: () => restoredWith,
    emit: (id: string, s: SourceStatus) => set(id, s),
    phases: () => views.map((v) => `${v.selected || 'autonomous'}:${v.phase}`),
  };
}

describe('SourceCoordinator', () => {
  it('rapid A -> B -> Autonomous never starts B and settles with nothing running', async () => {
    const h = harness();
    const done = h.coordinator.select('a');
    h.coordinator.select('b');
    h.coordinator.select('');
    // A was aborted as soon as it was superseded, even though its connection is still pending.
    expect(h.log).toEqual(['start:a', 'stop:a', 'stop:a']);
    h.pending.get('a')?.resolve();
    await done;
    await flush();
    expect(h.log).not.toContain('start:b');
    expect(h.running()).toEqual([]);
    expect(h.coordinator.view).toEqual({ selected: '', phase: 'autonomous' });
    expect(h.coordinator.active).toBeNull();
  });

  it('A failing while B is requested never shows A as unavailable', async () => {
    const h = harness();
    h.coordinator.select('a');
    const done = h.coordinator.select('b');
    h.pending.get('a')?.reject(new Error('socket refused'));
    await flush();
    h.pending.get('b')?.resolve();
    await done;
    expect(h.running()).toEqual(['b']);
    expect(h.phases()).toEqual(['a:connecting', 'b:connecting', 'b:live']);
  });

  it('an obsolete start that succeeds is stopped before the newest source starts', async () => {
    const h = harness();
    h.coordinator.select('a');
    const done = h.coordinator.select('b');
    h.pending.get('a')?.resolve();
    await flush();
    expect(h.log.indexOf('start:b')).toBeGreaterThan(h.log.lastIndexOf('stop:a'));
    h.pending.get('b')?.resolve();
    await done;
    expect(h.running()).toEqual(['b']);
  });

  it('ignores an old source reporting an error after a new selection', async () => {
    const h = harness();
    const first = h.coordinator.select('a');
    h.pending.get('a')?.resolve();
    await first;
    const second = h.coordinator.select('b');
    h.emit('a', 'error');
    await flush();
    h.pending.get('b')?.resolve();
    await second;
    expect(h.phases()).not.toContain('b:unavailable');
    expect(h.phases()).not.toContain('a:unavailable');
    expect(h.coordinator.view).toEqual({ selected: 'b', phase: 'live' });
  });

  it('a failed start is recoverable with retry and is never labelled live', async () => {
    const h = harness();
    const first = h.coordinator.select('a');
    h.pending.get('a')?.reject(new Error('offline'));
    await first;
    expect(h.coordinator.view).toEqual({ selected: 'a', phase: 'unavailable' });
    expect(h.phases()).not.toContain('a:live');
    const retry = h.coordinator.retry();
    expect(h.coordinator.view.phase).toBe('connecting');
    h.pending.get('a')?.resolve();
    await retry;
    expect(h.coordinator.view).toEqual({ selected: 'a', phase: 'live' });
    expect(h.log.filter((l) => l === 'start:a')).toHaveLength(2);
  });

  it('a source that dies after starting shows unavailable and restarts on retry', async () => {
    const h = harness();
    const first = h.coordinator.select('a');
    h.pending.get('a')?.resolve();
    await first;
    h.emit('a', 'error');
    expect(h.coordinator.view.phase).toBe('unavailable');
    const retry = h.coordinator.retry();
    h.pending.get('a')?.resolve();
    await retry;
    expect(h.coordinator.view.phase).toBe('live');
  });

  it('returning to Autonomous restores the latest settings, not those at request time', async () => {
    const h = harness();
    const first = h.coordinator.select('a');
    h.pending.get('a')?.resolve();
    await first;
    const back = h.coordinator.select('');
    // A saved look is loaded while the stop is still in flight.
    h.setPalette('iris');
    await back;
    expect(h.restoredWith()).toBe('iris');
    expect(h.running()).toEqual([]);
  });

  it('loading a look during a pending start aborts it before it can go live', async () => {
    const h = harness();
    h.coordinator.select('a');
    const back = h.coordinator.select('');
    expect(h.coordinator.view.phase).toBe('autonomous');
    h.pending.get('a')?.resolve();
    await back;
    expect(h.statuses.get('a')).toBe('stopped');
    expect(h.phases()).not.toContain('a:live');
  });

  it('disposal during startup stops the source, never starts another and stays silent', async () => {
    const h = harness();
    h.coordinator.select('a');
    const disposed = h.coordinator.dispose();
    const before = h.views.length;
    h.coordinator.select('b');
    h.pending.get('a')?.resolve();
    await disposed;
    await flush();
    expect(h.log).not.toContain('start:b');
    expect(h.log).not.toContain('restore');
    expect(h.running()).toEqual([]);
    expect(h.views.length).toBe(before);
  });

  it('re-selecting the live source does not restart it', async () => {
    const h = harness();
    const first = h.coordinator.select('a');
    h.pending.get('a')?.resolve();
    await first;
    await h.coordinator.select('a');
    expect(h.log.filter((l) => l === 'start:a')).toHaveLength(1);
    expect(h.coordinator.view.phase).toBe('live');
  });

  it('settles with at most one running source after a burst of requests', async () => {
    const h = harness();
    const ids = ['a', 'b', 'c', 'a', 'b', 'c', 'b'];
    let last: Promise<void> = Promise.resolve();
    for (const id of ids) last = h.coordinator.select(id);
    for (let i = 0; i < 20; i++) {
      for (const d of h.pending.values()) d.resolve();
      await flush();
    }
    await last;
    expect(h.running()).toEqual(['b']);
    expect(h.coordinator.view).toEqual({ selected: 'b', phase: 'live' });
  });
});
