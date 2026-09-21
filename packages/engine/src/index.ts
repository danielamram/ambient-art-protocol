/**
 * @ambient/engine
 *
 * Phase 2: SignalToUniformMapper (target vs. current state, frame-rate independent damping,
 *          pulse ring buffer). Subscribes to a DataSignalBus; never touches WebGL.
 * Phase 3: WebGL2 fullscreen-quad canvas controller that loads a ShaderManifest and
 *          pushes the mapper's uniform state each frame.
 */
import type { StandardUniform } from '@ambient/sdk';

export const ENGINE_VERSION = '0.0.0' as const;

/** The uniform state the mapper will own. Declared now so Phase 2 has a target shape. */
export type UniformState = Readonly<Record<StandardUniform, number | readonly number[]>>;
