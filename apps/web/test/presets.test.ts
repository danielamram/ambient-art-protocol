import { SHADER_MANIFESTS } from '@ambient/shaders';
import { describe, expect, it } from 'vitest';
import { validateSettings } from '../src/state/artwork-settings.js';
import { SOURCE_PRESETS } from '../src/state/presets.js';

describe('SOURCE_PRESETS', () => {
  it('only contains settings that validate unchanged against the scene registry', () => {
    for (const p of SOURCE_PRESETS) {
      expect(validateSettings(p.settings, SHADER_MANIFESTS)).toEqual({
        ok: true,
        value: p.settings,
        adjusted: false,
      });
    }
  });

  it('has unique ids', () => {
    const ids = SOURCE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
