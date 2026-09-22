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
 * Fluid Field: feedback-advected ink. Each frame the previous frame is pulled back along a
 * divergence-free curl-noise flow plus the current, faded, and new dye is injected at pulses.
 * It is a TouchDesigner-style feedback loop, not a Navier-Stokes solver.
 *  - u_current    steers and speeds the whole flow
 *  - u_turbulence tightens the swirls and speeds them up
 *  - u_pulses     drop blobs of dye coloured from the palette
 *  - u_mood       recolours the ink
 *  - u_energy     hands over from the idle emitters to the data
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

  // Velocity field in screen-height units per second.
  vec2 fp = p * (1.1 + u_turbulence * 1.6) + vec2(u_time * 0.05, -u_time * 0.035);
  vec2 vel = curl(fp) * (0.10 + 0.40 * u_turbulence);
  vel += curl(fp * 2.3 + 7.1) * 0.05 * u_turbulence;
  vel += dir * (0.02 + 0.45 * u_current.z);

  // Semi-Lagrangian backtrace; the bilinear fetch doubles as diffusion.
  vec2 back = uv - vel * u_dt * vec2(1.0 / aspect, 1.0);
  vec2 tx = 1.0 / u_resolution;
  vec3 prev = texture(u_prevFrame, back).rgb * 0.6;
  prev += texture(u_prevFrame, back + vec2(tx.x, 0.0)).rgb * 0.1;
  prev += texture(u_prevFrame, back - vec2(tx.x, 0.0)).rgb * 0.1;
  prev += texture(u_prevFrame, back + vec2(0.0, tx.y)).rgb * 0.1;
  prev += texture(u_prevFrame, back - vec2(0.0, tx.y)).rgb * 0.1;
  // Retention per second, made frame-rate independent, with the 8-bit floor removed.
  prev = max(prev * pow(0.5, u_dt) - (AAP_HDR == 0 ? 1.5 / 255.0 * u_dt * 60.0 : 0.0), 0.0);

  vec3 dye = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 pl = u_pulses[i];
    if (pl.w <= 0.0) continue;
    float d = pulseDist(uv, pl, aspect);
    float young = (1.0 - smoothstep(0.0, 0.45, pl.z));
    vec3 ink = palette(hash1(pl.xy * 37.0) * 0.6 + u_mood * 0.3);
    dye += ink * pl.w * young * exp(-d * d * 260.0) * 0.8;
  }

  // Idle emitters keep the canvas alive when the stream is quiet.
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    vec2 c = vec2(0.5, 0.5) + 0.32 * vec2(sin(u_time * 0.11 + fk * 2.1), cos(u_time * 0.14 + fk * 1.3));
    float d = length((uv - c) * vec2(aspect, 1.0));
    dye += palette(fk * 0.31 + u_mood + u_time * 0.01) * exp(-d * d * 180.0) * 0.07 * (0.35 + 0.65 * (1.0 - u_energy));
  }

  // A faint field of filaments so the flow reads even when nothing is happening.
  float fil = smoothstep(0.35, 0.85, fbm(fp * 2.5 + vec2(u_time * 0.08, 0.0)) + 0.5);
  dye += palette(0.55 + fil * 0.25) * fil * fil * 0.006;

  vec3 col = prev + dye * u_dt * 60.0;

  // Recolour by density so thick ink goes iridescent, and compress the hottest cores so the
  // tonemapper keeps their hue instead of pushing them to white.
  float dens = max(col.r, max(col.g, col.b));
  col = mix(col, palette(dens * 0.35 + 0.1) * dens, 1.0 - pow(0.75, u_dt * 60.0));
  col *= 1.0 / (1.0 + 0.12 * dens * u_dt * 60.0);

  fragColor = vec4(col, 1.0);
}
`;

export const fluidField: ShaderManifest = {
  id: 'fluid-field',
  name: 'Fluid Field',
  description:
    'Feedback-advected ink. Pulses drop dye into a curl-noise flow that the current steers; ' +
    'turbulence tightens the swirls.',
  fragment,
  uniforms: [...STANDARD_DECLARATIONS, FEEDBACK_DECLARATION],
  feedback: true,
  post: { bloom: 0.55, bloomThreshold: 0.45, grain: 0.35, aberration: 0.3, vignette: 0.6 },
};
