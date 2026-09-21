/**
 * @ambient/engine
 *
 * Phase 2: SignalToUniformMapper turns bus signals into damped uniform state.
 * Phase 3: CanvasRenderer, a WebGL2 fullscreen-triangle renderer that loads a ShaderManifest
 *          and pushes the mapper's snapshot each frame.
 */
export const ENGINE_VERSION = '0.2.0' as const;

export { expDamp, expDampAngle } from './damp.js';
export { type FrameCallback, FrameLoop, type FrameLoopOptions } from './frame-loop.js';
export { type MapperOptions, SignalToUniformMapper, type UniformState } from './mapper.js';
export { type LivePulse, PulseBuffer, type PulseBufferOptions } from './pulse-buffer.js';
export {
  assembleFragment,
  CanvasRenderer,
  type CanvasRendererOptions,
  ShaderCompileError,
  VERTEX_SHADER,
} from './renderer.js';
