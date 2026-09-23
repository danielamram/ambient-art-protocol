import type { DataSignalBus } from '@ambient/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SignalScope } from '../state/signal-scope.js';

/** Buckets kept; with the cadences below that is 15 s, or 60 s with reduced motion. */
const LENGTH = 60;

/**
 * Feeds a SignalScope from the stage's bus. `attach` is called when the stage is created, before
 * the initial look is applied, so the scope knows the current mood from the start. Recording is
 * O(1) per signal. Sampling and React re-renders happen only while `active` (scope expanded,
 * panel open) on a fixed cadence, and pause in hidden tabs. Nothing touches the render loop.
 */
export function useSignalScope(active: boolean) {
  const scope = useRef(new SignalScope(LENGTH));
  const [, setVersion] = useState(0);
  const [intervalMs, setIntervalMs] = useState(250);

  const attach = useCallback((bus: DataSignalBus) => {
    const sub = bus.stream$.subscribe((signal) => scope.current.record(signal));
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    if (!active) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ms = reduced ? 1000 : 250;
    setIntervalMs(ms);
    const s = scope.current;
    s.clearHistory();
    setVersion((v) => v + 1);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      s.tick();
      setVersion((v) => v + 1);
    }, ms);
    return () => window.clearInterval(timer);
  }, [active]);

  return { scope: scope.current, windowSeconds: (LENGTH * intervalMs) / 1000, attach };
}
