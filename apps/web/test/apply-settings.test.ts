import { describe, expect, it } from 'vitest';
import { type ArtworkStage, applySettings } from '../src/state/apply-settings.js';
import { type ArtworkSettingsV1, defaultSettings } from '../src/state/artwork-settings.js';

const SCENE_BLOOM: Record<string, number> = {
  'living-filaments': 0.28,
  'chromatic-ink': 0.4,
  'resonant-silk': 0.2,
};

/** A fake stage that behaves like AmbientStage's public surface and records the call order. */
function fakeStage(opts: { failScene?: string; failForm?: boolean } = {}) {
  const calls: string[] = [];
  const state = {
    scene: 'living-filaments',
    override: null as number | null,
    mood: 0,
    form: 0.45,
    motion: 0.45,
  };
  let failForm = opts.failForm ?? false;
  const stage: ArtworkStage = {
    get scene() {
      return state.scene;
    },
    get glow() {
      return state.override ?? SCENE_BLOOM[state.scene] ?? 0;
    },
    selectScene(id) {
      calls.push(`scene:${id}`);
      if (id === opts.failScene || !(id in SCENE_BLOOM)) return false;
      state.scene = id;
      return true;
    },
    clearLighting() {
      calls.push('clear');
      state.override = null;
      return stage.glow;
    },
    setPalette(mood) {
      calls.push(`palette:${mood}`);
      state.mood = mood;
    },
    setForm(v) {
      calls.push(`form:${v}`);
      if (failForm) {
        failForm = false;
        throw new Error('boom');
      }
      state.form = v;
    },
    setMotion(v) {
      calls.push(`motion:${v}`);
      state.motion = v;
    },
    setGlow(v) {
      calls.push(`glow:${v}`);
      state.override = v;
      return v;
    },
  };
  return { stage, calls, state };
}

const look = (patch: Partial<ArtworkSettingsV1>): ArtworkSettingsV1 => ({
  ...defaultSettings(),
  ...patch,
});

describe('applySettings', () => {
  it('applies in order: scene, clear overrides, palette, form, motion, explicit glow', () => {
    const { stage, calls } = fakeStage();
    const r = applySettings(
      stage,
      look({ scene: 'chromatic-ink', palette: 'iris', form: 0.1, motion: 0, glow: 0 }),
      defaultSettings(),
    );
    expect(r).toEqual({ ok: true, glow: 0 });
    expect(calls).toEqual([
      'scene:chromatic-ink',
      'clear',
      'palette:1',
      'form:0.1',
      'motion:0',
      'glow:0',
    ]);
  });

  it('a null glow reads the new scene default instead of writing an override', () => {
    const { stage, calls, state } = fakeStage();
    state.override = 0.9;
    const r = applySettings(stage, look({ scene: 'resonant-silk' }), defaultSettings());
    expect(r).toEqual({ ok: true, glow: 0.2 });
    expect(calls.some((c) => c.startsWith('glow:'))).toBe(false);
    expect(state.override).toBeNull();
  });

  it('a failed scene switch changes nothing', () => {
    const { stage, calls, state } = fakeStage({ failScene: 'chromatic-ink' });
    state.override = 0.7;
    const r = applySettings(stage, look({ scene: 'chromatic-ink', form: 0.9 }), defaultSettings());
    expect(r).toEqual({ ok: false, reason: 'scene' });
    expect(calls).toEqual(['scene:chromatic-ink']);
    expect(state).toMatchObject({ scene: 'living-filaments', override: 0.7, form: 0.45 });
  });

  it('restores the previous look when a later setter throws', () => {
    const { stage, state } = fakeStage({ failForm: true });
    const previous = look({ palette: 'ember', glow: 0.5 });
    const r = applySettings(stage, look({ scene: 'chromatic-ink', palette: 'iris' }), previous);
    expect(r).toEqual({ ok: false, reason: 'apply' });
    expect(state).toMatchObject({ scene: 'living-filaments', mood: 0.5, override: 0.5 });
  });
});
