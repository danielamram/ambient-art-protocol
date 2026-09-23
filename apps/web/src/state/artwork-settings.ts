/**
 * The user's selected artwork settings: what the panel shows, what a saved look stores and what
 * a share link carries. Pure data and transitions, no DOM access, so it is unit-tested in Node.
 *
 * These are *selected* values. Live sources may modulate the rendered output; the damped uniforms
 * the renderer actually uses are never written back here.
 */

export type PaletteId = 'glacier' | 'ember' | 'iris';
export type QualityMode = 'auto' | 'high' | 'low';

export interface ArtworkSettingsV1 {
  readonly version: 1;
  readonly scene: string;
  readonly palette: PaletteId;
  /** Finite, [0, 1]. */
  readonly form: number;
  /** Finite, [0, 1]. Feeds ArtClock.motion. */
  readonly motion: number;
  /** null = the scene's own default bloom; a number is an explicit override in [0, 1]. */
  readonly glow: number | null;
}

/** Belongs to this device, never to a shared look. */
export interface DevicePreferencesV1 {
  readonly version: 1;
  readonly quality: QualityMode;
}

/** Anything with manifest ids. Callers pass SHADER_MANIFESTS so there is one scene registry. */
export type SceneRegistry = readonly { readonly id: string; readonly name: string }[];

/** The single palette -> mood mapping in the app. Mood is the `ambiance.moodScore` wire field. */
export const PALETTES: readonly {
  readonly id: PaletteId;
  readonly name: string;
  readonly mood: number;
  readonly color: string;
}[] = [
  { id: 'glacier', name: 'Glacier', mood: 0, color: '#9adfcd' },
  { id: 'ember', name: 'Ember', mood: 0.5, color: '#e8a26a' },
  { id: 'iris', name: 'Iris', mood: 1, color: '#b7a0ec' },
];

export const DEFAULT_SCENE = 'living-filaments';
export const QUALITY_MODES: readonly QualityMode[] = ['auto', 'high', 'low'];

export const paletteOf = (id: PaletteId) =>
  PALETTES.find((p) => p.id === id) ?? (PALETTES[0] as (typeof PALETTES)[number]);

export const isPaletteId = (value: unknown): value is PaletteId =>
  PALETTES.some((p) => p.id === value);

export const hasScene = (scenes: SceneRegistry, id: unknown): id is string =>
  typeof id === 'string' && scenes.find((m) => m.id === id) !== undefined;

export const sceneName = (scenes: SceneRegistry, id: string): string =>
  scenes.find((m) => m.id === id)?.name ?? id;

/** Controls are shown and stored at slider precision: two decimals. */
export const roundControl = (value: number): number => Math.round(value * 100) / 100;

export function defaultSettings(scene = DEFAULT_SCENE): ArtworkSettingsV1 {
  return { version: 1, scene, palette: 'glacier', form: 0.45, motion: 0.45, glow: null };
}

export const DEFAULT_DEVICE: DevicePreferencesV1 = { version: 1, quality: 'auto' };

export type Validated<T> =
  | { readonly ok: true; readonly value: T; readonly adjusted: boolean }
  | { readonly ok: false };

/**
 * Validate a finite control value. Out-of-range finite numbers clamp to [0, 1] and report
 * `adjusted`; anything else (NaN, Infinity, strings, missing) is invalid.
 */
export function validateControl(value: unknown): Validated<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false };
  const clamped = roundControl(Math.max(0, Math.min(1, value)));
  return { ok: true, value: clamped, adjusted: value < 0 || value > 1 };
}

/** Validate an untrusted settings object (from storage or a decoded link) as a whole. */
export function validateSettings(
  input: unknown,
  scenes: SceneRegistry,
): Validated<ArtworkSettingsV1> {
  if (typeof input !== 'object' || input === null) return { ok: false };
  const o = input as Record<string, unknown>;
  if (o.version !== 1 || !hasScene(scenes, o.scene) || !isPaletteId(o.palette)) {
    return { ok: false };
  }
  const form = validateControl(o.form);
  const motion = validateControl(o.motion);
  const glow = o.glow === null ? null : validateControl(o.glow);
  if (!form.ok || !motion.ok || (glow !== null && !glow.ok)) return { ok: false };
  return {
    ok: true,
    value: {
      version: 1,
      scene: o.scene,
      palette: o.palette,
      form: form.value,
      motion: motion.value,
      glow: glow === null ? null : glow.value,
    },
    adjusted: form.adjusted || motion.adjusted || (glow?.adjusted ?? false),
  };
}

export function validateDevicePreferences(input: unknown): DevicePreferencesV1 | null {
  if (typeof input !== 'object' || input === null) return null;
  const o = input as Record<string, unknown>;
  if (o.version !== 1 || !QUALITY_MODES.includes(o.quality as QualityMode)) return null;
  return { version: 1, quality: o.quality as QualityMode };
}

export const settingsEqual = (a: ArtworkSettingsV1, b: ArtworkSettingsV1): boolean =>
  a.scene === b.scene &&
  a.palette === b.palette &&
  a.form === b.form &&
  a.motion === b.motion &&
  a.glow === b.glow;

/** Fresh scene selection keeps palette/form/motion and restores the new scene's own lighting. */
export const withScene = (s: ArtworkSettingsV1, scene: string): ArtworkSettingsV1 => ({
  ...s,
  scene,
  glow: null,
});

/** Reset artwork: palette/form/motion/glow back to defaults, keeping the scene. */
export const resetArtwork = (s: ArtworkSettingsV1): ArtworkSettingsV1 => defaultSettings(s.scene);
