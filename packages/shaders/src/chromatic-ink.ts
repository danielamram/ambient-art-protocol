import type { ShaderManifest } from '@ambient/sdk';
import {
  CURRENT,
  FEEDBACK_DECLARATION,
  FEEDBACK_UNIFORM,
  NOISE,
  PULSES,
  STANDARD_DECLARATIONS,
  STANDARD_UNIFORM_BLOCK,
} from './lib/glsl.js';

const fragment = /* glsl */ `
${STANDARD_UNIFORM_BLOCK}
${FEEDBACK_UNIFORM}
${NOISE}
${PULSES}
${CURRENT}
uniform float u_form;
uniform vec3 u_pointer;
float field(vec2 p) {
  float t = u_time * 0.07;
  vec2 q = p * (1.1 + u_form * 0.5);
  float a = fbm(q + vec2(t, -t * 0.6));
  float b = fbm(q * 1.8 + a * 1.9 + vec2(-t * 0.7, t * 0.4));
  return fbm(q + vec2(a, b) * (2.5 + u_turbulence)) + 0.5;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  p /= min(1.0, aspect * 1.15);
  float f = field(p);
  float e = 0.004;
  vec2 grad = vec2(field(p + vec2(e,0)) - f, field(p + vec2(0,e)) - f) / e;
  vec3 n = normalize(vec3(-grad * 0.8, 1.0));
  float light = max(dot(n, normalize(vec3(-0.5, 0.8, 1.0))), 0.0);
  float rim = pow(1.0 - n.z, 3.0);
  vec2 vel = vec2(grad.y, -grad.x) * 0.012 + currentDir() * u_current.z * 0.06;
  vec2 pointer = (vec2(u_pointer.x, 1.0 - u_pointer.y) - uv) * vec2(aspect, 1.0);
  vel += pointer * exp(-dot(pointer, pointer) * 20.0) * u_pointer.z;
  float density = texture(u_prevFrame, uv - vel * u_dt / vec2(aspect,1)).a * pow(0.55, u_dt);
  if (AAP_HDR == 0) density = max(0.0, density - 0.003 * u_dt * 60.0);
  for (int i = 0; i < 8; i++) {
    vec4 pl = u_pulses[i];
    float d = pulseDist(uv, pl, aspect);
    density += pl.w * exp(-d*d*110.0) * (1.0 - smoothstep(0.0,0.8,pl.z)) * u_dt * 2.0;
  }
  density = min(density, 1.0);
  float body = smoothstep(0.29, 0.61, f) * exp(-dot(p,p) * 1.6) * (1.0 - smoothstep(0.25, 0.8, length(p)));
  float veins = pow(0.5 + 0.5 * sin(f * 55.0 + density * 3.0), 10.0);
  vec3 blue = mix(vec3(0.008,0.04,0.06), vec3(0.24,0.65,0.65), light);
  vec3 copper = mix(vec3(0.055,0.015,0.006), vec3(0.8,0.40,0.13), light);
  vec3 pearl = mix(vec3(0.025,0.016,0.07), vec3(0.55,0.48,0.78), light);
  vec3 hue = u_mood < 0.5 ? mix(blue,copper,u_mood*2.0) : mix(copper,pearl,(u_mood-0.5)*2.0);
  vec3 col = vec3(0.0015,0.0025,0.004) + hue * body * (0.4 + veins*0.55 + density*1.8);
  col += vec3(0.55,0.65,0.67) * rim * body * 0.35;
  // Density lives in alpha. Display colour never feeds back into simulation state.
  fragColor = vec4(col, density);
}
`;
export const chromaticInk: ShaderManifest = {
  id: 'chromatic-ink',
  name: 'Chromatic Ink',
  description: 'Pearlescent folds in a dark current. Touch leaves pigment in the flow.',
  fragment,
  uniforms: [...STANDARD_DECLARATIONS, FEEDBACK_DECLARATION],
  feedback: true,
  post: { bloom: 0.2, bloomThreshold: 0.55, grain: 0.07, aberration: 0.01, vignette: 0.22 },
};
