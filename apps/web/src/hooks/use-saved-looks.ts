import { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneRegistry } from '../state/artwork-settings.js';
import {
  type CommitResult,
  commitMutation,
  type KeyValueStore,
  type LookMutation,
  type LooksReadStatus,
  parseLooks,
  readLooks,
  type SavedLookV1,
  STORAGE_KEYS,
} from '../state/look-storage.js';

export type Persistence = 'durable' | 'memory' | 'unsupported';

const READ_NOTICE: Partial<Record<LooksReadStatus, (dropped: number) => string>> = {
  recovered: (n) =>
    `${n} saved ${n === 1 ? 'look' : 'looks'} could not be read and ${n === 1 ? 'was' : 'were'} skipped. The rest are below.`,
  corrupt: () => 'Saved looks on this device could not be read. New looks will still be saved.',
  unsupported: () =>
    'Saved looks here were made by a newer version of this app. They are left untouched; new looks last until this tab closes.',
  unavailable: () =>
    'This browser is not allowing storage, so saved looks last only until this tab closes.',
};

export const persistenceFor = (status: LooksReadStatus): Persistence =>
  status === 'unavailable' ? 'memory' : status === 'unsupported' ? 'unsupported' : 'durable';

/**
 * Saved looks with best-effort local persistence. Each mutation re-reads storage and applies
 * itself by id; `storage` events from other tabs refresh the list. Last write wins.
 */
export function useSavedLooks(
  store: KeyValueStore | null,
  scenes: SceneRegistry,
  notify: (text: string) => void,
) {
  const [initial] = useState(() => readLooks(store, scenes));
  const [looks, setLooks] = useState<readonly SavedLookV1[]>(initial.looks);
  const [persistence, setPersistence] = useState<Persistence>(persistenceFor(initial.status));
  const looksRef = useRef(looks);
  looksRef.current = looks;
  const announced = useRef(false);

  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    const message = READ_NOTICE[initial.status]?.(initial.dropped);
    // An empty list on a blocked-storage browser is not worth interrupting anyone for.
    if (message && !(initial.status === 'unavailable' && initial.looks.length === 0)) {
      notify(message);
    }
  }, [initial, notify]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEYS.looks) return;
      const read = parseLooks(e.key === null ? null : e.newValue, scenes);
      // Only adopt readable lists; a newer-version or corrupt write leaves this tab's list alone.
      if (read.status === 'ok' || read.status === 'recovered') setLooks(read.looks);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [scenes]);

  const mutate = useCallback(
    (m: LookMutation): CommitResult => {
      const result = commitMutation(store, scenes, looksRef.current, m);
      looksRef.current = result.looks;
      setLooks(result.looks);
      if (result.ok) {
        setPersistence(
          result.durable ? 'durable' : result.reason === 'unsupported' ? 'unsupported' : 'memory',
        );
      }
      return result;
    },
    [store, scenes],
  );

  return { looks, persistence, mutate };
}
