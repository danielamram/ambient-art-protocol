import {
  bufferTime,
  filter,
  type MonoTypeOperatorFunction,
  type OperatorFunction,
  shareReplay,
  throttleTime,
} from 'rxjs';
import type { SignalOf, SignalType, VisualSignal } from './protocol.js';

/** Narrow a VisualSignal stream to one signal type. */
export function ofType<T extends SignalType>(type: T): OperatorFunction<VisualSignal, SignalOf<T>> {
  return filter((s: VisualSignal): s is SignalOf<T> => s.type === type);
}

/** Emit at most once per `ms`, keeping both the first and the last value of each window. */
export function throttleSignals<S>(ms: number): MonoTypeOperatorFunction<S> {
  return throttleTime(ms, undefined, { leading: true, trailing: true });
}

/** Collect signals into arrays every `ms`; empty windows are dropped. */
export function bufferSignals<S>(ms: number): OperatorFunction<S, S[]> {
  return (source) =>
    source.pipe(
      bufferTime(ms),
      filter((buf) => buf.length > 0),
    );
}

/** Replay the most recent value to late subscribers. Use for "current state" consumers. */
export function latestSignal<S>(): MonoTypeOperatorFunction<S> {
  return shareReplay({ bufferSize: 1, refCount: true });
}
