import { describe, expect, it } from 'vitest';
import { assembleFragment, VERTEX_SHADER } from '../src/renderer.js';

describe('assembleFragment', () => {
  it('adds version, precision, and output when missing', () => {
    const out = assembleFragment('void main() { fragColor = vec4(1.0); }');
    expect(out.startsWith('#version 300 es\n')).toBe(true);
    expect(out).toContain('precision highp float;');
    expect(out).toContain('out vec4 fragColor;');
    expect(out).toContain('void main()');
  });

  it('keeps an explicit version line first and does not duplicate boilerplate', () => {
    const src = `#version 300 es
precision mediump float;
out vec4 color;
void main() { color = vec4(0.0); }`;
    const out = assembleFragment(src);
    expect(out.startsWith('#version 300 es\n')).toBe(true);
    expect(out.match(/#version/g)).toHaveLength(1);
    expect(out.match(/precision/g)).toHaveLength(1);
    expect(out.match(/out vec4/g)).toHaveLength(1);
  });

  it('exports a vertex shader that uses gl_VertexID', () => {
    expect(VERTEX_SHADER).toContain('gl_VertexID');
    expect(VERTEX_SHADER.startsWith('#version 300 es')).toBe(true);
  });
});

describe('assembleFragment defines', () => {
  it('injects #define lines after precision and before the output declaration', () => {
    const out = assembleFragment('void main() { fragColor = vec4(1.0); }', {
      AAP_QUALITY: 1,
      FOO: 'bar',
    });
    const lines = out.split('\n');
    expect(lines[0]).toBe('#version 300 es');
    expect(lines[1]).toBe('precision highp float;');
    expect(lines[2]).toBe('#define AAP_QUALITY 1');
    expect(lines[3]).toBe('#define FOO bar');
    expect(lines[4]).toBe('out vec4 fragColor;');
  });
});
