import type { AmbientStage } from './ambient.js';
import type { ArtworkStage } from './state/apply-settings.js';
import type { SourceDriver } from './state/source-coordinator.js';

/** Turbulence the overlay has always emitted alongside the palette mood. */
const OVERLAY_TURBULENCE = 0.2;

/**
 * Maps the app's settings operations onto the existing AmbientStage calls. Values are set exactly
 * as the previous inline React handlers did; the render loop, clock formula and uniforms are
 * untouched.
 */
export function artworkStage(stage: AmbientStage): ArtworkStage {
  return {
    get scene() {
      return stage.themeId;
    },
    get glow() {
      return stage.post.bloom;
    },
    selectScene: (id) => stage.setTheme(id),
    clearLighting: () => stage.resetLook().bloom,
    setPalette: (mood) => stage.setAmbiance(mood, OVERLAY_TURBULENCE),
    setForm: (value) => {
      stage.form = value;
      stage.invalidate();
    },
    setMotion: (value) => {
      stage.clock.motion = value;
      stage.invalidate();
    },
    setGlow: (value) => stage.setPost({ bloom: value }).bloom,
  };
}

/**
 * Source lifecycle over AmbientStage.setSource. setSource logs and swallows start failures, so a
 * start only counts as successful when the source actually reports 'running'.
 */
export function sourceDriver(stage: AmbientStage, restoreAutonomous: () => void): SourceDriver {
  return {
    async start(id) {
      await stage.setSource(id, true);
      if (stage.sourceStatus(id) !== 'running') throw new Error(`Source "${id}" is not running`);
    },
    stop: (id) => stage.setSource(id, false),
    restoreAutonomous,
  };
}
