import type { AmbientStage } from './ambient.js';
import type { ArtworkStage } from './state/apply-settings.js';

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
