import { type ShaderManifest, STANDARD_UNIFORMS } from '@ambient/sdk';
import { GestureMemory } from './gesture-memory.js';
import { type ColorFormat, pickColorFormat, RenderTarget } from './gl/targets.js';
import type { UniformState } from './mapper.js';
import { type PassId, planPasses, planTargets } from './post/plan.js';
import { DEFAULT_POST, normalizePost, type PostSettings } from './post/settings.js';
import {
  BLUR_FRAGMENT,
  BRIGHT_PASS_FRAGMENT,
  COMPOSITE_FRAGMENT,
  COPY_FRAGMENT,
  POST_RANGES,
} from './post/shaders.js';

/** Fullscreen triangle from gl_VertexID; no vertex buffers needed. */
export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export type ShaderDefines = Readonly<Record<string, string | number>>;

/**
 * Normalize a fragment shader so theme authors can omit boilerplate.
 * Adds the GLSL ES 3.00 version line, a default precision, optional `#define`s, and
 * `out vec4 fragColor` when absent.
 */
export function assembleFragment(source: string, defines?: ShaderDefines): string {
  let body = source.trimStart();
  let version = '#version 300 es\n';
  if (body.startsWith('#version')) {
    const nl = body.indexOf('\n');
    version = `${body.slice(0, nl)}\n`;
    body = body.slice(nl + 1);
  }
  const precision = /precision\s+\w+\s+float\s*;/.test(body) ? '' : 'precision highp float;\n';
  const defs = defines
    ? Object.entries(defines)
        .map(([k, v]) => `#define ${k} ${v}\n`)
        .join('')
    : '';
  const out = /\bout\s+vec4\s+\w+\s*;/.test(body) ? '' : 'out vec4 fragColor;\n';
  return `${version}${precision}${defs}${out}${body}`;
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

export type ShaderQuality = 0 | 1;

export interface CanvasRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly manifest: ShaderManifest;
  /** Cap on devicePixelRatio. Default 2. */
  readonly maxPixelRatio?: number;
  readonly contextAttributes?: WebGLContextAttributes;
  /** Scene resolution as a fraction of the canvas. Default 1. */
  readonly renderScale?: number;
  /** Host overrides layered on top of the theme's post hints. */
  readonly post?: Partial<PostSettings>;
  /** Value of the `AAP_QUALITY` define. Default 1 (full). */
  readonly shaderQuality?: ShaderQuality;
}

type Locations = Record<string, WebGLUniformLocation | null>;

interface Pass {
  readonly program: WebGLProgram;
  readonly loc: Locations;
}

// Renderer-local art state; the public signal protocol remains unchanged.
const SCENE_UNIFORMS = [...STANDARD_UNIFORMS, 'u_gesture'] as const;

const POST_UNIFORMS = [
  'u_scene',
  'u_bloom',
  'u_src',
  'u_resolution',
  'u_time',
  'u_energy',
  'u_threshold',
  'u_knee',
  'u_direction',
  'u_bloomStrength',
  'u_aberration',
  'u_grain',
  'u_vignette',
] as const;

/**
 * Raw WebGL2 renderer with a small TouchDesigner-style post stack.
 *
 * Each frame: the theme draws into an offscreen scene target (a ping-pong pair, so feedback
 * themes can read last frame through `u_prevFrame`), highlights are extracted and blurred at a
 * quarter of the scene size, and a composite pass adds bloom, chromatic aberration, vignette,
 * ACES tonemapping, grain and dither while writing to the canvas. No Three.js, no vertex
 * buffers: every pass is the same synthesized fullscreen triangle.
 */
