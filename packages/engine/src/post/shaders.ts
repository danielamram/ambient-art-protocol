/**
 * GLSL for the post stack. Every pass is a fullscreen triangle reading one or two textures.
 * Sources omit the version/precision/out boilerplate; `assembleFragment` adds it.
 */

/** Scene -> bloom buffer: bilinear downsample plus a soft luminance knee. */
export const BRIGHT_PASS_FRAGMENT = /* glsl */ `
uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform float u_threshold;
uniform float u_knee;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 texel = 1.0 / vec2(textureSize(u_scene, 0));
  // 4 bilinear taps in a diamond: a cheap 3x3 box that hides aliasing in the downsample.
  vec3 c = texture(u_scene, uv).rgb * 0.4;
  c += texture(u_scene, uv + vec2(texel.x, 0.0)).rgb * 0.15;
  c += texture(u_scene, uv - vec2(texel.x, 0.0)).rgb * 0.15;
  c += texture(u_scene, uv + vec2(0.0, texel.y)).rgb * 0.15;
  c += texture(u_scene, uv - vec2(0.0, texel.y)).rgb * 0.15;
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - u_threshold + u_knee, 0.0, 2.0 * u_knee);
  soft = soft * soft / (4.0 * u_knee + 1e-4);
  float w = max(soft, l - u_threshold) / max(l, 1e-4);
  fragColor = vec4(c * w, 1.0);
}
`;

/** 9-tap Gaussian using 5 linear fetches. `u_direction` is (1,0) or (0,1). */
export const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D u_src;
uniform vec2 u_resolution;
uniform vec2 u_direction;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 texel = 1.0 / u_resolution;
  vec2 o1 = u_direction * texel * 1.3846153846;
  vec2 o2 = u_direction * texel * 3.2307692308;
  vec3 c = texture(u_src, uv).rgb * 0.2270270270;
  c += (texture(u_src, uv + o1).rgb + texture(u_src, uv - o1).rgb) * 0.3162162162;
  c += (texture(u_src, uv + o2).rgb + texture(u_src, uv - o2).rgb) * 0.0702702703;
  fragColor = vec4(c, 1.0);
}
`;

/**
 * Scene + bloom -> screen. Chromatic aberration, vignette, ACES filmic tonemap, gamma,
 * shadow-weighted animated grain, and a 1/255 dither so dark gradients never band.
 */
export const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_energy;
uniform float u_bloomStrength;
uniform float u_aberration;
uniform float u_grain;
uniform float u_vignette;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  vec2 ab = d * r2 * u_aberration * 0.08;
  vec3 col = vec3(
    texture(u_scene, uv + ab).r,
    texture(u_scene, uv).g,
    texture(u_scene, uv - ab).b);
  vec3 bloom = texture(u_bloom, uv).rgb;
  col += bloom * u_bloomStrength * (0.7 + 0.6 * u_energy);
  float aspect = u_resolution.x / u_resolution.y;
  float vig = smoothstep(1.0, 0.25, length(d * vec2(aspect, 1.0)));
  col *= mix(1.0, vig, u_vignette);
  col = pow(aces(col), vec3(1.0 / 2.2));
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  float n = hash(gl_FragCoord.xy + fract(u_time * 7.0) * 977.0) - 0.5;
  col += n * u_grain * (0.35 + 0.65 * (1.0 - luma));
  col += (hash(gl_FragCoord.yx + u_time) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
`;

/** Straight copy used when post-processing is disabled. Still tonemaps so HDR themes read. */
export const COPY_FRAGMENT = /* glsl */ `
uniform sampler2D u_scene;
uniform vec2 u_resolution;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 col = texture(u_scene, uv).rgb;
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
  fragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`;

/** Maps a [0, 1] setting onto the shader's working range. Kept here so tests can pin them. */
export const POST_RANGES = {
  bloomStrength: 1.6,
  grain: 0.14,
  knee: 0.2,
} as const;
