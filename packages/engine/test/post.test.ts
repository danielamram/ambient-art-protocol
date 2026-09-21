import { describe, expect, it } from 'vitest';
import { planPasses, planTargets } from '../src/post/plan.js';
import { DEFAULT_POST, normalizePost } from '../src/post/settings.js';
import {
  BLUR_FRAGMENT,
  BRIGHT_PASS_FRAGMENT,
  COMPOSITE_FRAGMENT,
  COPY_FRAGMENT,
} from '../src/post/shaders.js';
import { assembleFragment } from '../src/renderer.js';

const hdr = { hdr: true };

describe('normalizePost', () => {
  it('falls back to defaults when nothing is given', () => {
    expect(normalizePost(undefined, undefined, hdr)).toEqual(DEFAULT_POST);
  });

  it('applies theme hints, then host overrides on top', () => {
    const s = normalizePost({ bloom: 0.9, grain: 0.1 }, { grain: 0.5 }, hdr);
    expect(s.bloom).toBe(0.9);
    expect(s.grain).toBe(0.5);
    expect(s.aberration).toBe(DEFAULT_POST.aberration);
  });

  it('clamps every number into [0, 1] and ignores NaN', () => {
    const s = normalizePost({ bloom: 4, vignette: -2 }, { aberration: Number.NaN }, hdr);
    expect(s.bloom).toBe(1);
    expect(s.vignette).toBe(0);
    expect(s.aberration).toBe(DEFAULT_POST.aberration);
  });

  it('lowers the bloom threshold when the scene target is 8-bit', () => {
    const a = normalizePost({ bloomThreshold: 0.8 }, undefined, hdr);
    const b = normalizePost({ bloomThreshold: 0.8 }, undefined, { hdr: false });
    expect(a.bloomThreshold).toBe(0.8);
    expect(b.bloomThreshold).toBeCloseTo(0.56, 6);
  });

  it('lets the host disable the stack and change blur iterations', () => {
    const s = normalizePost(undefined, { enabled: false, blurIterations: 1 }, hdr);
    expect(s.enabled).toBe(false);
    expect(s.blurIterations).toBe(1);
  });
});

describe('planTargets', () => {
  it('scales the scene and quarters the bloom buffers', () => {
    const p = planTargets({
      canvasWidth: 1920,
      canvasHeight: 1080,
      renderScale: 0.5,
      maxTextureSize: 8192,
    });
    expect(p.scene).toEqual([960, 540]);
    expect(p.bloom).toEqual([240, 135]);
    expect(p.effectiveScale).toBe(0.5);
  });

  it('never exceeds the GPU texture limit', () => {
    const p = planTargets({
      canvasWidth: 7680,
      canvasHeight: 4320,
      renderScale: 1,
      maxTextureSize: 4096,
    });
    expect(p.scene[0]).toBeLessThanOrEqual(4096);
    expect(p.scene[1]).toBeLessThanOrEqual(4096);
    expect(p.effectiveScale).toBeLessThan(1);
  });

  it('keeps every target at least one pixel and sanitizes the scale', () => {
    const p = planTargets({
      canvasWidth: 2,
      canvasHeight: 2,
      renderScale: Number.NaN,
      maxTextureSize: 4096,
    });
    expect(p.scene).toEqual([2, 2]);
    expect(p.bloom).toEqual([1, 1]);
    expect(p.effectiveScale).toBe(1);
  });
});

describe('planPasses', () => {
  it('is scene then composite when post is off', () => {
    expect(planPasses({ ...DEFAULT_POST, enabled: false })).toEqual(['scene', 'composite']);
  });

  it('skips the bloom chain when bloom is zero', () => {
    expect(planPasses({ ...DEFAULT_POST, bloom: 0 })).toEqual(['scene', 'composite']);
  });

  it('repeats the blur pair per iteration', () => {
    expect(planPasses({ ...DEFAULT_POST, blurIterations: 1 })).toEqual([
      'scene',
      'bright',
      'blurH',
      'blurV',
      'composite',
    ]);
    expect(planPasses({ ...DEFAULT_POST, blurIterations: 2 })).toHaveLength(7);
  });
});

describe('post shaders', () => {
  const all = { BRIGHT_PASS_FRAGMENT, BLUR_FRAGMENT, COMPOSITE_FRAGMENT, COPY_FRAGMENT };
  for (const [name, src] of Object.entries(all)) {
    it(`${name} assembles with a single version line and writes fragColor`, () => {
      const out = assembleFragment(src);
      expect(out.match(/#version/g)).toHaveLength(1);
      expect(out).toContain('fragColor =');
      expect(out).toContain('uniform vec2 u_resolution;');
    });
  }

  it('composite declares the uniforms the renderer drives', () => {
    for (const u of [
      'u_scene',
      'u_bloom',
      'u_bloomStrength',
      'u_aberration',
      'u_grain',
      'u_vignette',
      'u_energy',
    ]) {
      expect(COMPOSITE_FRAGMENT).toContain(u);
    }
  });
});
