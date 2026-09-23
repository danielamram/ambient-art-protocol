import type { SourceStatus } from '@ambient/sdk';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { AmbientStage, type QualityMode, type Readout } from '../ambient.js';
import { artworkStage } from '../stage-adapter.js';
import { type ArtworkStage, applySettings } from '../state/apply-settings.js';
import { type ArtworkSettingsV1, defaultSettings } from '../state/artwork-settings.js';

export interface StageCallbacks {
  onReadout(r: Readout): void;
  onError(message: string): void;
  onSourceStatus(id: string, status: SourceStatus): void;
}

export interface StageHandle {
  readonly stage: AmbientStage;
  readonly art: ArtworkStage;
}

export interface MountedStage {
  /** The settings that were actually applied at mount, and the effective glow they produced. */
  readonly settings: ArtworkSettingsV1;
  readonly glow: number;
}

/**
 * Owns the single AmbientStage for a canvas: created on mount, disposed on unmount. StrictMode's
 * mount/unmount/mount leaves exactly one live stage because each effect run disposes its own.
 * Readouts arrive at the stage's own (half-second) cadence, never per frame.
 */
export function useAmbientStage(
  canvas: RefObject<HTMLCanvasElement | null>,
  initial: { readonly settings: ArtworkSettingsV1; readonly quality: QualityMode },
  callbacks: StageCallbacks,
): { readonly handle: RefObject<StageHandle | null>; readonly mounted: MountedStage | null } {
  const handle = useRef<StageHandle | null>(null);
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const init = useRef(initial);
  const [mounted, setMounted] = useState<MountedStage | null>(null);

  useEffect(() => {
    if (!canvas.current) return;
    let stage: AmbientStage;
    try {
      stage = new AmbientStage(canvas.current);
    } catch (e) {
      latest.current.onError(e instanceof Error ? e.message : String(e));
      return;
    }
    const art = artworkStage(stage);
    stage.onReadout((r) => latest.current.onReadout(r));
    stage.onError((m) => latest.current.onError(m));
    stage.onSourceStatus((id, s) => latest.current.onSourceStatus(id, s));
    const fallback = defaultSettings();
    let settings = init.current.settings;
    let result = applySettings(art, settings, fallback);
    if (!result.ok) {
      settings = fallback;
      result = applySettings(art, settings, fallback);
    }
    // Capture mode forces full quality inside the stage; a device preference must not undo that.
    if (init.current.quality !== 'auto' && !stage.captureMode) {
      stage.setQualityMode(init.current.quality);
    }
    handle.current = { stage, art };
    setMounted({ settings, glow: result.ok ? result.glow : art.glow });
    stage.start();
    return () => {
      handle.current = null;
      stage.dispose();
    };
  }, [canvas]);

  return { handle, mounted };
}
