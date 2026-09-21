import type { PostHints } from '@ambient/sdk';

/**
 * Resolved post-processing settings. Every number is in [0, 1] and is mapped onto real shader
 * ranges inside the composite pass, so hosts and themes talk the same protocol-style units.
 */
export interface PostSettings {
  /** When false the scene is copied to the screen untouched (render scale still applies). */
  readonly enabled: boolean;
  readonly bloom: number;
  readonly bloomThreshold: number;
  readonly grain: number;
  readonly aberration: number;
  readonly vignette: number;
  /** Separable blur passes over the bloom buffer. 2 is softer and wider; 1 is cheaper. */
  readonly blurIterations: 1 | 2;
}

export const DEFAULT_POST: PostSettings = {
  enabled: true,
  bloom: 0.6,
  bloomThreshold: 0.55,
  grain: 0.25,
  aberration: 0.25,
  vignette: 0.5,
  blurIterations: 2,
};

export interface PostEnvironment {
  /** True when the scene target is a float format and can hold values above 1.0. */
  readonly hdr: boolean;
}

const clamp01 = (n: number | undefined, fallback: number): number => {
  if (typeof n !== 'number' || Number.isNaN(n)) return fallback;
  return n < 0 ? 0 : n > 1 ? 1 : n;
};

/**
 * Merge `DEFAULT_POST` <- theme hints <- host override, clamp everything, and adapt to the
 * render target. In the RGBA8 fallback the scene is clamped at 1.0, so a threshold near 1
 * would bloom nothing; it is scaled down so highlights still glow.
 */
export function normalizePost(
  hints: PostHints | undefined,
  override: Partial<PostSettings> | undefined,
  env: PostEnvironment,
): PostSettings {
  const h = hints ?? {};
  const o = override ?? {};
  const pick = (key: keyof PostHints): number =>
    clamp01(o[key], clamp01(h[key], DEFAULT_POST[key]));
  const threshold = pick('bloomThreshold');
  return {
    enabled: o.enabled ?? DEFAULT_POST.enabled,
    bloom: pick('bloom'),
    bloomThreshold: env.hdr ? threshold : threshold * 0.7,
    grain: pick('grain'),
    aberration: pick('aberration'),
    vignette: pick('vignette'),
    blurIterations: o.blurIterations ?? DEFAULT_POST.blurIterations,
  };
}
