import type { SourceStatus } from '@ambient/sdk';

export type SourcePhase = 'autonomous' | 'connecting' | 'live' | 'unavailable';

export interface SourceView {
  /** The source the user asked for; '' is Autonomous. */
  readonly selected: string;
  readonly phase: SourcePhase;
}

export const AUTONOMOUS: SourceView = { selected: '', phase: 'autonomous' };

/** What the coordinator needs from the stage. Tests inject fakes; nothing touches the network. */
export interface SourceDriver {
  /** Resolves once the source is running; rejects if it could not start. */
  start(id: string): Promise<void>;
  /** Idempotent. Aborts an in-flight start as far as the SDK allows (see docs/app-experience.md). */
  stop(id: string): Promise<void>;
  /** Re-emit the user's *current* palette and a neutral current. Must read latest settings. */
  restoreAutonomous(): void;
}

/**
 * Latest-request-wins source selection. One serialized worker stops the previous source before
 * starting another and re-reads the desired selection after every await, so obsolete requests
 * never reach the UI and at most one app-owned source is running once it settles.
 *
 * It cannot cancel a connection attempt the SDK does not cancel; instead it stops such a source
 * immediately (aborting its signal so it can never emit) and waits for the start to settle.
 */
export class SourceCoordinator {
  readonly #driver: SourceDriver;
  readonly #onChange: (view: SourceView) => void;
  #desired = '';
  #generation = 0;
  /** The app-owned source that may be starting or running. */
  #active: string | null = null;
  #pending: { readonly id: string; readonly generation: number } | null = null;
  /** The last failed attempt, so the worker settles on 'unavailable' instead of retrying. */
  #failed: { readonly id: string; readonly generation: number } | null = null;
  #view: SourceView = AUTONOMOUS;
  #busy = false;
  #done: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(driver: SourceDriver, onChange: (view: SourceView) => void) {
    this.#driver = driver;
    this.#onChange = onChange;
  }

  get view(): SourceView {
    return this.#view;
  }

  /** The source the coordinator currently owns, for diagnostics and tests. */
  get active(): string | null {
    return this.#active;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Request a source ('' for Autonomous). Resolves once the latest request has settled. */
  select(id: string): Promise<void> {
    if (this.#closed) return this.#done;
    this.#desired = id;
    this.#generation += 1;
    // Abort whatever else is running or connecting right away: it must not emit after this.
    if (this.#active !== null && this.#active !== id) this.#stopQuietly(this.#active);
    const alreadyLive = id !== '' && this.#active === id && this.#pending === null;
    this.#publish({
      selected: id,
      phase: id === '' ? 'autonomous' : alreadyLive ? 'live' : 'connecting',
    });
    return this.#kick();
  }

  retry(): Promise<void> {
    return this.select(this.#desired);
  }

  /** Feed every source status transition here. Stale or foreign statuses are ignored. */
  status(id: string, status: SourceStatus): void {
    const current =
      id === this.#desired &&
      (this.#pending
        ? this.#pending.id === id && this.#pending.generation === this.#generation
        : this.#active === id);
    // A source that died after starting is no longer running: a retry must restart it.
    if (status === 'error' && this.#active === id && this.#pending?.id !== id) this.#active = null;
    if (!current || this.#closed) return;
    if (status === 'starting') this.#publish({ selected: id, phase: 'connecting' });
    else if (status === 'running') this.#publish({ selected: id, phase: 'live' });
    else if (status === 'error') this.#publish({ selected: id, phase: 'unavailable' });
  }

  /** Stop everything the coordinator owns. No UI updates and no new starts after this call. */
  dispose(): Promise<void> {
    if (this.#closed) return this.#done;
    this.#closed = true;
    this.#desired = '';
    this.#generation += 1;
    if (this.#active !== null) this.#stopQuietly(this.#active);
    return this.#kick();
  }

  #kick(): Promise<void> {
    if (!this.#busy) {
      this.#busy = true;
      this.#done = this.#work();
    }
    return this.#done;
  }

  async #work(): Promise<void> {
    try {
      for (;;) {
        const generation = this.#generation;
        const target = this.#closed ? '' : this.#desired;
        if (this.#active !== null && this.#active !== target) {
          const id = this.#active;
          await this.#driver.stop(id).catch(() => undefined);
          if (this.#active === id) this.#active = null;
          continue;
        }
        const failed = this.#failed?.id === target && this.#failed.generation === generation;
        if (target !== '' && this.#active !== target && !failed) {
          this.#active = target;
          this.#pending = { id: target, generation };
          try {
            await this.#driver.start(target);
          } catch {
            // A failed start leaves nothing running; a retry (a new generation) starts it again.
            if (this.#active === target) this.#active = null;
            this.#failed = { id: target, generation };
          } finally {
            this.#pending = null;
          }
          // Re-read the desired selection: an obsolete start is stopped on the next pass.
          continue;
        }
        // Settled for the latest request. No await between here and returning.
        this.#busy = false;
        if (this.#closed) return;
        if (target === '') {
          try {
            this.#driver.restoreAutonomous();
          } catch {
            // The stage is gone or refused the write; the source is still stopped.
          }
          this.#publish(AUTONOMOUS);
        } else {
          this.#publish({
            selected: target,
            phase: this.#active === target ? 'live' : 'unavailable',
          });
        }
        return;
      }
    } catch (err) {
      // Only reachable if the driver or listener throws unexpectedly; don't wedge the worker.
      this.#busy = false;
      throw err;
    }
  }

  #stopQuietly(id: string): void {
    void this.#driver.stop(id).catch(() => undefined);
  }

  #publish(view: SourceView): void {
    if (this.#closed) return;
    if (view.selected === this.#view.selected && view.phase === this.#view.phase) return;
    this.#view = view;
    this.#onChange(view);
  }
}
