import {
  CanvasRenderer,
  FrameLoop,
  type PostSettings,
  QUALITY_LEVELS,
  QualityController,
  type QualityLevel,
  SignalToUniformMapper,
} from '@ambient/engine';
import { DataSignalBus, type Source, SourceRegistry, type SourceStatus } from '@ambient/sdk';
import { createMockSource } from '@ambient/sdk/testing';
import { auroraDrift, findShader, SHADER_MANIFESTS } from '@ambient/shaders';
import { binanceTrades, wikipediaEdits } from '@ambient/sources';

export const OVERLAY_SOURCE = 'overlay';

export type QualityMode = 'auto' | 'high' | 'low';

export interface Readout {
  mood: number;
  turbulence: number;
  current: readonly [number, number, number];
  pulse: number;
  energy: number;
  livePulses: number;
  fps: number;
  time: number;
  renderScale: number;
  quality: string;
  hdr: boolean;
}

export interface SourceOption {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly create: () => Source;
}

/** The sources the overlay can toggle. All free, keyless, and browser-native. */
export const SOURCE_OPTIONS: readonly SourceOption[] = [
  {
    id: 'wikipedia-edits',
    name: 'Wikipedia edits',
    description: 'Every human edit on Wikimedia, live. Each edit pulses at a spot fixed per page.',
    create: () => wikipediaEdits({ tickMs: 2000 }),
  },
  {
    id: 'binance-trades',
    name: 'BTC/USDT trades',
    description: 'Binance public trade stream. Big trades pulse, volatility drives turbulence.',
    create: () => binanceTrades({ symbol: 'btcusdt' }),
  },
  {
    id: 'mock',
    name: 'Mock source',
    description: 'Deterministic pseudo-random signals for testing.',
    create: () => createMockSource({ intervalMs: 900, seed: Date.now() % 100000 }),
  },
];

const isTouchDevice = (): boolean =>
  typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0;

/**
 * Everything the page needs, wired once: bus -> mapper -> renderer, driven by a FrameLoop.
 * The React overlay only talks to this object.
 */
