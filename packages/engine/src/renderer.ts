import type { ShaderManifest } from '@ambient/sdk';
import type { UniformState } from './mapper.js';

/** Fullscreen triangle from gl_VertexID; no vertex buffers needed. */
export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Normalize a fragment shader so theme authors can omit boilerplate.
 * Adds the GLSL ES 3.00 version line, a default precision, and `out vec4 fragColor` when absent.
 */
export function assembleFragment(source: string): string {
  let body = source.trimStart();
  let version = '#version 300 es\n';
  if (body.startsWith('#version')) {
    const nl = body.indexOf('\n');
    version = `${body.slice(0, nl)}\n`;
    body = body.slice(nl + 1);
  }
  const precision = /precision\s+\w+\s+float\s*;/.test(body) ? '' : 'precision highp float;\n';
  const out = /\bout\s+vec4\s+\w+\s*;/.test(body) ? '' : 'out vec4 fragColor;\n';
  return `${version}${precision}${out}${body}`;
}

export class ShaderCompileError extends Error {
  override readonly name = 'ShaderCompileError';
  readonly stage: 'vertex' | 'fragment' | 'link';
  readonly log: string;
  constructor(stage: 'vertex' | 'fragment' | 'link', log: string) {
    super(`${stage} shader failed: ${log.trim()}`);
    this.stage = stage;
    this.log = log;
  }
}

export interface CanvasRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly manifest: ShaderManifest;
  /** Cap on devicePixelRatio. Default 2. */
  readonly maxPixelRatio?: number;
  readonly contextAttributes?: WebGLContextAttributes;
}

type Locations = {
  u_time: WebGLUniformLocation | null;
  u_resolution: WebGLUniformLocation | null;
  u_pulse: WebGLUniformLocation | null;
  u_pulses: WebGLUniformLocation | null;
  u_current: WebGLUniformLocation | null;
  u_turbulence: WebGLUniformLocation | null;
  u_mood: WebGLUniformLocation | null;
};

/**
 * Raw WebGL2 fullscreen-quad renderer. Loads one ShaderManifest at a time and pushes a
 * UniformState each frame. No Three.js, no buffers: the vertex stage synthesizes the triangle.
 */
export class CanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly maxPixelRatio: number;
  #program: WebGLProgram | undefined;
  #vao: WebGLVertexArrayObject | null = null;
  #loc: Locations | undefined;
  #manifest: ShaderManifest;

  constructor(options: CanvasRendererOptions) {
    this.canvas = options.canvas;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      ...options.contextAttributes,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.#vao = gl.createVertexArray();
    gl.bindVertexArray(this.#vao);
    this.#manifest = options.manifest;
    this.setShader(options.manifest);
    this.resize();
  }

  get manifest(): ShaderManifest {
    return this.#manifest;
  }

  /** Compile and switch to a new theme. On failure the previous program stays active. */
  setShader(manifest: ShaderManifest): void {
    const gl = this.gl;
    const program = this.#link(VERTEX_SHADER, assembleFragment(manifest.fragment));
    if (this.#program) gl.deleteProgram(this.#program);
    this.#program = program;
    this.#manifest = manifest;
    gl.useProgram(program);
    this.#loc = {
      u_time: gl.getUniformLocation(program, 'u_time'),
      u_resolution: gl.getUniformLocation(program, 'u_resolution'),
      u_pulse: gl.getUniformLocation(program, 'u_pulse'),
      u_pulses: gl.getUniformLocation(program, 'u_pulses'),
      u_current: gl.getUniformLocation(program, 'u_current'),
      u_turbulence: gl.getUniformLocation(program, 'u_turbulence'),
      u_mood: gl.getUniformLocation(program, 'u_mood'),
    };
  }

  /** Match the drawing buffer to the canvas's CSS size times devicePixelRatio. Returns [w, h]. */
  resize(): readonly [number, number] {
    const dpr = Math.min(
      typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
      this.maxPixelRatio,
    );
    const w = Math.max(1, Math.floor((this.canvas.clientWidth || this.canvas.width) * dpr));
    const h = Math.max(1, Math.floor((this.canvas.clientHeight || this.canvas.height) * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    return [w, h];
  }

  render(state: UniformState): void {
    const gl = this.gl;
    const loc = this.#loc;
    if (!this.#program || !loc) return;
    gl.useProgram(this.#program);
    if (loc.u_time) gl.uniform1f(loc.u_time, state.u_time);
    if (loc.u_resolution) gl.uniform2f(loc.u_resolution, this.canvas.width, this.canvas.height);
    if (loc.u_pulse) gl.uniform1f(loc.u_pulse, state.u_pulse);
    if (loc.u_pulses) gl.uniform4fv(loc.u_pulses, state.u_pulses);
    if (loc.u_current) {
      gl.uniform3f(loc.u_current, state.u_current[0], state.u_current[1], state.u_current[2]);
    }
    if (loc.u_turbulence) gl.uniform1f(loc.u_turbulence, state.u_turbulence);
    if (loc.u_mood) gl.uniform1f(loc.u_mood, state.u_mood);
    gl.bindVertexArray(this.#vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.#program) gl.deleteProgram(this.#program);
    if (this.#vao) gl.deleteVertexArray(this.#vao);
    this.#program = undefined;
    this.#loc = undefined;
    this.#vao = null;
  }

  #compile(stage: 'vertex' | 'fragment', source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(stage === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
    if (!shader) throw new ShaderCompileError(stage, 'createShader returned null');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
      gl.deleteShader(shader);
      throw new ShaderCompileError(stage, log);
    }
    return shader;
  }

  #link(vertexSrc: string, fragmentSrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = this.#compile('vertex', vertexSrc);
    const fs = this.#compile('fragment', fragmentSrc);
    const program = gl.createProgram();
    if (!program) throw new ShaderCompileError('link', 'createProgram returned null');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'unknown error';
      gl.deleteProgram(program);
      throw new ShaderCompileError('link', log);
    }
    return program;
  }
}
