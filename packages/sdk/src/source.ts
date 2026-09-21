import { BehaviorSubject, type Observable } from 'rxjs';
import type { DataSignalBus } from './bus.js';
import { SourceStateError } from './errors.js';
import {
  type AmbianceInput,
  type CurrentInput,
  type InputOf,
  PROTOCOL_VERSION,
  type PulseInput,
  type SignalType,
  type VisualSignal,
} from './protocol.js';
import { normalizePayload } from './validate.js';

export type SourceStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export type Teardown = () => void | Promise<void>;

/** Everything a plugin's `start()` receives. */
export interface SourceContext<Config = void> {
  readonly sourceId: string;
  readonly config: Config;
  /** Aborted when the source is stopped. Pass it to fetch, WebSocket wrappers, etc. */
  readonly signal: AbortSignal;
  now(): number;
  /** Emit a pulse. Numeric fields are clamped to [0, 1]; NaN throws in validate mode. */
  pulse(input: PulseInput): void;
  current(input: CurrentInput): void;
  ambiance(input: AmbianceInput): void;
}

export interface SourceDefinition<Config = void> {
  /** Stable identifier, e.g. 'github-webhook'. Doubles as the default instance id. */
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /**
   * Opt-in rate limit per signal type, in milliseconds. When set, emits of the same type
   * closer together than this are dropped (the first in each window wins).
   */
  readonly throttleMs?: number;
  start(ctx: SourceContext<Config>): Teardown | undefined | Promise<Teardown | undefined>;
}

export interface SourceInstanceOptions {
  /** Override the instance id when mounting the same definition twice. */
  readonly instanceId?: string;
  /** Override validation for this instance. Defaults to the bus's setting. */
  readonly validate?: boolean;
}

export interface Source {
  readonly id: string;
  readonly definitionId: string;
  readonly name: string;
  readonly status: SourceStatus;
  /** BehaviorSubject-backed: replays the current status on subscribe. */
  readonly status$: Observable<SourceStatus>;
  /** The last error, when status is 'error'. */
  readonly error: unknown;
  start(bus: DataSignalBus): Promise<void>;
  stop(): Promise<void>;
}

export interface SourceFactory<Config> {
  (
    ...args: Config extends void
      ? [config?: undefined, options?: SourceInstanceOptions]
      : [config: Config, options?: SourceInstanceOptions]
  ): Source;
  readonly definition: SourceDefinition<Config>;
}

class SourceImpl<Config> implements Source {
  readonly id: string;
  readonly definitionId: string;
  readonly name: string;
  error: unknown = undefined;

  readonly #definition: SourceDefinition<Config>;
  readonly #config: Config;
  readonly #validateOverride: boolean | undefined;
  readonly #status$ = new BehaviorSubject<SourceStatus>('idle');
  readonly #lastEmit = new Map<SignalType, number>();

  #abort: AbortController | undefined;
  #teardown: Teardown | undefined;
  #starting: Promise<void> | undefined;
  #stopping: Promise<void> | undefined;

  constructor(
    definition: SourceDefinition<Config>,
    config: Config,
    options: SourceInstanceOptions,
  ) {
    this.#definition = definition;
    this.#config = config;
    this.#validateOverride = options.validate;
    this.id = options.instanceId ?? definition.id;
    this.definitionId = definition.id;
    this.name = definition.name;
  }

  get status(): SourceStatus {
    return this.#status$.getValue();
  }

  get status$(): Observable<SourceStatus> {
    return this.#status$.asObservable();
  }

  start(bus: DataSignalBus): Promise<void> {
    if (this.#starting) return this.#starting;
    if (this.status === 'running') return Promise.resolve();
    if (this.status === 'stopping') {
      return Promise.reject(new SourceStateError(this.id, this.status, 'start'));
    }
    this.#starting = this.#doStart(bus).finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async #doStart(bus: DataSignalBus): Promise<void> {
    this.#abort = new AbortController();
    this.#lastEmit.clear();
    this.error = undefined;
    this.#status$.next('starting');
    try {
      const teardown = await this.#definition.start(this.#makeContext(bus, this.#abort.signal));
      if (this.#abort.signal.aborted) {
        // stop() was requested mid-start: honor it immediately.
        if (teardown) await teardown();
        this.#status$.next('stopped');
        return;
      }
      this.#teardown = teardown ?? undefined;
      this.#status$.next('running');
    } catch (err) {
      this.#fail(err);
      throw err;
    }
  }

  stop(): Promise<void> {
    if (this.#stopping) return this.#stopping;
    const status = this.status;
    if (status === 'idle' || status === 'stopped') return Promise.resolve();
    this.#stopping = this.#doStop().finally(() => {
      this.#stopping = undefined;
    });
    return this.#stopping;
  }

  async #doStop(): Promise<void> {
    const wasStarting = this.status === 'starting';
    this.#status$.next('stopping');
    this.#abort?.abort();
    if (wasStarting && this.#starting) {
      // Let the in-flight start observe the abort and settle.
      await this.#starting.catch(() => undefined);
      const settled: SourceStatus = this.#status$.getValue();
      if (settled === 'stopping') this.#status$.next('stopped');
      return;
    }
    const teardown = this.#teardown;
    this.#teardown = undefined;
    try {
      if (teardown) await teardown();
      this.#status$.next('stopped');
    } catch (err) {
      this.#fail(err);
      throw err;
    }
  }

  #fail(err: unknown): void {
    this.error = err;
    this.#abort?.abort();
    this.#teardown = undefined;
    this.#status$.next('error');
  }

  #makeContext(bus: DataSignalBus, signal: AbortSignal): SourceContext<Config> {
    const validate = this.#validateOverride ?? bus.validate;
    const sourceId = this.id;
    const emit = <T extends SignalType>(type: T, input: InputOf<T>): void => {
      if (signal.aborted || bus.disposed) return;
      const ts = bus.now();
      const throttleMs = this.#definition.throttleMs;
      if (throttleMs !== undefined && throttleMs > 0) {
        const last = this.#lastEmit.get(type);
        if (last !== undefined && ts - last < throttleMs) return;
        this.#lastEmit.set(type, ts);
      }
      const payload = normalizePayload(type, input, { validate, sourceId });
      const full: VisualSignal = { ...payload, v: PROTOCOL_VERSION, sourceId, ts };
      bus.emit(full);
    };
    return {
      sourceId,
      config: this.#config,
      signal,
      now: () => bus.now(),
      pulse: (input) => emit('pulse', input),
      current: (input) => emit('current', input),
      ambiance: (input) => emit('ambiance', input),
    };
  }
}

/**
 * Define a data source plugin. Returns a factory that creates independent instances.
 *
 * @example
 * export const weather = createSource<{ city: string }>({
 *   id: 'weather', name: 'Weather',
 *   async start(ctx) {
 *     const timer = setInterval(async () => {
 *       const w = await fetchWeather(ctx.config.city, ctx.signal);
 *       ctx.ambiance({ moodScore: normalize(w.tempC, -10, 35), turbulence: normalize(w.windKph, 0, 100) });
 *     }, 60_000);
 *     return () => clearInterval(timer);
 *   },
 * });
 */
export function createSource<Config = void>(
  definition: SourceDefinition<Config>,
): SourceFactory<Config> {
  const factory = ((config?: Config, options: SourceInstanceOptions = {}) =>
    new SourceImpl(definition, config as Config, options)) as unknown as SourceFactory<Config>;
  Object.defineProperty(factory, 'definition', { value: definition, enumerable: true });
  return factory;
}
