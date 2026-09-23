import {
  type ArtworkSettingsV1,
  defaultSettings,
  hasScene,
  isPaletteId,
  roundControl,
  type SceneRegistry,
  validateSettings,
} from './artwork-settings.js';

/**
 * Share links carry supported settings in the URL fragment:
 *
 *   #look=1&scene=living-filaments&palette=iris&form=0.45&motion=0.35&glow=default
 *
 * Fixed field order, two-decimal numbers, `glow=default` for the scene's own lighting. The
 * fragment never reaches a server. Unknown keys are ignored for forward-compatible optional
 * fields; duplicate known keys are invalid.
 */
export const LOOK_FRAGMENT_MAX = 2048;
const KNOWN = ['look', 'scene', 'palette', 'form', 'motion', 'glow'] as const;

const formatControl = (v: number): string => String(roundControl(v));

export function encodeLook(s: ArtworkSettingsV1): string {
  const p = new URLSearchParams();
  p.set('look', '1');
  p.set('scene', s.scene);
  p.set('palette', s.palette);
  p.set('form', formatControl(s.form));
  p.set('motion', formatControl(s.motion));
  p.set('glow', s.glow === null ? 'default' : formatControl(s.glow));
  return p.toString();
}

export type DecodedLook =
  /** The fragment is not a look link at all. */
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'ok'; readonly settings: ArtworkSettingsV1; readonly adjusted: boolean };

/** Strict decimal: rejects '', ' ', '0x10', '1e3', 'Infinity' rather than trusting Number(). */
const DECIMAL = /^-?(\d+(\.\d*)?|\.\d+)$/;
const parseControl = (raw: string): number | undefined =>
  DECIMAL.test(raw) ? Number(raw) : undefined;

/** Decode `location.hash` (with or without the leading '#'). */
export function decodeLookFragment(hash: string, scenes: SceneRegistry): DecodedLook {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (body === '') return { kind: 'none' };
  if (body.length > LOOK_FRAGMENT_MAX) {
    // Only a look link if it says so; an oversized unrelated fragment is none of our business.
    return /(^|&)look=/.test(body.slice(0, LOOK_FRAGMENT_MAX))
      ? { kind: 'invalid' }
      : { kind: 'none' };
  }
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(body);
  } catch {
    return { kind: 'none' };
  }
  if (!params.has('look')) return { kind: 'none' };
  for (const key of KNOWN) if (params.getAll(key).length > 1) return { kind: 'invalid' };
  const version = params.get('look');
  const scene = params.get('scene');
  const palette = params.get('palette');
  const form = parseControl(params.get('form') ?? '');
  const motion = parseControl(params.get('motion') ?? '');
  const glowRaw = params.get('glow');
  const glow = glowRaw === 'default' ? null : parseControl(glowRaw ?? '');
  if (
    version !== '1' ||
    !hasScene(scenes, scene) ||
    !isPaletteId(palette) ||
    form === undefined ||
    motion === undefined ||
    glow === undefined
  ) {
    return { kind: 'invalid' };
  }
  const result = validateSettings({ version: 1, scene, palette, form, motion, glow }, scenes);
  return result.ok
    ? { kind: 'ok', settings: result.value, adjusted: result.adjusted }
    : { kind: 'invalid' };
}

/**
 * A clean, same-origin share URL: keeps the deployment path, drops every query parameter
 * (capture, time, debug, legacy scene, anything unrelated) and any source configuration.
 */
export function shareUrl(
  location: { readonly origin: string; readonly pathname: string },
  s: ArtworkSettingsV1,
): string {
  return `${location.origin}${location.pathname}#${encodeLook(s)}`;
}

export type StartupOrigin = 'capture' | 'shared' | 'legacy' | 'stored' | 'default';

export interface Startup {
  readonly origin: StartupOrigin;
  readonly settings: ArtworkSettingsV1;
  /** Human-readable, never a raw parser error. */
  readonly notice?: string;
}

/**
 * Startup precedence:
 * 1. `?capture`: existing capture behavior, `?scene` with defaults; no saved or shared state.
 * 2. A valid `#look=` fragment. An invalid one falls back to defaults with a notice, never to an
 *    unrelated saved look.
 * 3. A valid legacy `?scene=` link, with defaults.
 * 4. The last settings stored on this device (already validated by the caller).
 * 5. Defaults.
 */
export function resolveStartup(input: {
  readonly search: string;
  readonly hash: string;
  readonly stored: ArtworkSettingsV1 | null;
  readonly scenes: SceneRegistry;
}): Startup {
  const query = new URLSearchParams(input.search);
  const legacy = query.get('scene');
  const legacyScene = hasScene(input.scenes, legacy) ? legacy : null;
  if (query.has('capture')) {
    return { origin: 'capture', settings: defaultSettings(legacyScene ?? undefined) };
  }
  const shared = decodeLookFragment(input.hash, input.scenes);
  if (shared.kind === 'ok') {
    return {
      origin: 'shared',
      settings: shared.settings,
      ...(shared.adjusted ? { notice: ADJUSTED_NOTICE } : {}),
    };
  }
  if (shared.kind === 'invalid') {
    return { origin: 'default', settings: defaultSettings(), notice: INVALID_NOTICE };
  }
  if (legacyScene) return { origin: 'legacy', settings: defaultSettings(legacyScene) };
  if (input.stored) return { origin: 'stored', settings: input.stored };
  return { origin: 'default', settings: defaultSettings() };
}

export const INVALID_NOTICE =
  'That link’s look could not be read, so the artwork opened with its default settings.';
export const ADJUSTED_NOTICE =
  'Some values in that link were out of range and have been adjusted to fit.';
