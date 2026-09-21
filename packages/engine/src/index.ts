/**
 * @ambient/engine
 *
 * Phase 2: SignalToUniformMapper turns bus signals into damped uniform state.
 * Phase 3: CanvasRenderer, a WebGL2 fullscreen-triangle renderer with a post stack (feedback,
 *          bloom, tonemap, grain) that loads a ShaderManifest and pushes the mapper's snapshot
 *          each frame. QualityController adapts render scale to the measured frame rate.
 */
export const ENGINE_VERSION = '0.3.0' as const;

export { expDamp, expDampAngle } from './damp.js';
export { addEnergy, decayEnergy } from './energy.js';
export { type FrameCallback, FrameLoop, type FrameLoopOptions } from './frame-loop.js';
export { type MapperOptions, SignalToUniformMapper, type UniformState } from './mapper.js';
export {
  type PassId,
  planPasses,
  planTargets,
  type TargetPlan,
  type TargetPlanInput,
} from './post/plan.js';
export {
  DEFAULT_POST,
  normalizePost,
  type PostEnvironment,
  type PostSettings,
} from './post/settings.js';
export {
  BLUR_FRAGMENT,
  BRIGHT_PASS_FRAGMENT,
  COMPOSITE_FRAGMENT,
  COPY_FRAGMENT,
  POST_RANGES,
} from './post/shaders.js';
export { type LivePulse, PulseBuffer, type PulseBufferOptions } from './pulse-buffer.js';
export {
  QUALITY_LEVELS,
  QualityController,
  type QualityControllerOptions,
  type QualityLevel,
} from './quality.js';
export {
  assembleFragment,
  CanvasRenderer,
  type CanvasRendererOptions,
  ShaderCompileError,
  type ShaderDefines,
  type ShaderQuality,
  VERTEX_SHADER,
} from './renderer.js';
