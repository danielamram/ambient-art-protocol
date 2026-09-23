/**
 * A small, local-only diagnostics report for bug reports and device checks. Nothing is sent
 * anywhere. It deliberately excludes live payloads, account or GPU identifiers.
 */
export interface DiagnosticsInput {
  readonly timestamp: string;
  /** Injected at build time; null when unknown. Never guessed. */
  readonly appVersion: string | null;
  readonly commit: string | null;
  readonly scene: string;
  readonly qualityPreference: string;
  /** The stage's latest aggregate readout; null before the first sample (e.g. paused at load). */
  readonly readout: {
    readonly fps: number;
    readonly quality: string;
    readonly renderScale: number;
    readonly hdr: boolean;
  } | null;
  readonly paused: boolean;
  readonly source: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly reducedMotion: boolean;
  readonly visibility: string;
  readonly userAgent: string;
}

export const MEASUREMENT_LIMITS =
  'fps is an aggregate sample over ~0.5 s windows while frames render. Per-frame timing, p95 frame time and GPU timing are not measured.';

const round = (v: number, digits: number) => Number(v.toFixed(digits));

export function diagnosticsReport(d: DiagnosticsInput): string {
  const report = {
    report: 'ambient-art-protocol diagnostics v1',
    timestamp: d.timestamp,
    app: { version: d.appVersion ?? 'unknown', commit: d.commit ?? 'unknown' },
    artwork: { scene: d.scene, paused: d.paused, source: d.source || 'autonomous' },
    rendering: d.readout
      ? {
          qualityPreference: d.qualityPreference,
          effectiveTier: d.readout.quality,
          renderScale: round(d.readout.renderScale, 3),
          fps: round(d.readout.fps, 1),
          floatRenderTarget: d.readout.hdr,
        }
      : { qualityPreference: d.qualityPreference, sample: 'none yet (paused or not rendered)' },
    environment: {
      viewport: `${d.viewport.width}x${d.viewport.height}`,
      devicePixelRatio: round(d.devicePixelRatio, 2),
      reducedMotion: d.reducedMotion,
      visibility: d.visibility,
      userAgent: d.userAgent,
    },
    limits: MEASUREMENT_LIMITS,
  };
  return JSON.stringify(report, null, 2);
}

/** Readable tier names for the panel. Unknown names pass through unchanged. */
export const TIER_LABEL: Readonly<Record<string, string>> = {
  full: 'Full',
  'three-quarter': 'Three-quarter',
  half: 'Half',
  low: 'Low',
};
