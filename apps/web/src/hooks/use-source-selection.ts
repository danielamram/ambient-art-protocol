import type { SourceStatus } from '@ambient/sdk';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { sourceDriver } from '../stage-adapter.js';
import { AUTONOMOUS, SourceCoordinator, type SourceView } from '../state/source-coordinator.js';
import type { MountedStage, StageHandle } from './use-ambient-stage.js';

/**
 * One SourceCoordinator per mounted stage. `restoreAutonomous` is read through a ref when the
 * coordinator settles, so it always applies the latest selected palette, never a stale closure.
 */
export function useSourceSelection(
  handle: RefObject<StageHandle | null>,
  mounted: MountedStage | null,
  restoreAutonomous: () => void,
) {
  const [view, setView] = useState<SourceView>(AUTONOMOUS);
  const coordinator = useRef<SourceCoordinator | null>(null);
  const restore = useRef(restoreAutonomous);
  restore.current = restoreAutonomous;

  useEffect(() => {
    const h = handle.current;
    if (!mounted || !h) return;
    const c = new SourceCoordinator(
      sourceDriver(h.stage, () => restore.current()),
      setView,
    );
    coordinator.current = c;
    return () => {
      // Closed synchronously: nothing after this point writes to React state or starts a source.
      coordinator.current = null;
      void c.dispose();
    };
  }, [handle, mounted]);

  const select = useCallback((id: string) => coordinator.current?.select(id), []);
  const retry = useCallback(() => coordinator.current?.retry(), []);
  const onStatus = useCallback(
    (id: string, status: SourceStatus) => coordinator.current?.status(id, status),
    [],
  );
  return { view, select, retry, onStatus };
}
