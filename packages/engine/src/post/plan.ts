import type { PostSettings } from './settings.js';

export type PassId = 'scene' | 'bright' | 'blurH' | 'blurV' | 'composite';

export interface TargetPlanInput {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** Scene resolution as a fraction of the canvas, 0..1. */
  readonly renderScale: number;
  /** Bloom buffers are the scene size divided by this. Default 4. */
  readonly bloomDivisor?: number;
  /** GPU limit; targets are clamped so they never exceed it. */
  readonly maxTextureSize: number;
}

export interface TargetPlan {
  readonly scene: readonly [number, number];
  readonly bloom: readonly [number, number];
  /** The scale actually used after clamping to `maxTextureSize`. */
  readonly effectiveScale: number;
}

const clampScale = (s: number): number => {
  if (!Number.isFinite(s) || s <= 0) return 1;
  return s > 1 ? 1 : s;
};

/** Sizes for the offscreen targets. Pure, so the arithmetic is unit-tested without a GPU. */
export function planTargets(input: TargetPlanInput): TargetPlan {
  const w = Math.max(1, Math.floor(input.canvasWidth));
  const h = Math.max(1, Math.floor(input.canvasHeight));
  const max = Math.max(1, Math.floor(input.maxTextureSize));
  let scale = clampScale(input.renderScale);
  const longest = Math.max(w, h) * scale;
  if (longest > max) scale = max / Math.max(w, h);
  const sw = Math.max(1, Math.floor(w * scale));
  const sh = Math.max(1, Math.floor(h * scale));
  const div = Math.max(1, input.bloomDivisor ?? 4);
  return {
    scene: [sw, sh],
    bloom: [Math.max(1, Math.floor(sw / div)), Math.max(1, Math.floor(sh / div))],
    effectiveScale: scale,
  };
}

/** Ordered draw list for one frame given the resolved settings. */
export function planPasses(settings: PostSettings): readonly PassId[] {
  if (!settings.enabled) return ['scene', 'composite'];
  const passes: PassId[] = ['scene'];
  if (settings.bloom > 0) {
    passes.push('bright');
    for (let i = 0; i < settings.blurIterations; i += 1) passes.push('blurH', 'blurV');
  }
  passes.push('composite');
  return passes;
}
