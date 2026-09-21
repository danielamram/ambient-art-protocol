/**
 * Contract for a shader theme. Types only in Phase 1; the engine consumes these in Phase 3.
 *
 * A theme declares which uniforms it reads so the UI can list it and the engine can validate
 * that every declared uniform is one the SignalToUniformMapper knows how to drive.
 */

export const STANDARD_UNIFORMS = [
  'u_time',
  'u_resolution',
  'u_pulse',
  'u_pulses',
  'u_current',
  'u_turbulence',
  'u_mood',
] as const;
export type StandardUniform = (typeof STANDARD_UNIFORMS)[number];

export type UniformKind = 'float' | 'vec2' | 'vec3' | 'vec4' | 'vec4[8]';

export interface UniformDeclaration {
  readonly name: StandardUniform | (string & {});
  readonly kind: UniformKind;
  readonly default?: number | readonly number[];
}

export interface ShaderManifest {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** GLSL ES 3.00 fragment shader source. */
  readonly fragment: string;
  readonly uniforms: readonly UniformDeclaration[];
}
