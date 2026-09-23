import { useCallback, useEffect, useRef, useState } from 'react';

export interface Notice {
  readonly id: number;
  readonly text: string;
  readonly action?: { readonly label: string; run(): void };
}

/**
 * One unobtrusive notice at a time, announced through a polite live region by <NoticeRegion>.
 * A newer notice replaces the older one. Notices dismiss themselves; ones with an action stay
 * longer so the action can be reached.
 */
export function useNotices(enabled: boolean) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const next = useRef(0);
  const notify = useCallback(
    (text: string, action?: Notice['action']) => {
      if (!enabled) return;
      next.current += 1;
      setNotice({ id: next.current, text, ...(action ? { action } : {}) });
    },
    [enabled],
  );
  const dismiss = useCallback(() => setNotice(null), []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.action ? 10000 : 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return { notice, notify, dismiss };
}