export class AmbientStage {
  readonly bus = new DataSignalBus();
  readonly registry = new SourceRegistry(this.bus);
  readonly mapper: SignalToUniformMapper;
  readonly renderer: CanvasRenderer;
  readonly loop: FrameLoop;
  readonly themes = SHADER_MANIFESTS;
  readonly quality = new QualityController();
  readonly #sources = new Map<string, Source>();
  #qualityMode: QualityMode = 'auto';
  #frames = 0;
  #fpsWindowStart = 0;
  #fps = 0;
  #onReadout: ((r: Readout) => void) | undefined;
  #onSourceStatus: ((id: string, status: SourceStatus) => void) | undefined;
  #onError: ((message: string) => void) | undefined;
  #resizeObserver: ResizeObserver | undefined;
  readonly #onVisibility = (): void => {
    // rAF pauses in background tabs; the first window back would read as a stall.
    this.#fpsWindowStart = 0;
    this.#frames = 0;
    this.quality.reset();
  };

  constructor(canvas: HTMLCanvasElement) {
    this.mapper = new SignalToUniformMapper({ moodTau: 2.0, turbulenceTau: 1.2, currentTau: 0.8 });
    this.mapper.attach(this.bus);
    this.renderer = new CanvasRenderer({
      canvas,
      manifest: auroraDrift,
      maxPixelRatio: isTouchDevice() ? 1.5 : 2,
    });
    this.loop = new FrameLoop((dt, now) => this.#frame(dt, now));
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(canvas);
    document.addEventListener('visibilitychange', this.#onVisibility);
    this.#resize();
  }

  start(): void {
    this.loop.start();
  }

  onReadout(cb: (r: Readout) => void): void {
    this.#onReadout = cb;
  }

  onSourceStatus(cb: (id: string, status: SourceStatus) => void): void {
    this.#onSourceStatus = cb;
  }

  /** Runtime failures that should surface in the UI, such as a theme that fails to compile. */
  onError(cb: (message: string) => void): void {
    this.#onError = cb;
  }

  get themeId(): string {
    return this.renderer.manifest.id;
  }

  setTheme(id: string): boolean {
    const m = findShader(id);
    if (!m) return false;
    try {
      this.renderer.setShader(m);
    } catch (err) {
      this.#onError?.(err instanceof Error ? err.message : String(err));
      return false;
    }
    this.#onVisibility();
    return true;
  }

  get post(): PostSettings {
    return this.renderer.post;
  }

  setPost(patch: Partial<PostSettings>): PostSettings {
    return this.renderer.setPost(patch);
  }

  get qualityMode(): QualityMode {
    return this.#qualityMode;
  }

  setQualityMode(mode: QualityMode): void {
    this.#qualityMode = mode;
    if (mode === 'high') this.#applyLevel(this.quality.set(0));
    else if (mode === 'low') this.#applyLevel(this.quality.set(QUALITY_LEVELS.length - 1));
    else this.#applyLevel(this.quality.set(0));
  }

  /** Overlay sliders are just another source, so everything flows through the bus. */
  setAmbiance(moodScore: number, turbulence: number): void {
    this.bus.emitPayload({ type: 'ambiance', moodScore, turbulence }, OVERLAY_SOURCE);
  }

  setCurrent(x: number, y: number, velocity: number): void {
    this.bus.emitPayload({ type: 'current', x, y, velocity }, OVERLAY_SOURCE);
  }

  pulse(magnitude: number, location?: { x: number; y: number }): void {
    this.bus.emitPayload(
      location ? { type: 'pulse', magnitude, location } : { type: 'pulse', magnitude },
      OVERLAY_SOURCE,
    );
  }

  sourceStatus(id: string): SourceStatus {
    return this.#sources.get(id)?.status ?? 'idle';
  }

  /** Start or stop one of SOURCE_OPTIONS by id. Errors surface as the source's 'error' status. */
  async setSource(id: string, on: boolean): Promise<void> {
    let source = this.#sources.get(id);
    if (on) {
      if (!source) {
        const opt = SOURCE_OPTIONS.find((o) => o.id === id);
        if (!opt) return;
        source = opt.create();
        this.#sources.set(id, source);
        this.registry.add(source);
        source.status$.subscribe((status) => this.#onSourceStatus?.(id, status));
      }
      try {
        await source.start(this.bus);
      } catch (err) {
        console.error(`[ambient] source "${id}" failed to start`, err);
      }
    } else if (source) {
      await source.stop();
    }
  }

  dispose(): void {
    this.loop.stop();
    this.#resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.#onVisibility);
    this.mapper.dispose();
    this.renderer.dispose();
    void this.registry.dispose();
  }

  #applyLevel(level: QualityLevel): void {
    this.renderer.setRenderScale(level.renderScale);
    this.renderer.setPost({ blurIterations: level.blurIterations });
    try {
      this.renderer.setShaderQuality(level.shaderQuality);
    } catch (err) {
      this.#onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  #resize(): void {
    const [w, h] = this.renderer.resize();
    this.mapper.setResolution(w, h);
  }

  #frame(dt: number, now: number): void {
    this.mapper.tick(dt);
    const state = this.mapper.snapshot();
    this.renderer.render(state);
    this.#frames += 1;
    if (this.#fpsWindowStart === 0) {
      this.#fpsWindowStart = now;
      this.#frames = 0;
      return;
    }
    const window = now - this.#fpsWindowStart;
    if (window < 0.5) return;
    this.#fps = this.#frames / window;
    this.#frames = 0;
    this.#fpsWindowStart = now;
    if (this.#qualityMode === 'auto') {
      const next = this.quality.feed(this.#fps, window);
      if (next) this.#applyLevel(next);
    }
    this.#onReadout?.({
      mood: state.u_mood,
      turbulence: state.u_turbulence,
      current: state.u_current,
      pulse: state.u_pulse,
      energy: state.u_energy,
      livePulses: this.mapper.pulses.size,
      fps: this.#fps,
      time: state.u_time,
      renderScale: this.renderer.renderScale,
      quality: this.quality.level.name,
      hdr: this.renderer.hdr,
    });
  }
}
