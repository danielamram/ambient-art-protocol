import { type ArtworkSettingsV1, paletteOf } from './artwork-settings.js';

/**
 * The narrow set of stage operations the app needs. Implemented over AmbientStage in
 * `stage-adapter.ts`; tests use a fake. Nothing here exposes WebGL or mapper internals.
 */
export interface ArtworkStage {
  readonly scene: string;
  /** Effective bloom, after scene defaults and any override. */
  readonly glow: number;
  /** Returns false (and keeps the previous scene) when the scene is unknown or fails to compile. */
  selectScene(id: string): boolean;
  /** Clears post overrides back to the current scene's defaults; returns the effective glow. */
  clearLighting(): number;
  setPalette(mood: number): void;
  setForm(value: number): void;
  setMotion(value: number): void;
  /** Returns the effective glow. */
  setGlow(value: number): number;
}

export type ApplyResult =
  | { readonly ok: true; readonly glow: number }
  | { readonly ok: false; readonly reason: 'scene' | 'apply' };

/**
 * The one ordered path for applying a full look: switch scene, clear prior post overrides, apply
 * palette/form/motion, then an explicit glow. Pause is never touched. `next` must already be
 * validated. On failure the stage is restored to `previous` best-effort and nothing is reported as
 * applied.
 */
export function applySettings(
  stage: ArtworkStage,
  next: ArtworkSettingsV1,
  previous: ArtworkSettingsV1,
): ApplyResult {
  if (stage.scene !== next.scene && !stage.selectScene(next.scene)) {
    // setTheme failed before touching anything: the previous scene and settings still stand.
    return { ok: false, reason: 'scene' };
  }
  try {
    return { ok: true, glow: write(stage, next) };
  } catch {
    try {
      if (stage.scene !== previous.scene) stage.selectScene(previous.scene);
      write(stage, previous);
    } catch {
      // Best effort: the caller still reports failure and keeps showing `previous`.
    }
    return { ok: false, reason: 'apply' };
  }
}

function write(stage: ArtworkStage, s: ArtworkSettingsV1): number {
  let glow = stage.clearLighting();
  stage.setPalette(paletteOf(s.palette).mood);
  stage.setForm(s.form);
  stage.setMotion(s.motion);
  if (s.glow !== null) glow = stage.setGlow(s.glow);
  return glow;
}
