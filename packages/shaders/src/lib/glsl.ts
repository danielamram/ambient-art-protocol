/**
 * Shared GLSL chunks. Themes concatenate these into their fragment source; there is no
 * `#include`, so keep each chunk self-contained and free of `main`.
 */

/** hash2 / hash1 / gradient noise / fbm / 3D value noise / curl of noise. */
export const NOISE = /* glsl */ `
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float hash1(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
        dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = rot * p * 2.0 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i + vec3(0, 0, 0)), hash3(i + vec3(1, 0, 0)), f.x),
        mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
        mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

/** Divergence-free 2D flow: the curl of a noise potential. */
vec2 curl(vec2 p) {
  float e = 0.02;
  float dy = noise(p + vec2(0.0, e)) - noise(p - vec2(0.0, e));
  float dx = noise(p + vec2(e, 0.0)) - noise(p - vec2(e, 0.0));
  return vec2(dy, -dx) / (2.0 * e);
}
`;

/**
 * Cosine palette parameterized by `u_mood` through three anchors: cold (cyan, blue, violet) at
 * 0, synthwave (teal, magenta) at 0.5, hot (orange, red, magenta) at 1. Parameters are mixed
 * piecewise so no mood value collapses to grey. `t` walks around the palette.
 */
export const PALETTE = /* glsl */ `
vec3 palette(float t) {
  vec3 a0 = vec3(0.15, 0.45, 0.70), b0 = vec3(0.20, 0.45, 0.30), d0 = vec3(0.50, 0.20, 0.00);
  vec3 a1 = vec3(0.45, 0.45, 0.65), b1 = vec3(0.50, 0.45, 0.30), d1 = vec3(0.55, 0.05, 0.30);
  vec3 a2 = vec3(0.85, 0.40, 0.30), b2 = vec3(0.15, 0.45, 0.35), d2 = vec3(0.00, 0.25, 0.55);
  float m = clamp(u_mood, 0.0, 1.0) * 2.0;
  vec3 a = m < 1.0 ? mix(a0, a1, m) : mix(a1, a2, m - 1.0);
  vec3 b = m < 1.0 ? mix(b0, b1, m) : mix(b1, b2, m - 1.0);
  vec3 d = m < 1.0 ? mix(d0, d1, m) : mix(d1, d2, m - 1.0);
  return a + b * cos(6.28318 * (t + d));
}
`;

/** Aspect-correct distance from a bottom-left-origin uv to a top-left-origin pulse. */
export const PULSES = /* glsl */ `
float pulseDist(vec2 uv, vec4 pl, float aspect) {
  vec2 c = vec2(pl.x, 1.0 - pl.y);
  return length((uv - c) * vec2(aspect, 1.0));
}
`;

/** Turns `u_current` into a unit direction (screen space, y up) and a speed. */
export const CURRENT = /* glsl */ `
vec2 currentDir() {
  vec2 dir = u_current.xy * 2.0 - 1.0;
  float len = length(dir);
  dir = len > 0.001 ? dir / len : vec2(1.0, 0.0);
  dir.y = -dir.y;
  return dir;
}
`;

/** Standard uniform block every theme declares. */
export const STANDARD_UNIFORM_BLOCK = /* glsl */ `
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_pulse;
uniform vec4 u_pulses[8];
uniform vec3 u_current;
uniform float u_turbulence;
uniform float u_mood;
uniform float u_energy;
uniform float u_dt;
`;

export const FEEDBACK_UNIFORM = /* glsl */ `
uniform sampler2D u_prevFrame;
`;

/** Manifest entries matching STANDARD_UNIFORM_BLOCK. */
export const STANDARD_DECLARATIONS = [
  { name: 'u_time', kind: 'float' },
  { name: 'u_resolution', kind: 'vec2' },
  { name: 'u_pulse', kind: 'float', default: 0 },
  { name: 'u_pulses', kind: 'vec4[8]' },
  { name: 'u_current', kind: 'vec3', default: [0.5, 0.5, 0] },
  { name: 'u_turbulence', kind: 'float', default: 0.2 },
  { name: 'u_mood', kind: 'float', default: 0.5 },
  { name: 'u_energy', kind: 'float', default: 0 },
  { name: 'u_dt', kind: 'float', default: 0 },
] as const;

export const FEEDBACK_DECLARATION = { name: 'u_prevFrame', kind: 'sampler2D' } as const;
