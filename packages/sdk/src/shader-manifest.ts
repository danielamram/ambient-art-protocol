/**
 * Contract for a shader theme.
 *
 * A theme declares which uniforms it reads so the UI can list it and the engine can validate
 * that every declared uniform is one the SignalToUniformMapper knows how to drive.
 *
 * Authoring rules the engine relies on:
 *  - Output linear, HDR-ish colour into `fragColor`. Emitters may exceed 1.0; the engine's
 *    composite pass owns bloom, vignette, tonemapping, gamma, grain and dither. Themes must not.
 *  - Feedback themes read `u_prevFrame` (last frame's scene output) and must scale retention by
 *    `u_dt` (`prev * pow(retentionPerSecond, u_dt)`) so trails look the same at 60 and 120 Hz.
 */

export const STANDARD_UNIFORMS = [
  'u_time',
  'u_form',
  'u_pointer',
  'u_resolution',
  'u_pulse',
  'u_pulses',
  'u_current',
  'u_turbulence',
  'u_mood',
  /** Activity envelope in [0, 1]: rises with every pulse, decays over a couple of seconds. */
  'u_energy',
  /** Seconds since the previous frame. Feedback themes use it for frame-rate independent decay. */
  'u_dt',
  /** sampler2D bound to last frame's scene output. Only meaningful when `feedback` is true. */
  'u_prevFrame',
] as const;
export type StandardUniform = (typeof STANDARD_UNIFORMS)[number];

export type UniformKind = 'float' | 'vec2' | 'vec3' | 'vec4' | 'vec4[8]' | 'sampler2D';

export interface UniformDeclaration {
  readonly name: StandardUniform | (string & {});
  readonly kind: UniformKind;
  readonly default?: number | readonly number[];
}

/**
 * Per-theme post-processing hints. Every value is in [0, 1]; the engine maps them onto its own
 * ranges and lets the host override them. Omitted fields fall back to the engine defaults.
 */
export interface PostHints {
  /** How much blurred highlight is added back. 0 disables bloom. */
  readonly bloom?: number;
  /** Luminance knee above which pixels bloom. */
  readonly bloomThreshold?: number;
  /** Animated film grain amplitude. */
  readonly grain?: number;
  /** Radial chromatic aberration amount. */
  readonly aberration?: number;
  /** Edge darkening. */
  readonly vignette?: number;
}

/** Optional instanced ribbon pass, drawn over the fragment background into the same HDR target.
 * Vertex source is complete GLSL ES 3.00; six vertices per instance, no buffers required.
 * Analytic trajectories make seeking deterministic and work without float simulation textures.
 */
export interface GeometryPass {
  readonly vertex: string;
  readonly fragment: string;
  readonly instances: number;
  readonly lowInstances: number;
}

export interface ShaderManifest {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** GLSL ES 3.00 fragment shader source. */
  readonly fragment: string;
  readonly geometry?: GeometryPass;
  readonly uniforms: readonly UniformDeclaration[];
  /** When true the engine binds `u_prevFrame` to last frame's scene texture. */
  readonly feedback?: boolean;
  /** Post-processing hints applied when this theme is loaded. */
  readonly post?: PostHints;
}
