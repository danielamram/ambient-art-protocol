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
uniform vec4 u_gesture;
uniform vec4 u_stroke;
// Broad, deliberately band-limited folds rather than five-octave micro-ridges.
float broadNoise(vec2 p) {
  return noise(p) * 0.65 + noise(p * 1.93 + 4.7) * 0.25
    + noise(p * 3.71 - 2.1) * 0.10;
}
float field(vec2 p) {
  float t = u_time * 0.045;
  vec2 q = p * (1.5 + u_form * 0.7);
  vec2 warp = vec2(broadNoise(q + vec2(t, -t * 0.4)),
                   broadNoise(q + vec2(4.1 - t * 0.3, 2.7)));
  return 0.5 + broadNoise(q + warp * (1.5 + u_turbulence * 0.5));
}
float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 d = b - a;
  float h = clamp(dot(p-a,d) / max(dot(d,d),0.000001),0.0,1.0);
  return length(p-a-d*h);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 metric = vec2(aspect, 1.0);
  float fit = min(1.0, aspect * 1.15);
  vec2 p = (uv - 0.5) * metric / fit;
  float f = field(p);
  float e = 0.008;
  vec2 grad = vec2(field(p + vec2(e,0)) - f, field(p + vec2(0,e)) - f) / e;
  vec2 pointer = vec2(u_pointer.x, 1.0 - u_pointer.y);
  vec2 delta = (uv - pointer) * metric;
  float reach = exp(-dot(delta,delta) / (0.04 * fit * fit));
  vec2 wakeCenter = vec2(u_gesture.x, 1.0 - u_gesture.y);
  vec2 wakeDelta = (uv-wakeCenter)*metric;
  vec2 momentum = u_gesture.zw * vec2(aspect,-1.0);
  vec2 vel = vec2(grad.y,-grad.x) * 0.018 * fit;
  vel += currentDir() * u_current.z * 0.045;
  vel += vec2(-delta.y,delta.x) * reach * u_pointer.z * 0.9;
  vel += momentum * exp(-dot(wakeDelta,wakeDelta)/(0.06*fit*fit)) * 1.5;
  // Bounded backward advection. Ink leaving the canvas is absorbed, never wrapped.
  vel /= 1.0 + length(vel) / 0.18;
  float dt = clamp(u_dt,0.0,0.1);
  vec2 from = uv - vel * dt / metric;
  float inside = step(0.0,from.x)*step(from.x,1.0)*step(0.0,from.y)*step(from.y,1.0);
  float density = texture(u_prevFrame,from).a * inside * pow(0.8, u_dt);
  if (AAP_HDR == 0) density = max(0.0,density-(0.6/255.0)*dt*60.0);
  vec2 a = vec2(u_stroke.x,1.0-u_stroke.y)*metric;
  vec2 b = vec2(u_stroke.z,1.0-u_stroke.w)*metric;
  float brushDistance = segmentDistance(uv*metric,a,b);
  float brush = exp(-pow(brushDistance / (0.045*fit),2.0));
  // Exponential deposition remains bounded even on a stationary long press.
  density = mix(density,1.0,1.0-exp(-brush*u_pointer.z*4.5*dt));
  for (int i=0;i<8;i++) {
    vec4 pl=u_pulses[i];
    float d=pulseDist(uv,pl,aspect)/fit;
    float deposit=pl.w*exp(-d*d*85.0)*(1.0-smoothstep(0.0,0.8,pl.z));
    density=mix(density,1.0,1.0-exp(-deposit*3.0*dt));
  }
  density=clamp(density,0.0,1.0);
  // Pigment bends the apparent surface. These are shading normals, not a fluid solver.
  vec2 texel=1.0/u_resolution;
  vec2 pigmentSlope=vec2(
    texture(u_prevFrame,uv+vec2(texel.x,0)).a-texture(u_prevFrame,uv-vec2(texel.x,0)).a,
    texture(u_prevFrame,uv+vec2(0,texel.y)).a-texture(u_prevFrame,uv-vec2(0,texel.y)).a);
  vec3 n=normalize(vec3(-grad*0.65-pigmentSlope*5.0,1.0));
  vec3 lightDir=normalize(vec3(-0.45,0.65,1.2));
  float light=max(dot(n,lightDir),0.0);
  float sheen=pow(max(dot(n,normalize(lightDir+vec3(0,0,1))),0.0),24.0);
  float fold=0.5+0.5*sin(f*23.0+density*2.2);
  float body=(0.5+0.5*smoothstep(0.2,0.7,f))*exp(-dot(p,p)*1.3)
    *(1.0-smoothstep(0.32,0.88,length(p)));
  // Deposits remain visible outside the autonomous central composition.
  float coverage=max(body,smoothstep(0.015,0.35,density)*0.85);
  vec3 blue=mix(vec3(0.009,0.035,0.085),vec3(0.16,0.56,0.51),light);
  vec3 copper=mix(vec3(0.07,0.013,0.012),vec3(0.65,0.25,0.075),light);
  vec3 iris=mix(vec3(0.045,0.012,0.10),vec3(0.40,0.27,0.68),light);
  vec3 hue=u_mood<0.5?mix(blue,copper,u_mood*2.0):mix(copper,iris,(u_mood-0.5)*2.0);
  vec3 pearl=mix(hue,vec3(0.65,0.77,0.74),0.35);
  vec3 col=vec3(0.0015,0.0025,0.004)+coverage*(
    hue*(0.28+fold*0.38+density*0.65)+pearl*sheen*(0.24+density*0.25));
  fragColor = vec4(col,density);
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
