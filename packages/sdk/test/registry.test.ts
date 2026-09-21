import { describe, expect, it, vi } from 'vitest';
import { DataSignalBus } from '../src/bus.js';
import { mount, SourceRegistry } from '../src/registry.js';
import { createSource, type SourceStatus } from '../src/source.js';

function simple(id: string, log: string[]) {
  return createSource({
    id,
    name: id,
    start() {
      log.push(`start:${id}`);
      return () => {
        log.push(`stop:${id}`);
      };
    },
  })();
}

describe('SourceRegistry', () => {
  it('rejects duplicate ids', () => {
    const reg = new SourceRegistry(new DataSignalBus());
    const log: string[] = [];
    reg.add(simple('a', log));
    expect(() => reg.add(simple('a', log))).toThrow(/already registered/);
  });

  it('starts all and stops in reverse order', async () => {
    const log: string[] = [];
    const reg = new SourceRegistry(new DataSignalBus());
    reg.add(simple('a', log), simple('b', log), simple('c', log));
    await reg.startAll();
    expect(reg.list().map((s) => s.status)).toEqual(['running', 'running', 'running']);
    await reg.stopAll();
    expect(log).toEqual(['start:a', 'start:b', 'start:c', 'stop:c', 'stop:b', 'stop:a']);
  });

  it('aggregates start failures but keeps healthy sources running', async () => {
    const log: string[] = [];
    const reg = new SourceRegistry(new DataSignalBus());
    const bad = createSource({
      id: 'bad',
      name: 'bad',
      start() {
        throw new Error('nope');
      },
    })();
    reg.add(simple('good', log), bad);
    await expect(reg.startAll()).rejects.toBeInstanceOf(AggregateError);
    expect(reg.get('good')?.status).toBe('running');
    expect(reg.get('bad')?.status).toBe('error');
  });

  it('remove() stops a running source first', async () => {
    const log: string[] = [];
    const reg = new SourceRegistry(new DataSignalBus());
    reg.add(simple('a', log));
    await reg.startAll();
    await reg.remove('a');
    expect(log).toEqual(['start:a', 'stop:a']);
    expect(reg.get('a')).toBeUndefined();
    await expect(reg.remove('missing')).resolves.toBeUndefined();
  });

  it('status$ emits a map on every member transition', async () => {
    const log: string[] = [];
    const reg = new SourceRegistry(new DataSignalBus());
    const snapshots: Record<string, SourceStatus>[] = [];
    reg.status$.subscribe((m) => snapshots.push({ ...m }));
    reg.add(simple('a', log));
    await reg.startAll();
    expect(snapshots).toEqual([{}, { a: 'idle' }, { a: 'starting' }, { a: 'running' }]);
  });

  it('dispose() stops sources and disposes the bus', async () => {
    const log: string[] = [];
    const bus = new DataSignalBus();
    const spy = vi.spyOn(bus, 'dispose');
    const reg = new SourceRegistry(bus);
    reg.add(simple('a', log));
    await reg.startAll();
    await reg.dispose();
    expect(log).toEqual(['start:a', 'stop:a']);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('mount() creates, adds, and starts in one call', async () => {
    const log: string[] = [];
    const reg = await mount([simple('a', log), simple('b', log)], { now: () => 1 });
    expect(reg.list().map((s) => s.status)).toEqual(['running', 'running']);
    expect(reg.bus.now()).toBe(1);
    await reg.dispose();
  });
});
