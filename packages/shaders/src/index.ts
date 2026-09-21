/**
 * @ambient/shaders
 *
 * Themes are ShaderManifest objects. The engine's CanvasRenderer loads them; the web overlay
 * lists them. Planned next: cybernetic-mesh (raymarched sphere) and fluid-field (2D fluid).
 */
import type { ShaderManifest } from '@ambient/sdk';
import { auroraDrift } from './aurora-drift.js';

export { auroraDrift };

export const SHADER_MANIFESTS: readonly ShaderManifest[] = [auroraDrift];

export function findShader(id: string): ShaderManifest | undefined {
  return SHADER_MANIFESTS.find((m) => m.id === id);
}
