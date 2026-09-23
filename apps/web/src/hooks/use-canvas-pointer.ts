import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import type { StageHandle } from './use-ambient-stage.js';

/** Unchanged from the original handlers: magnitude of the release pulse. */
const RELEASE_PULSE = 0.7;

/** Normalized [0, 1] canvas coordinates, or null for a zero-sized (hidden or collapsed) canvas. */
export function normalizePointer(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

/**
 * Hold-to-gather, release-to-pulse on the canvas, with one active pointer at a time.
 * Cancellation, lost capture, window blur and unmount all end the gesture without a pulse.
 */
export function useCanvasPointer(handle: RefObject<StageHandle | null>) {
  const active = useRef<number | null>(null);

  const clear = () => {
    if (active.current === null) return;
    active.current = null;
    handle.current?.stage.endPointer();
  };
  const clearRef = useRef(clear);
  clearRef.current = clear;

  useEffect(() => {
    const onBlur = () => clearRef.current();
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      clearRef.current();
    };
  }, []);

  const position = (e: PointerEvent<HTMLCanvasElement>) =>
    normalizePointer(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);

  const release = (e: PointerEvent<HTMLCanvasElement>, pulse: boolean) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    const p = position(e);
    const stage = handle.current?.stage;
    if (p) {
      stage?.setPointer(p.x, p.y, false);
      if (pulse) stage?.pulse(RELEASE_PULSE, p);
    } else {
      stage?.endPointer();
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return {
    onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
      if (active.current !== null) return;
      const p = position(e);
      if (!p) return;
      active.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      handle.current?.stage.setPointer(p.x, p.y, true);
    },
    onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
      if (active.current !== e.pointerId) return;
      const p = position(e);
      if (p) handle.current?.stage.setPointer(p.x, p.y, true);
    },
    onPointerUp: (e: PointerEvent<HTMLCanvasElement>) => release(e, true),
    onPointerCancel: (e: PointerEvent<HTMLCanvasElement>) => release(e, false),
    onLostPointerCapture: (e: PointerEvent<HTMLCanvasElement>) => release(e, false),
  };
}