export class CanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly maxPixelRatio: number;
  #program: WebGLProgram | undefined;
  #vao: WebGLVertexArrayObject | null = null;
  #loc: Locations = {};
  #manifest: ShaderManifest;
  #format: ColorFormat;
  #maxTextureSize: number;
  #scene: [RenderTarget, RenderTarget] | undefined;
  #read = 0;
  #bloom: [RenderTarget, RenderTarget] | undefined;
  #targetsKey = '';
  #post: Record<'bright' | 'blur' | 'composite' | 'copy', Pass> | undefined;
  #settings: PostSettings = DEFAULT_POST;
  #override: Partial<PostSettings>;
  #renderScale: number;
  #shaderQuality: ShaderQuality;
  #lost = false;
  #geometry: Pass | undefined;
  #form = 0.45;
  #gesture = new GestureMemory();
  #pointer: readonly [number, number, number] = [0.5, 0.5, 0];
  #display: RenderTarget | undefined;
  #outgoing: RenderTarget | undefined;
  #present: Pass | undefined;
  #transition = 2;
  #hasFrame = false;
  readonly #onLost = (e: Event): void => {
    e.preventDefault();
    this.#lost = true;
  };
  readonly #onRestored = (): void => {
    this.#rebuild();
  };

  constructor(options: CanvasRendererOptions) {
    this.canvas = options.canvas;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      ...options.contextAttributes,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.#manifest = options.manifest;
    this.#override = { ...options.post };
    this.#renderScale = options.renderScale ?? 1;
    this.#shaderQuality = options.shaderQuality ?? 1;
    this.#format = pickColorFormat(gl);
    this.#maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
    this.canvas.addEventListener('webglcontextlost', this.#onLost);
    this.canvas.addEventListener('webglcontextrestored', this.#onRestored);
    this.#initGl();
    this.setShader(options.manifest);
    this.resize();
  }

  get manifest(): ShaderManifest {
    return this.#manifest;
  }

  /** True when the scene target is half-float and can hold values above 1.0. */
  get hdr(): boolean {
    return this.#format.hdr;
  }

  get post(): PostSettings {
    return this.#settings;
  }

  get renderScale(): number {
    return this.#renderScale;
  }

  get shaderQuality(): ShaderQuality {
    return this.#shaderQuality;
  }

  /** True after the browser took the context away. `render` is a no-op until it comes back. */
  get contextLost(): boolean {
    return this.#lost;
  }

  /** Compile and switch to a new theme. On failure the previous program stays active. */
  setShader(manifest: ShaderManifest, preserveHistory = false): void {
    const gl = this.gl;
    const program = this.#link(VERTEX_SHADER, assembleFragment(manifest.fragment, this.#defines()));
    let geometry: Pass | undefined;
    try {
      if (manifest.geometry) {
        const src = manifest.geometry.vertex.replace(
          '#version 300 es',
          `#version 300 es\n#define AAP_QUALITY ${this.#shaderQuality}`,
        );
        const gp = this.#link(src, assembleFragment(manifest.geometry.fragment, this.#defines()));
        geometry = { program: gp, loc: this.#locations(gp, SCENE_UNIFORMS) };
      }
    } catch (error) {
      gl.deleteProgram(program);
      throw error;
    }
    if (!preserveHistory && this.#hasFrame && this.#display && this.#outgoing) {
      // Freeze the displayed composition; only the incoming scene runs during a dissolve.
      this.#blit(this.#display, this.#outgoing);
      this.#transition = 0;
    }
    if (this.#program) gl.deleteProgram(this.#program);
    if (this.#geometry) gl.deleteProgram(this.#geometry.program);
    this.#geometry = geometry;
    this.#program = program;
    this.#manifest = manifest;
    if (!preserveHistory) this.#gesture.reset();
    gl.useProgram(program);
    this.#loc = this.#locations(program, SCENE_UNIFORMS);
    const prev = this.#loc.u_prevFrame;
    if (prev) gl.uniform1i(prev, 0);
    // A new theme must not inherit the old one's last frame as a bright flash.
    if (!preserveHistory && this.#scene) for (const t of this.#scene) t.clear();
    this.#settings = normalizePost(manifest.post, this.#override, { hdr: this.#format.hdr });
  }

  /** Layer host overrides on the theme's post hints. Pass `{}` to keep the current overrides. */
  setPost(patch: Partial<PostSettings>): PostSettings {
    this.#override = { ...this.#override, ...patch };
    this.#settings = normalizePost(this.#manifest.post, this.#override, {
      hdr: this.#format.hdr,
    });
    return this.#settings;
  }

  /** Drop a host override so the theme hint (or default) applies again. */
  clearPost(...keys: (keyof PostSettings)[]): PostSettings {
    const next: Partial<PostSettings> = { ...this.#override };
    for (const k of keys) delete next[k];
    this.#override = next;
    return this.setPost({});
  }

  /** Scene resolution as a fraction of the canvas, clamped to [0.25, 1]. Targets rebuild lazily. */
  setRenderScale(scale: number): void {
    const s = Number.isFinite(scale) ? Math.min(1, Math.max(0.25, scale)) : 1;
    this.#renderScale = s;
  }

  /** Recompile the theme with a different `AAP_QUALITY` define. */
  setShaderQuality(q: ShaderQuality): void {
    if (q === this.#shaderQuality) return;
    const previous = this.#shaderQuality;
    this.#shaderQuality = q;
    try {
      this.setShader(this.#manifest, true);
    } catch (error) {
      this.#shaderQuality = previous;
      throw error;
    }
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
    return [w, h];
  }

  get transitioning(): boolean {
    return this.#transition < 1.6;
  }

  setArt(form: number, pointer: readonly [number, number, number]): void {
    this.#form = Math.max(0, Math.min(1, form));
    this.#pointer = pointer;
  }

  render(state: UniformState, wallDt = state.u_dt): void {
    if (this.#lost || !this.#program || !this.#post) return;
    const gl = this.gl;
    this.#ensureTargets();
    const scene = this.#scene;
    const bloom = this.#bloom;
    if (!scene || !bloom) return;
    this.#gesture.advance(this.#pointer, state.u_dt);
    const passes = planPasses(this.#settings);
    gl.bindVertexArray(this.#vao);
    for (const pass of passes) this.#draw(pass, state, scene, bloom);
    this.#transition = Math.min(2, this.#transition + Math.max(0, wallDt));
    const display = this.#display;
    const outgoing = this.#outgoing;
    const present = this.#present;
    if (display && outgoing && present) {
      this.#target(null, this.canvas.width, this.canvas.height);
      gl.useProgram(present.program);
      this.#bindTexture(0, display.texture);
      this.#bindTexture(1, outgoing.texture);
      gl.uniform2f(present.loc.u_resolution ?? null, this.canvas.width, this.canvas.height);
      gl.uniform1f(present.loc.u_mix ?? null, Math.min(1, this.#transition / 1.6));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this.#hasFrame = true;
  }

  dispose(): void {
    const gl = this.gl;
    this.canvas.removeEventListener('webglcontextlost', this.#onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.#onRestored);
    this.#releaseTargets();
    if (this.#program) gl.deleteProgram(this.#program);
    if (this.#post) for (const p of Object.values(this.#post)) gl.deleteProgram(p.program);
    if (this.#geometry) gl.deleteProgram(this.#geometry.program);
    if (this.#present) gl.deleteProgram(this.#present.program);
    this.#geometry = undefined;
    this.#present = undefined;
    if (this.#vao) gl.deleteVertexArray(this.#vao);
    this.#program = undefined;
    this.#post = undefined;
    this.#loc = {};
    this.#vao = null;
  }

  #defines(): ShaderDefines {
    return { AAP_QUALITY: this.#shaderQuality, AAP_HDR: this.#format.hdr ? 1 : 0 };
  }

  #initGl(): void {
    const gl = this.gl;
    this.#vao = gl.createVertexArray();
    gl.bindVertexArray(this.#vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    const make = (src: string, textures: Record<string, number>): Pass => {
      const program = this.#link(VERTEX_SHADER, assembleFragment(src));
      const loc = this.#locations(program, POST_UNIFORMS);
      gl.useProgram(program);
      for (const [name, unit] of Object.entries(textures)) {
        const l = loc[name];
        if (l) gl.uniform1i(l, unit);
      }
      return { program, loc };
    };
    const presentProgram = this.#link(
      VERTEX_SHADER,
      assembleFragment(`
      uniform sampler2D u_scene;
      uniform sampler2D u_old;
      uniform vec2 u_resolution;
      uniform float u_mix;
      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution;
        float t = smoothstep(0.0, 1.0, u_mix);
        fragColor = vec4(mix(texture(u_old, uv).rgb, texture(u_scene, uv).rgb, t), 1.0);
      }
    `),
    );
    this.#present = {
      program: presentProgram,
      loc: this.#locations(presentProgram, ['u_scene', 'u_old', 'u_resolution', 'u_mix']),
    };
    gl.useProgram(presentProgram);
    gl.uniform1i(this.#present.loc.u_scene ?? null, 0);
    gl.uniform1i(this.#present.loc.u_old ?? null, 1);
    this.#post = {
      bright: make(BRIGHT_PASS_FRAGMENT, { u_scene: 0 }),
      blur: make(BLUR_FRAGMENT, { u_src: 0 }),
      composite: make(COMPOSITE_FRAGMENT, { u_scene: 0, u_bloom: 1 }),
      copy: make(COPY_FRAGMENT, { u_scene: 0 }),
    };
  }

  /** After a context restore every GL object is gone; recreate the lot. */
  #rebuild(): void {
    const gl = this.gl;
    this.#lost = false;
    this.#scene = undefined;
    this.#bloom = undefined;
    this.#display = undefined;
    this.#outgoing = undefined;
    this.#geometry = undefined;
    this.#hasFrame = false;
    this.#transition = 2;
    this.#targetsKey = '';
    this.#program = undefined;
    this.#post = undefined;
    this.#format = pickColorFormat(gl);
    this.#maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
    this.#initGl();
    this.setShader(this.#manifest);
  }

  #locations(program: WebGLProgram, names: readonly string[]): Locations {
    const loc: Locations = {};
    for (const n of names) loc[n] = this.gl.getUniformLocation(program, n);
    return loc;
  }

  #ensureTargets(): void {
    const plan = planTargets({
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      renderScale: this.#renderScale,
      maxTextureSize: this.#maxTextureSize,
    });
    const key = `${plan.scene[0]}x${plan.scene[1]}|${plan.bloom[0]}x${plan.bloom[1]}|${this.#format.hdr}|${this.canvas.width}x${this.canvas.height}`;
    if (key === this.#targetsKey && this.#scene && this.#bloom) return;
    const oldScene = this.#scene;
    const oldBloom = this.#bloom;
    const oldDisplay = this.#display;
    const oldOutgoing = this.#outgoing;
    const gl = this.gl;
    const mk = (w: number, h: number) => new RenderTarget(gl, w, h, this.#format);
    let scene: [RenderTarget, RenderTarget] = [
      mk(plan.scene[0], plan.scene[1]),
      mk(plan.scene[0], plan.scene[1]),
    ];
    if (!scene[0].complete || !scene[1].complete) {
      // The probe passed but a full-size target did not; drop to 8-bit and try once more.
      for (const t of scene) t.dispose();
      this.#format = {
        internalFormat: gl.RGBA8,
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
        hdr: false,
      };
      scene = [mk(plan.scene[0], plan.scene[1]), mk(plan.scene[0], plan.scene[1])];
      this.#settings = normalizePost(this.#manifest.post, this.#override, { hdr: false });
    }
    if (oldScene) {
      this.#blit(oldScene[this.#read] as RenderTarget, scene[0]);
      this.#blit(oldScene[this.#read] as RenderTarget, scene[1]);
      for (const target of oldScene) target.dispose();
    }
    if (oldBloom) for (const target of oldBloom) target.dispose();
    const displayFormat: ColorFormat = {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      hdr: false,
    };
    this.#display = new RenderTarget(gl, this.canvas.width, this.canvas.height, displayFormat);
    this.#outgoing = new RenderTarget(gl, this.canvas.width, this.canvas.height, displayFormat);
    if (oldDisplay) {
      this.#blit(oldDisplay, this.#display);
      oldDisplay.dispose();
    }
    if (oldOutgoing) {
      this.#blit(oldOutgoing, this.#outgoing);
      oldOutgoing.dispose();
    }
    this.#scene = scene;
    this.#bloom = [mk(plan.bloom[0], plan.bloom[1]), mk(plan.bloom[0], plan.bloom[1])];
    this.#read = 0;
    this.#targetsKey = key;
  }

  #blit(from: RenderTarget, to: RenderTarget): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to.fbo);
    gl.blitFramebuffer(
      0,
      0,
      from.width,
      from.height,
      0,
      0,
      to.width,
      to.height,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  #releaseTargets(): void {
    if (this.#scene) for (const t of this.#scene) t.dispose();
    if (this.#bloom) for (const t of this.#bloom) t.dispose();
    this.#display?.dispose();
    this.#outgoing?.dispose();
    this.#display = undefined;
    this.#outgoing = undefined;
    this.#scene = undefined;
    this.#bloom = undefined;
    this.#display = undefined;
    this.#outgoing = undefined;
    this.#geometry = undefined;
    this.#hasFrame = false;
    this.#transition = 2;
    this.#targetsKey = '';
  }

  #bindTexture(unit: number, texture: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  #target(fbo: WebGLFramebuffer | null, w: number, h: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
  }

  #draw(
    pass: PassId,
    state: UniformState,
    scene: [RenderTarget, RenderTarget],
    bloom: [RenderTarget, RenderTarget],
  ): void {
    const gl = this.gl;
    const post = this.#post;
    const program = this.#program;
    if (!post || !program) return;
    const s = this.#settings;
    switch (pass) {
      case 'scene': {
        const write = scene[1 - this.#read] as RenderTarget;
        const read = scene[this.#read] as RenderTarget;
        this.#target(write.fbo, write.width, write.height);
        gl.useProgram(program);
        this.#setSceneUniforms(state, write.width, write.height);
        this.#bindTexture(0, read.texture);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const geo = this.#geometry;
        const definition = this.#manifest.geometry;
        if (geo && definition) {
          gl.useProgram(geo.program);
          this.#setSceneUniforms(state, write.width, write.height, geo.loc);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.drawArraysInstanced(
            gl.TRIANGLES,
            0,
            6,
            this.#shaderQuality > 0 ? definition.instances : definition.lowInstances,
          );
          gl.disable(gl.BLEND);
        }
        this.#read = 1 - this.#read;
        break;
      }
      case 'bright': {
        const src = scene[this.#read] as RenderTarget;
        const dst = bloom[0];
        this.#target(dst.fbo, dst.width, dst.height);
        gl.useProgram(post.bright.program);
        const l = post.bright.loc;
        if (l.u_resolution) gl.uniform2f(l.u_resolution, dst.width, dst.height);
        if (l.u_threshold)
          gl.uniform1f(l.u_threshold, s.bloomThreshold * (this.#format.hdr ? 1.6 : 1));
        if (l.u_knee) gl.uniform1f(l.u_knee, POST_RANGES.knee);
        this.#bindTexture(0, src.texture);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        break;
      }
      case 'blurH':
      case 'blurV': {
        const horizontal = pass === 'blurH';
        const src = horizontal ? bloom[0] : bloom[1];
        const dst = horizontal ? bloom[1] : bloom[0];
        this.#target(dst.fbo, dst.width, dst.height);
        gl.useProgram(post.blur.program);
        const l = post.blur.loc;
        if (l.u_resolution) gl.uniform2f(l.u_resolution, dst.width, dst.height);
        if (l.u_direction) gl.uniform2f(l.u_direction, horizontal ? 1 : 0, horizontal ? 0 : 1);
        this.#bindTexture(0, src.texture);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        break;
      }
      case 'composite': {
        const src = scene[this.#read] as RenderTarget;
        this.#target(this.#display?.fbo ?? null, this.canvas.width, this.canvas.height);
        const p = s.enabled ? post.composite : post.copy;
        gl.useProgram(p.program);
        const l = p.loc;
        if (l.u_resolution) gl.uniform2f(l.u_resolution, this.canvas.width, this.canvas.height);
        if (l.u_time) gl.uniform1f(l.u_time, state.u_time);
        if (l.u_energy) gl.uniform1f(l.u_energy, state.u_energy);
        if (l.u_bloomStrength) {
          gl.uniform1f(l.u_bloomStrength, s.bloom > 0 ? s.bloom * POST_RANGES.bloomStrength : 0);
        }
        if (l.u_aberration) gl.uniform1f(l.u_aberration, s.aberration);
        if (l.u_grain) gl.uniform1f(l.u_grain, s.grain * POST_RANGES.grain);
        if (l.u_vignette) gl.uniform1f(l.u_vignette, s.vignette);
        this.#bindTexture(0, src.texture);
        this.#bindTexture(1, bloom[0].texture);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        break;
      }
    }
  }

  #setSceneUniforms(state: UniformState, width: number, height: number, loc = this.#loc): void {
    const gl = this.gl;
    if (loc.u_form) gl.uniform1f(loc.u_form, this.#form);
    if (loc.u_pointer) gl.uniform3f(loc.u_pointer, ...this.#pointer);
    if (loc.u_gesture) gl.uniform4fv(loc.u_gesture, this.#gesture.uniform);
    if (loc.u_time) gl.uniform1f(loc.u_time, state.u_time);
    if (loc.u_resolution) gl.uniform2f(loc.u_resolution, width, height);
    if (loc.u_pulse) gl.uniform1f(loc.u_pulse, state.u_pulse);
    if (loc.u_pulses) gl.uniform4fv(loc.u_pulses, state.u_pulses);
    if (loc.u_current) {
      gl.uniform3f(loc.u_current, state.u_current[0], state.u_current[1], state.u_current[2]);
    }
    if (loc.u_turbulence) gl.uniform1f(loc.u_turbulence, state.u_turbulence);
    if (loc.u_mood) gl.uniform1f(loc.u_mood, state.u_mood);
    if (loc.u_energy) gl.uniform1f(loc.u_energy, state.u_energy);
    if (loc.u_dt) gl.uniform1f(loc.u_dt, state.u_dt);
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
    let fs: WebGLShader;
    try {
      fs = this.#compile('fragment', fragmentSrc);
    } catch (error) {
      gl.deleteShader(vs);
      throw error;
    }
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
