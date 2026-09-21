import { Subject } from 'rxjs';
import type { VisualSignal } from './protocol.js';

/**
 * How signals move between producers and consumers.
 *
 * Phase 1 ships only InMemoryTransport. A WebSocket relay transport (Node sources feeding a
 * browser renderer) implements this same interface later, so DataSignalBus, sources, and the
 * engine never change when the topology does.
 */
export interface SignalTransport {
  publish(signal: VisualSignal): void;
  /** Returns an unsubscribe function. */
  subscribe(handler: (signal: VisualSignal) => void): () => void;
  close(): void;
}

export class InMemoryTransport implements SignalTransport {
  readonly #subject = new Subject<VisualSignal>();
  #closed = false;

  get closed(): boolean {
    return this.#closed;
  }

  publish(signal: VisualSignal): void {
    if (this.#closed) return;
    this.#subject.next(signal);
  }

  subscribe(handler: (signal: VisualSignal) => void): () => void {
    const sub = this.#subject.subscribe(handler);
    return () => sub.unsubscribe();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#subject.complete();
  }
}
