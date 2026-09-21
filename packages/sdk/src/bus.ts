import { Observable, Subject, share, takeUntil } from 'rxjs';
import { isDev } from './env.js';
import { BusDisposedError } from './errors.js';
import { bufferSignals, latestSignal, ofType, throttleSignals } from './operators.js';
import {
  PROTOCOL_VERSION,
  type SignalOf,
  type SignalPayload,
  type SignalType,
  type VisualSignal,
} from './protocol.js';
import { InMemoryTransport, type SignalTransport } from './transport.js';
import { validateSignal } from './validate.js';

export interface DataSignalBusOptions {
  /** Defaults to an in-process InMemoryTransport. */
  readonly transport?: SignalTransport;
  /** Validate every emitted signal structurally. Defaults to `isDev()`. */
  readonly validate?: boolean;
  /** Clock used by `emitPayload`. Injectable for deterministic tests. */
  readonly now?: () => number;
}

/**
 * The reactive hub every source writes to and every consumer reads from.
 *
 * The bus is hot and unbuffered: late subscribers do not see earlier signals.
 * Use `latest(type)` when you want "current state" semantics.
 */
export class DataSignalBus {
  readonly transport: SignalTransport;
  readonly validate: boolean;
  readonly now: () => number;

  readonly stream$: Observable<VisualSignal>;
  readonly #disposed$ = new Subject<void>();
  readonly #byType = new Map<SignalType, Observable<SignalOf<SignalType>>>();
  #disposed = false;

  constructor(options: DataSignalBusOptions = {}) {
    this.transport = options.transport ?? new InMemoryTransport();
    this.validate = options.validate ?? isDev();
    this.now = options.now ?? Date.now;

    this.stream$ = new Observable<VisualSignal>((subscriber) => {
      const unsubscribe = this.transport.subscribe((s) => subscriber.next(s));
      return unsubscribe;
    }).pipe(takeUntil(this.#disposed$), share());
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Emit a fully-formed signal (meta included). */
  emit(signal: VisualSignal): void {
    if (this.#disposed) throw new BusDisposedError();
    if (this.validate) validateSignal(signal);
    this.transport.publish(signal);
  }

  /** Emit a bare payload; the bus stamps protocol version, sourceId, and timestamp. */
  emitPayload(payload: SignalPayload, sourceId = 'anonymous'): void {
    this.emit({ ...payload, v: PROTOCOL_VERSION, sourceId, ts: this.now() });
  }

  /** All signals of one type. Memoized per type. */
  on<T extends SignalType>(type: T): Observable<SignalOf<T>> {
    let obs = this.#byType.get(type);
    if (!obs) {
      obs = this.stream$.pipe(ofType(type));
      this.#byType.set(type, obs);
    }
    return obs as Observable<SignalOf<T>>;
  }

  throttled<T extends SignalType>(type: T, ms: number): Observable<SignalOf<T>> {
    return this.on(type).pipe(throttleSignals(ms));
  }

  buffered<T extends SignalType>(type: T, ms: number): Observable<SignalOf<T>[]> {
    return this.on(type).pipe(bufferSignals(ms));
  }

  latest<T extends SignalType>(type: T): Observable<SignalOf<T>> {
    return this.on(type).pipe(latestSignal());
  }

  /** Complete every stream, close the transport, and reject further emits. Idempotent. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#disposed$.next();
    this.#disposed$.complete();
    this.transport.close();
  }
}
