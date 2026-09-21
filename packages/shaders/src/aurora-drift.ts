import type { ShaderManifest } from '@ambient/sdk';
import {
  CURRENT,
  FEEDBACK_DECLARATION,
  FEEDBACK_UNIFORM,
  NOISE,
  PALETTE,
  PULSES,
  STANDARD_DECLARATIONS,
  STANDARD_UNIFORM_BLOCK,
} from './lib/glsl.js';

/**
 * Aurora Drift: domain-warped curtains of light over a near-black sky.
 *  - u_mood       selects the palette (cold teal/violet at 0, hot amber/magenta at 1)
 *  - u_turbulence warps the curtains and speeds them up
 *  - u_current    drifts the field and the feedback trail along a direction
 *  - u_pulses     burst as rings that light the curtain where they land
 *  - u_energy     brightens the ribbons as the stream gets busy
 *  - u_prevFrame  adds a short, frame-rate independent trail
 * Output is linear HDR; the engine tonemaps and blooms it.
 */
const fragment = /* glsl */ `
${STANDARD_UNIFORM_BLOCK}
${FEEDBACK_UNIFORM}
${NOISE}
${PALETTE}
${PULSES}
${CURRENT}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

  vec2 dir = currentDir();
  float speed = 0.02 + u_current.z * 0.25;
  vec2 q = p - dir * u_time * speed;

  // Curtains are stretched vertically, like the real thing.
  vec2 s = vec2(q.x * 1.6, q.y * 0.55);
  float warp = 0.5 + u_turbulence * 2.4;
  float t = u_time * (0.04 + u_turbulence * 0.14);
  float n1 = fbm(s * 1.4 + vec2(t, -t * 0.6));
  float n2 = fbm(s * 1.4 + warp * vec2(n1, fbm(s * 1.4 + vec2(5.2, 1.3) + t)));
  float n3 = fbm(vec2(q.x * 3.2 + n1 * 0.8, q.y * 0.5 - t * 0.35));

  // Folded noise gives sharp bright ridges: the ribbons.
  float ridge = clamp(1.0 - abs(n2) * 5.0, 0.0, 1.0);
  float ribbon = pow(ridge, 2.5 + 2.0 * (1.0 - u_turbulence));
  float rays = pow(clamp(n3 + 0.15, 0.0, 1.0), 5.0) * smoothstep(-0.55, 0.5, p.y);
  float body = smoothstep(-0.25, 0.7, n2 + 0.3);

  vec3 col = palette(n2 * 0.6 + u_time * 0.01) * body * body * 0.09;
  col += palette(n1 * 0.5 + 0.35) * ribbon * (1.3 + 2.4 * u_energy);
  col += palette(n3 * 0.3 + 0.6) * rays * (0.6 + 1.2 * u_energy);

  // Starfield with a slow twinkle.
  vec2 cell = floor(p * 140.0 + 1000.0);
  float star = hash1(cell);
  float tw = 0.6 + 0.4 * sin(u_time * (1.5 + star * 3.0) + star * 40.0);
  col += vec3(0.8, 0.9, 1.0) * smoothstep(0.988, 1.0, star) * tw * (1.0 - body * 0.7) * 1.4;

  // Pulses: an expanding ring plus a local flare in the curtain.
  float ripple = 0.0;
  float flare = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 pl = u_pulses[i];
    if (pl.w <= 0.0) continue;
    float d = pulseDist(uv, pl, aspect);
    float r = pl.z * 0.6;
    ripple += pl.w * exp(-pow((d - r) * 16.0, 2.0));
    flare += pl.w * exp(-d * d * 30.0) * smoothstep(0.6, 0.0, pl.z);
  }
  col += ripple * palette(0.8 + u_time * 0.02) * 1.6;
  col += flare * (ridge + 0.3) * palette(0.2) * 2.0;

  col *= 0.85 + 0.35 * u_energy;

  // Feedback: a short trail that drifts with the current. max() keeps it bounded by the source.
  vec3 prev = texture(u_prevFrame, uv + dir * u_dt * 0.03).rgb;
  prev = max(prev * pow(0.10, u_dt) - 1.5 / 255.0, 0.0);
  col = max(col, prev);

  fragColor = vec4(col, 1.0);
}
`;

export const auroraDrift: ShaderManifest = {
  id: 'aurora-drift',
  name: 'Aurora Drift',
  description:
    'Domain-warped curtains of light over a black sky. Mood shifts the palette, turbulence ' +
    'warps the ribbons, pulses flare where they land.',
  fragment,
  uniforms: [...STANDARD_DECLARATIONS, FEEDBACK_DECLARATION],
  feedback: true,
  post: { bloom: 0.55, bloomThreshold: 0.55, grain: 0.3, aberration: 0.25, vignette: 0.55 },
};
