import { SHADER_MANIFESTS } from '@ambient/shaders';
import { describe, expect, it } from 'vitest';
import { type ArtworkSettingsV1, defaultSettings } from '../src/state/artwork-settings.js';
import {
  decodeLookFragment,
  encodeLook,
  LOOK_FRAGMENT_MAX,
  resolveStartup,
  shareUrl,
} from '../src/state/look-codec.js';

const S = SHADER_MANIFESTS;
const look: ArtworkSettingsV1 = {
  version: 1,
  scene: 'resonant-silk',
  palette: 'iris',
  form: 0,
  motion: 0.35,
  glow: 0,
};
const decode = (hash: string) => decodeLookFragment(hash, S);

describe('encodeLook / decodeLookFragment', () => {
  it('encodes in a fixed order with two-decimal numbers and zero kept as zero', () => {
    expect(encodeLook({ ...look, motion: 0.3456 })).toBe(
      'look=1&scene=resonant-silk&palette=iris&form=0&motion=0.35&glow=0',
    );
    expect(encodeLook(defaultSettings())).toBe(
      'look=1&scene=living-filaments&palette=glacier&form=0.45&motion=0.45&glow=default',
    );
  });

  it('round-trips every scene and both glow modes', () => {
    for (const m of S) {
      for (const glow of [null, 0, 0.5, 1]) {
        const s = { ...look, scene: m.id, glow };
        expect(decode(`#${encodeLook(s)}`)).toEqual({ kind: 'ok', settings: s, adjusted: false });
      }
    }
  });

  it('ignores fragments that are not look links', () => {
    expect(decode('')).toEqual({ kind: 'none' });
    expect(decode('#')).toEqual({ kind: 'none' });
    expect(decode('#section-2')).toEqual({ kind: 'none' });
    expect(decode(`#${'x'.repeat(LOOK_FRAGMENT_MAX + 1)}`)).toEqual({ kind: 'none' });
  });

  it('ignores unknown keys for forward compatibility', () => {
    const r = decode(`#${encodeLook(look)}&seed=42&camera=orbit`);
    expect(r).toEqual({ kind: 'ok', settings: look, adjusted: false });
  });

  it.each([
    ['unsupported version', 'look=2&scene=resonant-silk&palette=iris&form=0&motion=0&glow=0'],
    ['unknown scene', 'look=1&scene=nope&palette=iris&form=0&motion=0&glow=0'],
    ['unknown palette', 'look=1&scene=resonant-silk&palette=neon&form=0&motion=0&glow=0'],
    ['empty number', 'look=1&scene=resonant-silk&palette=iris&form=&motion=0&glow=0'],
    ['missing number', 'look=1&scene=resonant-silk&palette=iris&motion=0&glow=0'],
    ['missing glow', 'look=1&scene=resonant-silk&palette=iris&form=0&motion=0'],
    ['NaN', 'look=1&scene=resonant-silk&palette=iris&form=NaN&motion=0&glow=0'],
    ['Infinity', 'look=1&scene=resonant-silk&palette=iris&form=Infinity&motion=0&glow=0'],
    ['hex', 'look=1&scene=resonant-silk&palette=iris&form=0x1&motion=0&glow=0'],
    ['exponent', 'look=1&scene=resonant-silk&palette=iris&form=1e-1&motion=0&glow=0'],
    ['whitespace', 'look=1&scene=resonant-silk&palette=iris&form=%200.5&motion=0&glow=0'],
    ['duplicate key', 'look=1&scene=resonant-silk&palette=iris&form=0&form=1&motion=0&glow=0'],
    [
      'duplicate scene',
      'look=1&scene=resonant-silk&scene=aurora-drift&palette=iris&form=0&motion=0&glow=0',
    ],
    ['markup', 'look=1&scene=%3Cimg%20src%3Dx%3E&palette=iris&form=0&motion=0&glow=0'],
  ])('rejects the whole link on %s', (_name, body) => {
    expect(decode(`#${body}`)).toEqual({ kind: 'invalid' });
  });

  it('rejects an oversized look fragment', () => {
    const body = `${encodeLook(look)}&pad=${'x'.repeat(LOOK_FRAGMENT_MAX)}`;
    expect(decode(`#${body}`)).toEqual({ kind: 'invalid' });
  });

  it('clamps finite out-of-range values and reports the adjustment', () => {
    const r = decode('#look=1&scene=resonant-silk&palette=iris&form=1.7&motion=-0.2&glow=0.5');
    expect(r).toEqual({
      kind: 'ok',
      adjusted: true,
      settings: { ...look, form: 1, motion: 0, glow: 0.5 },
    });
  });
});

describe('shareUrl', () => {
  it('keeps origin and deployment path but drops every query parameter', () => {
    const url = shareUrl({ origin: 'https://art.example', pathname: '/gallery/' }, look);
    expect(url).toBe(`https://art.example/gallery/#${encodeLook(look)}`);
  });
});

describe('resolveStartup', () => {
  const stored = { ...look, scene: 'aurora-drift' };
  const run = (search: string, hash: string, saved: ArtworkSettingsV1 | null = stored) =>
    resolveStartup({ search, hash, stored: saved, scenes: S });
  const shared = `#${encodeLook(look)}`;

  it('capture mode keeps its scene query and bypasses shared and stored state', () => {
    expect(run('?capture&scene=chromatic-ink&time=12', shared)).toEqual({
      origin: 'capture',
      settings: defaultSettings('chromatic-ink'),
    });
    expect(run('?capture', shared).settings).toEqual(defaultSettings());
  });

  it('a valid shared look beats a legacy scene and the stored look', () => {
    expect(run('?scene=chromatic-ink', shared)).toEqual({ origin: 'shared', settings: look });
  });

  it('an invalid shared look falls back to defaults with a notice, not the stored look', () => {
    const r = run('', '#look=9&scene=x');
    expect(r.origin).toBe('default');
    expect(r.settings).toEqual(defaultSettings());
    expect(r.notice).toBeTypeOf('string');
  });

  it('a legacy ?scene link uses defaults for that scene rather than the stored look', () => {
    expect(run('?scene=chromatic-ink', '')).toEqual({
      origin: 'legacy',
      settings: defaultSettings('chromatic-ink'),
    });
  });

  it('an unknown legacy scene falls through to the stored look, then defaults', () => {
    expect(run('?scene=bogus', '')).toEqual({ origin: 'stored', settings: stored });
    expect(run('', '', null)).toEqual({ origin: 'default', settings: defaultSettings() });
  });
});
