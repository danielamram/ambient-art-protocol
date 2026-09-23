import type { GeometryPass, ShaderManifest } from '@ambient/sdk';
import { STANDARD_DECLARATIONS, STANDARD_UNIFORM_BLOCK } from './lib/glsl.js';

// A small, explicit geometry pass extends the existing fragment theme contract. Each
// instance is a ribbon segment, not a CPU object. Both ends follow the same analytic
// trajectory, so seeking and quality changes never reset a simulation or tear a strand.
const vertex = (silk: boolean): string => `#version 300 es
precision highp float;
#define SILK ${silk ? 1 : 0}
${STANDARD_UNIFORM_BLOCK}
uniform float u_form;
uniform vec3 u_pointer;
uniform vec4 u_gesture;
out vec2 v_edge;
out vec3 v_color;
out float v_alpha;
const float TAU = 6.283185307;
const int SEGMENTS = 320;
const int STRANDS = AAP_QUALITY > 0 ? 180 : 60;

mat2 rotate(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
vec3 curve(float u, float s) {
  float t = u_time * 0.13;
  float a = u * TAU;
  float b = s * TAU;
  float breathe = sin(t * 0.37) * 0.5 + 0.5;
  vec3 p;
#if SILK == 1
  float x = (u - 0.5) * 5.5;
  float z = (s - 0.5) * 2.9;
  float y = sin(x * 1.1 + t) * cos(z * 1.2 - t * 0.47) * (0.6 + u_form);
  y += sin(x * 2.1 - z * 1.3 + t * 0.7) * 0.19;
  p = vec3(x, y, z);
  p.xz *= rotate(-0.18);
#else
  // Three continuous rhythms separate silhouette, folding, and strand motion.
  // All loops close at u=0/1; no fractional angular winding can tear the seam.
  float opening = 0.5 + 0.5 * sin(u_time * 0.075 - 0.7);
  float fold = 0.5 + 0.5 * sin(u_time * 0.047 + 1.2);
  float twist = b + 3.0 * a + t * 0.45 + sin(a * 2.0 - t) * fold * 0.8;
  float tube = mix(0.24, 0.58, fold) + 0.15 * u_form;
  tube *= 0.85 + 0.15 * sin(a * 3.0 - t);
  float radius = mix(0.98, 1.58, opening) + tube * cos(twist);
  radius += 0.18 * fold * cos(a * 3.0 + t * 0.3);
  p = vec3(radius * cos(a), radius * sin(a), tube * sin(twist));
  p.z += (0.20 + u_form * 0.42 + fold * 0.26) * sin(a * 2.0 + t * 0.5);
  p.y *= mix(0.78, 1.08, opening);
  p.x += 0.12 * sin(a * 3.0 + t * 0.4);
  p.xy *= rotate(0.20 + sin(t * 0.29) * 0.25);
  p.yz *= rotate(0.35 + sin(t * 0.21) * 0.48);

#endif
  // Small-scale deformation stays subordinate to the silhouette.
  p += 0.045 * u_turbulence * vec3(sin(b * 7.0 + a * 5.0 + t), cos(a * 8.0 - t), sin(b * 3.0 - t));
  p.xz *= rotate((u_current.x - 0.5) * 0.45);
  return p;
}
vec3 project(vec3 p) {
  float aspect = u_resolution.x / u_resolution.y;
  float fit = min(1.0, aspect * 0.86);
  float depth = 6.5 - p.z;
  vec2 xy = p.xy * (1.35 / depth) * fit;
  // Pointer coordinates are screen-space: localized attraction stays under the finger.
  vec2 pointer = (u_pointer.xy - 0.5) * vec2(aspect, -1.0);
  vec2 delta = pointer - xy;
  xy += delta * exp(-dot(delta, delta) * 13.0) * u_pointer.z * 0.36;
#if SILK == 0
  vec2 wake = (u_gesture.xy - 0.5) * vec2(aspect, -1.0);
  vec2 distanceToWake = xy - wake;
  float influence = exp(-dot(distanceToWake, distanceToWake) * 10.0);
  vec2 wakeOffset = u_gesture.zw * vec2(aspect, -1.0) * influence * 0.65;
  // Smoothly compress the wake near the frame instead of clipping whole strands.
  vec2 margin = max(vec2(0.0), vec2(aspect, 1.0) * 0.46 - abs(xy));
  xy += wakeOffset * margin / (margin + abs(wakeOffset) + vec2(0.00001));
#endif
  for (int i = 0; i < 8; i++) {
    vec4 pulse = u_pulses[i];
    vec2 c = (pulse.xy - 0.5) * vec2(aspect, -1.0);
    vec2 d = xy - c;
    float len = length(d);
    float wave = exp(-pow((len - pulse.z * 0.28) * 15.0, 2.0));
    xy += d / max(len, 0.02) * wave * pulse.w * 0.065;
  }
  return vec3(xy * vec2(2.0 / aspect, 2.0), p.z);
}
void main() {
  int strand = gl_InstanceID / SEGMENTS;
  int segment = gl_InstanceID % SEGMENTS;
  float s = (float(strand) + 0.5) / float(STRANDS);
  float u = float(segment) / float(SEGMENTS);
  vec3 p0 = project(curve(u, s));
  vec3 p1 = project(curve(u + 1.0 / float(SEGMENTS), s));
  vec2 corners[6] = vec2[6](vec2(0,-1), vec2(1,-1), vec2(0,1), vec2(0,1), vec2(1,-1), vec2(1,1));
  vec2 c = corners[gl_VertexID];
  vec2 tangent = (p1.xy - p0.xy) * u_resolution;
  vec2 normal = normalize(vec2(-tangent.y, tangent.x) + vec2(0.00001));
  float width = max(0.7, u_resolution.y / 1000.0) * (0.85 + 0.4 * hash(float(strand)));
  vec2 pos = mix(p0.xy, p1.xy, c.x) + normal * c.y * width * 2.0 / u_resolution;
  gl_Position = vec4(pos, 0.0, 1.0);
  v_edge = c;
  float light = smoothstep(-0.9, 0.9, mix(p0.z, p1.z, c.x));
  float flowing = pow(0.5 + 0.5 * sin(u * TAU * 3.0 - u_time * 0.5 + s * 6.0), 14.0);
  vec3 cold = mix(vec3(0.10,0.34,0.40), vec3(0.46,0.85,0.78), light);
  vec3 warm = mix(vec3(0.36,0.12,0.045), vec3(1.0,0.61,0.25), light);
  vec3 violet = mix(vec3(0.18,0.11,0.39), vec3(0.75,0.56,0.95), light);
  vec3 hue = u_mood < 0.5 ? mix(cold, warm, u_mood * 2.0) : mix(warm, violet, (u_mood - 0.5) * 2.0);
#if SILK == 1
  hue = mix(hue, vec3(0.65,0.75,0.83), 0.55);
#endif
  v_color = hue * (0.36 + light * 0.5 + flowing * 0.65 + u_energy * 0.25);
  v_alpha = (0.15 + light * 0.30) * (AAP_QUALITY > 0 ? 1.0 : 1.6);
#if SILK == 0
  // Sparse moving highlights and dim rear strands preserve hue at overlaps.
  float front = smoothstep(-1.1, 1.2, mix(p0.z, p1.z, c.x));
  float band = 0.5 + 0.5 * sin(s * TAU * 5.0 + u_time * 0.08);
  float glint = flowing * pow(band, 8.0);
  vec3 shadow = u_mood < 0.5
    ? mix(vec3(0.015,0.10,0.17), vec3(0.18,0.025,0.009), u_mood * 2.0)
    : mix(vec3(0.18,0.025,0.009), vec3(0.055,0.018,0.19), (u_mood - 0.5) * 2.0);
  v_color = mix(shadow, hue, 0.22 + front * 0.65);
  v_color *= 0.40 + front * 0.55 + glint * 0.7 + u_energy * 0.12;
  v_alpha = (0.045 + front * 0.19) * (0.55 + band * 0.45)
    * (AAP_QUALITY > 0 ? 1.0 : 2.3);
#endif
}
`;

