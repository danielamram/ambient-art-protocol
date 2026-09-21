/**
 * @ambient/engine
 *
 * Phase 2 (this): SignalToUniformMapper turns bus signals into damped uniform state.
 * Phase 3: a WebGL2 fullscreen-quad canvas controller that loads a ShaderManifest and pushes
 *          the mapper's snapshot each frame.
 */
export const ENGINE_VERSION = '0.1.0' as const;

export { expDamp, expDampAngle } from './damp.js';
export { type FrameCallback, FrameLoop, type FrameLoopOptions } from './frame-loop.js';
export { type MapperOptions, SignalToUniformMapper, type UniformState } from './mapper.js';
export { type LivePulse, PulseBuffer, type PulseBufferOptions } from './pulse-buffer.js';
