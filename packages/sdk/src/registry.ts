import { BehaviorSubject, combineLatest, map, type Observable, of, switchMap } from 'rxjs';
import { DataSignalBus, type DataSignalBusOptions } from './bus.js';
import type { Source, SourceStatus } from './source.js';

/** Mounts many sources on one bus and manages their lifecycles together. */
export class SourceRegistry {
  readonly bus: DataSignalBus;
  readonly #sources = new Map<string, Source>();
  readonly #members$ = new BehaviorSubject<readonly Source[]>([]);

  /** A map of instance id to status, re-emitted on every transition of any member. */
  readonly status$: Observable<Readonly<Record<string, SourceStatus>>>;

  constructor(bus: DataSignalBus) {
    this.bus = bus;
    this.status$ = this.#members$.pipe(
      switchMap((members) =>
        members.length === 0
          ? of({})
          : combineLatest(
              members.map((s) => s.status$.pipe(map((status) => [s.id, status] as const))),
            ).pipe(map((pairs) => Object.fromEntries(pairs))),
      ),
    );
  }

  add(...sources: Source[]): this {
    for (const source of sources) {
      if (this.#sources.has(source.id)) {
        throw new Error(`Source with id "${source.id}" is already registered`);
      }
      this.#sources.set(source.id, source);
    }
    this.#members$.next([...this.#sources.values()]);
    return this;
  }

  async remove(id: string): Promise<void> {
    const source = this.#sources.get(id);
    if (!source) return;
    await source.stop();
    this.#sources.delete(id);
    this.#members$.next([...this.#sources.values()]);
  }

  get(id: string): Source | undefined {
    return this.#sources.get(id);
  }

  list(): readonly Source[] {
    return [...this.#sources.values()];
  }

  /** Start every source. Failures are collected into one AggregateError; healthy sources keep running. */
  async startAll(): Promise<void> {
    const results = await Promise.allSettled(this.list().map((s) => s.start(this.bus)));
    const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} source(s) failed to start`);
    }
  }

  /** Stop every source in reverse registration order. */
  async stopAll(): Promise<void> {
    const reversed = [...this.list()].reverse();
    const results = await Promise.allSettled(reversed.map((s) => s.stop()));
    const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} source(s) failed to stop`);
    }
  }

  /** stopAll() then dispose the bus. */
  async dispose(): Promise<void> {
    try {
      await this.stopAll();
    } finally {
      this.bus.dispose();
    }
  }
}

/** One-liner for apps: create a bus and registry, add the sources, start them. */
export async function mount(
  sources: readonly Source[],
  options?: DataSignalBusOptions,
): Promise<SourceRegistry> {
  const registry = new SourceRegistry(new DataSignalBus(options));
  registry.add(...sources);
  await registry.startAll();
  return registry;
}