const ribbonFragment = /* glsl */ `
in vec2 v_edge;
in vec3 v_color;
in float v_alpha;
void main() {
  float edge = 1.0 - smoothstep(0.25, 1.0, abs(v_edge.y));
  fragColor = vec4(v_color * edge * v_alpha, 1.0);
}
`;

const background = /* glsl */ `
${STANDARD_UNIFORM_BLOCK}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float halo = exp(-dot(p, p) * 3.8);
  vec3 col = mix(vec3(0.001,0.002,0.005), vec3(0.007,0.018,0.023), halo);
  fragColor = vec4(col, 1.0);
}
`;
const geometry = (silk: boolean): GeometryPass => ({
  vertex: vertex(silk),
  fragment: ribbonFragment,
  instances: 180 * 320,
  lowInstances: 60 * 320,
});
export const livingFilaments: ShaderManifest = {
  id: 'living-filaments',
  name: 'Living Filaments',
  description: 'A suspended organism woven from light. Hold to gather; release to resonate.',
  fragment: background,
  uniforms: STANDARD_DECLARATIONS,
  geometry: geometry(false),
  post: { bloom: 0.22, bloomThreshold: 0.52, grain: 0.06, aberration: 0.015, vignette: 0.2 },
};
export const resonantSilk: ShaderManifest = {
  id: 'resonant-silk',
  name: 'Resonant Silk',
  description: 'An interference landscape. Fine threads fold into a standing wave.',
  fragment: background,
  uniforms: STANDARD_DECLARATIONS,
  geometry: geometry(true),
  post: { bloom: 0.23, bloomThreshold: 0.52, grain: 0.05, aberration: 0, vignette: 0.18 },
};
