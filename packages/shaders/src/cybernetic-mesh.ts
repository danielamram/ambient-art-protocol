import type { ShaderManifest } from '@ambient/sdk';
import {
  CURRENT,
  FEEDBACK_DECLARATION,
  FEEDBACK_UNIFORM,
  NOISE,
  PALETTE,
  STANDARD_DECLARATIONS,
  STANDARD_UNIFORM_BLOCK,
} from './lib/glsl.js';

/**
 * Cybernetic Mesh: a raymarched sphere wrapped in a glowing wire grid over an endless floor grid.
 *  - u_current    orbits the camera (x yaw, y pitch, velocity spins it faster)
 *  - u_turbulence displaces the surface and jitters the grid
 *  - u_pulses     race across the sphere as shockwave ridges and ring out across the floor
 *  - u_mood       colours the emission
 *  - u_energy     brightens the wires and dollies the camera in
 * Honours the `AAP_QUALITY` define (1 = 56 steps, 0 = 32).
 */
const fragment = /* glsl */ `
${STANDARD_UNIFORM_BLOCK}
${FEEDBACK_UNIFORM}
${NOISE}
${PALETTE}
${CURRENT}

const int STEPS = AAP_QUALITY > 0 ? 56 : 32;
const float FLOOR_Y = -1.45;

vec3 spherePoint(vec2 xy) {
  float th = xy.x * 6.2831853;
  float ph = (xy.y - 0.5) * 3.1415926;
  return vec3(cos(ph) * cos(th), sin(ph), cos(ph) * sin(th));
}

/** Shockwave ridges travelling out from where each pulse landed on the sphere. */
float shock(vec3 n) {
  float d = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 pl = u_pulses[i];
    if (pl.w <= 0.0) continue;
    float a = acos(clamp(dot(n, spherePoint(pl.xy)), -1.0, 1.0));
    float r = pl.z * 1.7;
    d += pl.w * exp(-pow((a - r) * 5.0, 2.0));
  }
  return d;
}

float displacement(vec3 q) {
  float t = u_time * 0.7;
  float d = sin(q.x * 5.0 + t) * sin(q.y * 5.0 - t * 0.7) * sin(q.z * 5.0 + t * 0.4) * 0.05;
  d += (noise3(q * 3.0 + t * 0.35) - 0.5) * 0.28 * u_turbulence;
  d += shock(normalize(q)) * 0.12;
  return d;
}

float sdScene(vec3 q) {
  return length(q) - 1.0 - displacement(q);
}

vec3 calcNormal(vec3 q) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0015;
  return normalize(
    k.xyy * sdScene(q + k.xyy * h) +
    k.yyx * sdScene(q + k.yyx * h) +
    k.yxy * sdScene(q + k.yxy * h) +
    k.xxx * sdScene(q + k.xxx * h));
}

float gridLines(vec2 g, float w) {
  vec2 f = abs(fract(g) - 0.5);
  return smoothstep(w, 0.0, min(f.x, f.y));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  vec2 dir = currentDir();

  float yaw = (u_current.x - 0.5) * 3.1 + u_time * (0.06 + 0.25 * u_current.z);
  float pitch = 0.18 + (u_current.y - 0.5) * 0.8;
  float dist = 5.2 - 0.9 * u_energy;
  vec3 ro = dist * vec3(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw));
  vec3 ta = vec3(0.0, -0.15, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(p.x * uu + p.y * vv + 1.5 * ww);

  vec3 emit = palette(u_mood);
  vec3 emit2 = palette(u_mood + 0.45);

  // Background: deep gradient, a halo behind the sphere, a few stars.
  float b = dot(ro, rd);
  float miss = length(ro - rd * b);
  vec3 col = vec3(0.004, 0.005, 0.010) + vec3(0.01, 0.012, 0.02) * (0.5 + 0.5 * rd.y);
  col += emit2 * exp(-max(miss - 1.0, 0.0) * 3.0) * 0.16 * (1.0 + 2.0 * u_energy);
  float star = hash1(floor(p * 160.0 + 500.0));
  col += vec3(0.7, 0.8, 1.0) * smoothstep(0.992, 1.0, star) * (0.6 + 0.4 * sin(u_time * 2.0 + star * 50.0));

  // Sphere: analytic bounding sphere, then march.
  float t = 1e9;
  bool hit = false;
  float R = 1.5;
  float h = b * b - (dot(ro, ro) - R * R);
  if (h > 0.0) {
    float sq = sqrt(h);
    float t0 = max(-b - sq, 0.0);
    float t1 = -b + sq;
    float tt = t0;
    for (int i = 0; i < STEPS; i++) {
      vec3 q = ro + rd * tt;
      float d = sdScene(q);
      if (d < 0.002) { hit = true; break; }
      tt += d * 0.75;
      if (tt > t1) break;
    }
    if (hit) t = tt;
  }

  // Floor plane.
  float tf = rd.y < -0.0001 ? (FLOOR_Y - ro.y) / rd.y : 1e9;
  if (tf < t) {
    vec3 fp = ro + rd * tf;
    vec2 gp = fp.xz * 0.9 + vec2(u_time * 0.15) * vec2(dir.x, -dir.y) * (0.2 + u_current.z);
    float fog = exp(-tf * 0.14);
    float line = gridLines(gp, 0.035 + 0.01 * u_turbulence) * 0.7 + gridLines(gp * 0.25, 0.012) * 0.6;
    float rings = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 pl = u_pulses[i];
      if (pl.w <= 0.0) continue;
      vec2 c = (pl.xy - 0.5) * vec2(7.0, -7.0);
      rings += pl.w * exp(-pow((length(fp.xz - c) - pl.z * 3.5) * 2.2, 2.0));
    }
    float glow = exp(-length(fp.xz) * 0.9) * 0.35;
    vec3 fcol = emit * line * (0.5 + 0.9 * u_energy) + emit2 * rings * 2.5 + emit2 * glow;
    col = col * (1.0 - fog) + fcol * fog;
  }

  if (hit) {
    vec3 q = ro + rd * t;
    vec3 n = calcNormal(q);
    vec3 nq = normalize(q);
    vec2 sph = vec2(atan(nq.z, nq.x) / 6.2831853 + 0.5, asin(clamp(nq.y, -1.0, 1.0)) / 3.1415926 + 0.5);
    float lat = cos((sph.y - 0.5) * 3.1415926);
    vec2 cells = vec2(28.0, 14.0);
    vec2 jitter = vec2(noise(sph * 20.0 + u_time * 0.2)) * 0.02 * u_turbulence;
    float wire = gridLines(sph * cells + jitter, 0.05 + 0.03 * u_turbulence) * (0.35 + 0.65 * lat);
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    float diff = max(dot(n, normalize(vec3(0.6, 0.9, 0.4))), 0.0);
    float sh = shock(nq);
    vec3 base = vec3(0.015, 0.018, 0.028) + diff * vec3(0.05, 0.06, 0.09);
    vec3 e = emit * wire * (0.9 + 2.2 * u_energy);
    e += emit2 * fres * 1.1;
    e += palette(u_mood + 0.2) * sh * 4.0;
    e += emit * pow(max(dot(reflect(rd, n), vec3(0.0, 1.0, 0.0)), 0.0), 24.0) * 0.6;
    col = base + e;
  }

  // Light motion trail.
  vec3 prev = texture(u_prevFrame, uv).rgb;
  prev = max(prev * pow(0.03, u_dt) - 1.5 / 255.0, 0.0);
  col = max(col, prev);

  fragColor = vec4(col, 1.0);
}
`;

export const cyberneticMesh: ShaderManifest = {
  id: 'cybernetic-mesh',
  name: 'Cybernetic Mesh',
  description:
    'A raymarched sphere in a glowing wire grid above an endless floor. Current orbits the ' +
    'camera, pulses race across the surface as shockwaves.',
  fragment,
  uniforms: [...STANDARD_DECLARATIONS, FEEDBACK_DECLARATION],
  feedback: true,
  post: { bloom: 0.8, bloomThreshold: 0.5, grain: 0.25, aberration: 0.4, vignette: 0.5 },
};
