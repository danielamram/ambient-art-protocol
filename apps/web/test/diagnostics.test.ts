import { describe, expect, it } from 'vitest';
import { type DiagnosticsInput, diagnosticsReport } from '../src/state/diagnostics.js';

const input: DiagnosticsInput = {
  timestamp: '2026-09-23T10:00:00.000Z',
  appVersion: '0.0.0',
  commit: null,
  scene: 'living-filaments',
  qualityPreference: 'auto',
  readout: { fps: 58.456, quality: 'three-quarter', renderScale: 0.75, hdr: false },
  paused: false,
  source: '',
  viewport: { width: 390, height: 844 },
  devicePixelRatio: 3,
  reducedMotion: true,
  visibility: 'visible',
  userAgent: 'UA',
};

describe('diagnosticsReport', () => {
  it('reports an unknown commit rather than inventing one, and states measurement limits', () => {
    const r = JSON.parse(diagnosticsReport(input));
    expect(r.app).toEqual({ version: '0.0.0', commit: 'unknown' });
    expect(r.rendering).toEqual({
      qualityPreference: 'auto',
      effectiveTier: 'three-quarter',
      renderScale: 0.75,
      fps: 58.5,
      floatRenderTarget: false,
    });
    expect(r.limits).toMatch(/not measured/);
    expect(r.artwork.source).toBe('autonomous');
  });

  it('says there is no sample instead of reporting zeros before the first readout', () => {
    const r = JSON.parse(diagnosticsReport({ ...input, readout: null }));
    expect(r.rendering).toEqual({
      qualityPreference: 'auto',
      sample: 'none yet (paused or not rendered)',
    });
  });
});
