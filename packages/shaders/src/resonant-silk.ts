import type { ShaderManifest } from '@ambient/sdk';
import { STANDARD_DECLARATIONS, STANDARD_UNIFORM_BLOCK } from './lib/glsl.js';

const vertex = /* glsl */ `#version 300 es
precision highp float;
${STANDARD_UNIFORM_BLOCK}
uniform float u_form;
uniform vec3 u_pointer;
uniform vec4 u_gesture;
out vec2 v_uv;
out vec3 v_normal;
out vec3 v_tangent;
out float v_depth;
const int COLUMNS = AAP_QUALITY > 0 ? 128 : 64;
const int ROWS = AAP_QUALITY > 0 ? 64 : 32;
mat2 rotate(float a) { return mat2(cos(a),-sin(a),sin(a),cos(a)); }
vec2 screen(vec3 p) {
  float aspect = u_resolution.x/u_resolution.y;
  return p.xy * (1.2/(6.8-p.z)) * min(1.0,aspect*0.92);
}
vec3 surface(vec2 uv) {
  float t = u_time*0.23;
  float x = (uv.x-0.5)*4.3;
  float z = (uv.y-0.5)*2.5;
  float envelope = sin(uv.x*3.141593);
  float y = sin(x*1.35+t)*cos(z*0.9-t*0.37)*(0.35+u_form*0.65);
  y += sin(x*3.5-z*1.2-t*0.62)*0.24*envelope;
  y += sin(z*4.2+x*0.7+t*0.28)*0.16*envelope;
  y += z*z*0.15*sin(t*0.31)+envelope*0.18*sin(t*0.49);
  vec3 p = vec3(x,y,z);
  p.yz *= rotate(0.65+sin(t*0.19)*0.12);
  p.xz *= rotate(-0.12+sin(t*0.13)*0.08+(u_current.x-0.5)*0.12);
  float portrait = 1.0-smoothstep(0.65,1.15,u_resolution.x/u_resolution.y);
  p.xy *= rotate(0.06+portrait*0.72);
  vec2 projected = screen(p);
  float aspect = u_resolution.x/u_resolution.y;
  vec2 delta = projected-(u_pointer.xy-0.5)*vec2(aspect,-1.0);
  float fit = min(1.0,aspect*0.92);
  float gather = exp(-dot(delta,delta)/(0.055*fit*fit));
  p.z += gather*u_pointer.z*0.22;
  vec2 wakeDelta = projected-(u_gesture.xy-0.5)*vec2(aspect,-1.0);
  float wake = exp(-dot(wakeDelta,wakeDelta)/(0.09*fit*fit));
  p.y += (u_gesture.z-u_gesture.w)*wake*0.9;
  // Traveling displacement of the sheet, rather than screen-space expansion of lines.
  for (int i=0;i<8;i++) {
    vec4 pulse = u_pulses[i];
    vec2 d = projected-(pulse.xy-0.5)*vec2(aspect,-1.0);
    float radius = length(d)/max(fit,0.1);
    float front = radius-pulse.z*0.30;
    float ring = exp(-front*front*65.0)*sin(front*24.0);
    p.z += ring*pulse.w*0.20*exp(-pulse.z*0.65);
  }
  return p;
}
void main() {
  vec2 corners[6] = vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
  vec2 cell = vec2(float(gl_InstanceID%COLUMNS),float(gl_InstanceID/COLUMNS));
  vec2 uv = (cell+corners[gl_VertexID])/vec2(float(COLUMNS),float(ROWS));
  vec3 p = surface(uv);
  // Central differences also work at sheet edges: the analytic surface extends beyond UV.
  vec3 tangent = surface(uv+vec2(0.002,0))-surface(uv-vec2(0.002,0));
  vec3 across = surface(uv+vec2(0,0.002))-surface(uv-vec2(0,0.002));
  v_tangent = normalize(tangent);
  v_normal = normalize(cross(tangent,across));
  v_depth = p.z;
  v_uv = uv;
  vec2 xy = screen(p);
  gl_Position = vec4(xy*vec2(2.0*u_resolution.y/u_resolution.x,2.0),0,1);
}
`;
const material = /* glsl */ `
${STANDARD_UNIFORM_BLOCK}
in vec2 v_uv;
in vec3 v_normal;
in vec3 v_tangent;
in float v_depth;
void main() {
  vec3 n = normalize(v_normal);
  if (n.z<0.0) n = -n;
  vec3 lightDir = normalize(vec3(-0.45,0.7,1.0));
  vec3 halfway = normalize(lightDir+vec3(0,0,1));
  float diffuse = pow(max(dot(n,lightDir),0.0),1.8);
  float facing = max(n.z,0.0);
  // Directional cloth sheen follows the warp threads, not a moving emission stripe.
  float tangentLight = dot(normalize(v_tangent),halfway);
  float sheen = pow(max(0.0,1.0-tangentLight*tangentLight),16.0)
    *pow(max(dot(n,halfway),0.0),8.0);
  vec3 glacier = mix(vec3(0.022,0.075,0.13),vec3(0.22,0.53,0.49),diffuse);
  vec3 ember = mix(vec3(0.10,0.025,0.018),vec3(0.65,0.31,0.12),diffuse);
  vec3 iris = mix(vec3(0.055,0.025,0.12),vec3(0.40,0.26,0.62),diffuse);
  vec3 base = u_mood<0.5?mix(glacier,ember,u_mood*2.0):mix(ember,iris,(u_mood-0.5)*2.0);
  float thread = v_uv.y*180.0;
  float detail = 1.0-smoothstep(0.2,0.8,fwidth(thread));
  float weave = 0.94+0.06*cos(thread*6.283185)*detail;
  float edge = smoothstep(0.0,0.018,v_uv.x)*smoothstep(0.0,0.018,1.0-v_uv.x)
    *smoothstep(0.0,0.025,v_uv.y)*smoothstep(0.0,0.025,1.0-v_uv.y);
  float depth = mix(0.65,1.0,smoothstep(-1.5,1.5,v_depth));
  vec3 pearl = mix(base,vec3(0.8,0.84,0.88),0.58);
  vec3 color = base*(0.22+diffuse*0.75)*weave+pearl*sheen*0.48;
  color += base*pow(1.0-facing,3.0)*0.16;
  fragColor = vec4(color*edge*depth*(1.0+u_energy*0.10),1.0);
}
`;
export const resonantSilk: ShaderManifest = {
  id: 'resonant-silk',
  name: 'Resonant Silk',
  description: 'A suspended satin veil. Hold to lift its folds; release a traveling wave.',
  uniforms: STANDARD_DECLARATIONS,
  fragment: `${STANDARD_UNIFORM_BLOCK}
void main() {
  vec2 p = (gl_FragCoord.xy-0.5*u_resolution)/u_resolution.y;
  fragColor = vec4(mix(vec3(0.001,0.002,0.005),vec3(0.007,0.012,0.020),exp(-dot(p,p)*4.0)),1.0);
}`,
  geometry: { vertex, fragment: material, instances: 128 * 64, lowInstances: 64 * 32 },
  post: { bloom: 0.16, bloomThreshold: 0.62, grain: 0.035, aberration: 0, vignette: 0.18 },
};
