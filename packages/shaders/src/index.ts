/**
 * @ambient/shaders
 *
 * Themes are ShaderManifest objects. The engine's CanvasRenderer loads them and runs them
 * through its post stack; the web overlay lists them. Themes output linear HDR colour and may
 * read last frame through `u_prevFrame` when they set `feedback: true`.
 */
import type { ShaderManifest } from '@ambient/sdk';
import { auroraDrift } from './aurora-drift.js';
import { cyberneticMesh } from './cybernetic-mesh.js';
import { fluidField } from './fluid-field.js';

export * from './lib/glsl.js';
export { auroraDrift, cyberneticMesh, fluidField };

export const SHADER_MANIFESTS: readonly ShaderManifest[] = [
  auroraDrift,
  fluidField,
  cyberneticMesh,
];

export function findShader(id: string): ShaderManifest | undefined {
  return SHADER_MANIFESTS.find((m) => m.id === id);
}
