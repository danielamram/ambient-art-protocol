import { SHADER_MANIFESTS } from '@ambient/shaders';
import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  resetArtwork,
  settingsEqual,
  validateDevicePreferences,
  validateSettings,
  withScene,
} from '../src/state/artwork-settings.js';

const valid = { version: 1, scene: 'resonant-silk', palette: 'iris', form: 0, motion: 1, glow: 0 };

describe('validateSettings', () => {
  it('accepts zero values and keeps an explicit glow of 0 distinct from the scene default', () => {
    const r = validateSettings(valid, SHADER_MANIFESTS);
    expect(r).toEqual({ ok: true, adjusted: false, value: valid });
    const d = validateSettings({ ...valid, glow: null }, SHADER_MANIFESTS);
    expect(d.ok && d.value.glow).toBeNull();
  });

  it('validates scene ids against the manifest registry', () => {
    for (const m of SHADER_MANIFESTS) {
      expect(validateSettings({ ...valid, scene: m.id }, SHADER_MANIFESTS).ok).toBe(true);
    }
    expect(validateSettings({ ...valid, scene: 'not-a-scene' }, SHADER_MANIFESTS).ok).toBe(false);
  });

  it.each([
    ['palette', { palette: 'neon' }],
    ['version', { version: 2 }],
    ['NaN', { form: Number.NaN }],
    ['Infinity', { motion: Number.POSITIVE_INFINITY }],
    ['string number', { form: '0.5' }],
    ['missing field', { motion: undefined }],
    ['undefined glow', { glow: undefined }],
  ])('rejects the whole object on a bad %s', (_name, patch) => {
    expect(validateSettings({ ...valid, ...patch }, SHADER_MANIFESTS).ok).toBe(false);
  });

  it('clamps finite out-of-range values and reports the adjustment', () => {
    const r = validateSettings({ ...valid, form: 1.5, glow: -2 }, SHADER_MANIFESTS);
    expect(r).toEqual({ ok: true, adjusted: true, value: { ...valid, form: 1, glow: 0 } });
  });

  it('rounds to slider precision', () => {
    const r = validateSettings({ ...valid, form: 0.123456 }, SHADER_MANIFESTS);
    expect(r.ok && r.value.form).toBe(0.12);
  });

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 'look', 3, []]) {
      expect(validateSettings(bad, SHADER_MANIFESTS).ok).toBe(false);
    }
  });
});

describe('transitions', () => {
  it('fresh scene selection keeps palette/form/motion and returns glow to the scene default', () => {
    const s = { ...defaultSettings(), palette: 'ember' as const, form: 0.8, glow: 0.6 };
    expect(withScene(s, 'chromatic-ink')).toEqual({ ...s, scene: 'chromatic-ink', glow: null });
  });

  it('reset artwork keeps the scene and restores the other defaults', () => {
    const s = { ...defaultSettings('aurora-drift'), palette: 'iris' as const, motion: 0, glow: 0 };
    expect(resetArtwork(s)).toEqual(defaultSettings('aurora-drift'));
  });

  it('treats null glow and glow 0 as different settings', () => {
    const a = defaultSettings();
    expect(settingsEqual(a, { ...a, glow: 0 })).toBe(false);
    expect(settingsEqual(a, { ...a })).toBe(true);
  });
});

describe('validateDevicePreferences', () => {
  it('accepts known quality modes only', () => {
    expect(validateDevicePreferences({ version: 1, quality: 'low' })).toEqual({
      version: 1,
      quality: 'low',
    });
    expect(validateDevicePreferences({ version: 1, quality: 'ultra' })).toBeNull();
    expect(validateDevicePreferences({ version: 2, quality: 'low' })).toBeNull();
  });
});
