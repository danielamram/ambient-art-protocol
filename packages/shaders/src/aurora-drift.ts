import type { ShaderManifest } from '@ambient/sdk';

/**
 * Aurora Drift: domain-warped noise curtains.
 *  - u_mood       selects the palette phase (cool blues at 0, warm ambers at 1)
 *  - u_turbulence sets warp amplitude and animation speed
 *  - u_current    drifts the whole field along a direction at a velocity
 *  - u_pulses     expand as rings from their origin and fade with intensity
 */
const fragment = /* glsl */ `
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_pulse;
uniform vec4 u_pulses[8];
uniform vec3 u_current;
uniform float u_turbulence;
uniform float u_mood;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
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

vec3 palette(float t) {
  vec3 a = vec3(0.45, 0.45, 0.50);
  vec3 b = vec3(0.45, 0.40, 0.45);
  vec3 c = vec3(1.0, 1.0, 1.0);
  vec3 cool = vec3(0.60, 0.15, 0.00);
  vec3 warm = vec3(0.00, 0.10, 0.25);
  vec3 d = mix(cool, warm, u_mood);
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

  vec2 dir = u_current.xy * 2.0 - 1.0;
  float len = length(dir);
  dir = len > 0.001 ? dir / len : vec2(1.0, 0.0);
  dir.y = -dir.y;
  float speed = 0.02 + u_current.z * 0.25;
  vec2 q = p - dir * u_time * speed;

  float warp = 0.4 + u_turbulence * 2.2;
  float t = u_time * (0.03 + u_turbulence * 0.12);
  float n1 = fbm(q * 1.6 + vec2(t, -t * 0.7));
  float n2 = fbm(q * 1.6 + warp * vec2(n1, fbm(q * 1.6 + vec2(5.2, 1.3) + t)) );

  float ripple = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 pl = u_pulses[i];
    if (pl.w <= 0.0) continue;
    vec2 c = vec2(pl.x, 1.0 - pl.y);
    vec2 dv = (uv - c) * vec2(aspect, 1.0);
    float d = length(dv);
    float r = pl.z * 0.55;
    float ring = exp(-pow((d - r) * 14.0, 2.0));
    ripple += pl.w * ring;
  }

  float v = n2 * 0.9 + ripple * 0.5;
  vec3 col = palette(v + u_time * 0.006);
  col *= 0.55 + 0.6 * smoothstep(-0.4, 0.8, n1 + 0.2);
  col += ripple * vec3(0.9, 0.85, 0.7) * 0.6;
  col += u_pulse * 0.05;
  float vig = smoothstep(1.35, 0.35, length(p));
  col *= vig;
  col = pow(col, vec3(0.9));
  fragColor = vec4(col, 1.0);
}
`;

export const auroraDrift: ShaderManifest = {
  id: 'aurora-drift',
  name: 'Aurora Drift',
  description: 'Domain-warped noise curtains. Mood shifts the palette, turbulence warps the field.',
  fragment,
  uniforms: [
    { name: 'u_time', kind: 'float' },
    { name: 'u_resolution', kind: 'vec2' },
    { name: 'u_pulse', kind: 'float', default: 0 },
    { name: 'u_pulses', kind: 'vec4[8]' },
    { name: 'u_current', kind: 'vec3', default: [0.5, 0.5, 0] },
    { name: 'u_turbulence', kind: 'float', default: 0.2 },
    { name: 'u_mood', kind: 'float', default: 0.5 },
  ],
};
