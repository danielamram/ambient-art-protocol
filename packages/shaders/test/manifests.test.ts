import { STANDARD_UNIFORMS, type UniformKind } from '@ambient/sdk';
import { describe, expect, it } from 'vitest';
import { findShader, SHADER_MANIFESTS } from '../src/index.js';

const glslDecl = (name: string, kind: UniformKind): RegExp => {
  if (kind === 'vec4[8]') return new RegExp(`uniform\\s+vec4\\s+${name}\\s*\\[\\s*8\\s*\\]\\s*;`);
  return new RegExp(`uniform\\s+${kind}\\s+${name}\\s*;`);
};

describe('shader manifests', () => {
  it('ships three themes with unique ids that findShader resolves', () => {
    expect(SHADER_MANIFESTS.length).toBeGreaterThanOrEqual(3);
    const ids = SHADER_MANIFESTS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of SHADER_MANIFESTS) expect(findShader(m.id)).toBe(m);
    expect(findShader('nope')).toBeUndefined();
  });

  for (const m of SHADER_MANIFESTS) {
    describe(m.id, () => {
      it('declares every uniform it lists, with the listed GLSL type', () => {
        for (const u of m.uniforms) {
          expect(m.fragment, `${u.name} (${u.kind})`).toMatch(glslDecl(u.name, u.kind));
        }
      });

      it('only lists uniforms the mapper can drive', () => {
        for (const u of m.uniforms) {
          expect(STANDARD_UNIFORMS as readonly string[]).toContain(u.name);
        }
      });

      it('uses the 8-slot pulse ring the PulseBuffer packs', () => {
        expect(m.uniforms.find((u) => u.name === 'u_pulses')?.kind).toBe('vec4[8]');
      });

      it('is a GLSL ES 3.00 body without boilerplate the engine adds', () => {
        expect(m.fragment).not.toContain('#version');
        expect(m.fragment).not.toContain('gl_FragColor');
        expect(m.fragment).toContain('fragColor =');
      });

      it('reads u_prevFrame exactly when it is a feedback theme', () => {
        const declares = /uniform\s+sampler2D\s+u_prevFrame\s*;/.test(m.fragment);
        const samples = m.fragment.includes('texture(u_prevFrame');
        expect(declares).toBe(m.feedback === true);
        expect(samples).toBe(m.feedback === true);
        if (m.feedback) {
          expect(m.uniforms.some((u) => u.name === 'u_prevFrame' && u.kind === 'sampler2D')).toBe(
            true,
          );
          // Frame-rate independent decay is mandatory for feedback.
          expect(m.fragment).toMatch(/pow\([0-9.]+,\s*u_dt\)/);
        }
      });

      it('keeps post hints in [0, 1]', () => {
        for (const v of Object.values(m.post ?? {})) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      });
    });
  }
});
