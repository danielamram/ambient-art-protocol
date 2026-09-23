import { type RefObject, useEffect, useRef, useState } from 'react';

const IDLE_MS = 7000;

/** Text-entry controls where letters, digits and Space belong to the control, not shortcuts. */
export const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset'].includes(target.type);
  }
  return false;
};

/** Space and Enter activate focused buttons, links, summaries and sliders natively. */
const activatesOnSpace = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.closest('button, a[href], summary, [role="button"]') !== null ||
    (target instanceof HTMLInputElement && target.type !== 'text'));

export interface Shortcuts {
  pulse(): void;
  pause(): void;
  togglePanel(): void;
  fullscreen?: () => void;
  scene(index: number): void;
}

/**
 * Global keyboard shortcuts. Ignored with command modifiers, in text entry, and for held-key
 * repeats (so a held P or 1 never flickers pause or scenes, and a held Space sends one pulse).
 * Escape is handled by the panel itself, not here.
 */
export function useShortcuts(shortcuts: Shortcuts, enabled: boolean): void {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTextEntry(e.target)) return;
      const s = latest.current;
      const key = e.key.toLowerCase();
      if (e.key === ' ') {
        if (activatesOnSpace(e.target)) return;
        e.preventDefault();
        if (!e.repeat) s.pulse();
        return;
      }
      if (e.repeat) return;
      if (key === 'p') s.pause();
      else if (key === 'h') s.togglePanel();
      else if (key === 'f') s.fullscreen?.();
      else if (/^[1-9]$/.test(e.key)) s.scene(Number(e.key) - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/**
 * Cinema mode: chrome fades after a few idle seconds and any pointer or key activity wakes it.
 * It never hides while a control has keyboard focus. A control focused by a mouse click is blurred
 * as the chrome hides, so it doesn't keep the chrome pinned or stay focused while invisible.
 */
export function useIdleChrome(scope: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let timer = 0;
    const events = ['pointermove', 'pointerdown', 'keydown', 'focusin'] as const;
    const sleep = () => {
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        scope.current?.contains(focused) &&
        focused !== document.body
      ) {
        if (focused.matches(':focus-visible')) return;
        if (focused.closest('.chrome')) focused.blur();
      }
      setIdle(true);
    };
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(sleep, IDLE_MS);
    };
    for (const event of events) window.addEventListener(event, wake);
    wake();
    return () => {
      window.clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, wake);
    };
  }, [scope, enabled]);
  return idle;
}
