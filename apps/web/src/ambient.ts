import {
  ArtClock,
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
import { findShader, livingFilaments, SHADER_MANIFESTS } from '@ambient/shaders';
import { binanceTrades, wikipediaEdits } from '@ambient/sources';
import type { Subscription } from 'rxjs';

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
  readonly clock = new ArtClock();
  form = 0.45;
  #pointer: [number, number, number] = [0.5, 0.5, 0];
  #pointerTarget: [number, number, number] = [0.5, 0.5, 0];
  readonly #motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  readonly #onMotion = (): void => {
    this.clock.reduced = this.#motionQuery.matches;
  };
  #captureTime: number | undefined;
  #dirty = true;
  #lastWall = 0;
  readonly #onRestore = (): void => {
    this.#dirty = true;
  };

  readonly #sources = new Map<string, Source>();
  readonly #statusSubscriptions: Subscription[] = [];
  #disposed = false;
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
      manifest: livingFilaments,
      maxPixelRatio: isTouchDevice() ? 1.5 : 2,
    });
    this.loop = new FrameLoop((dt, now) => this.#frame(dt, now));
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(canvas);
    document.addEventListener('visibilitychange', this.#onVisibility);
    this.#resize();
    this.#onMotion();
    this.#motionQuery.addEventListener('change', this.#onMotion);
    canvas.addEventListener('webglcontextrestored', this.#onRestore);
    // Explicit deterministic capture mode: fixed time, no sources and no adaptive quality.
    const query = new URLSearchParams(location.search);
    const at = Number(query.get('time'));
    if (query.has('capture') && Number.isFinite(at)) {
      this.#captureTime = Math.max(0, Math.min(at, 3600));
      this.#qualityMode = 'high';
    }
  }

  /** True for `?capture` URLs: fixed shader time, forced quality, no live sources. */
  get captureMode(): boolean {
    return this.#captureTime !== undefined;
  }

  setPaused(paused: boolean): void {
    this.clock.paused = paused;
    this.#onVisibility();
  }

  invalidate(): void {
    this.#dirty = true;
  }

  setPointer(x: number, y: number, down: boolean): void {
    this.#pointerTarget = [x, y, down ? 1 : 0];
    this.#dirty = true;
  }

  resetLook(): PostSettings {
    this.#dirty = true;
    return this.renderer.clearPost('bloom', 'grain', 'aberration', 'vignette', 'bloomThreshold');
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
      this.#dirty = true;
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
    this.#dirty = true;
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
    this.#dirty = true;
    this.bus.emitPayload({ type: 'ambiance', moodScore, turbulence }, OVERLAY_SOURCE);
  }

  setCurrent(x: number, y: number, velocity: number): void {
    this.#dirty = true;
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
      if (this.#disposed) return;
      if (!source) {
        const opt = SOURCE_OPTIONS.find((o) => o.id === id);
        if (!opt) return;
        source = opt.create();
        this.#sources.set(id, source);
        this.registry.add(source);
        this.#statusSubscriptions.push(
          source.status$.subscribe((status) => this.#onSourceStatus?.(id, status)),
        );
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
    this.#disposed = true;
    // Late status transitions from the async registry shutdown must not reach an unmounted UI.
    for (const sub of this.#statusSubscriptions.splice(0)) sub.unsubscribe();
    this.loop.stop();
    this.#resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.#onVisibility);
    this.renderer.canvas.removeEventListener('webglcontextrestored', this.#onRestore);
    this.#motionQuery.removeEventListener('change', this.#onMotion);
    this.mapper.dispose();
    this.renderer.dispose();
    void this.registry.dispose();
  }

  #applyLevel(level: QualityLevel): void {
    this.#dirty = true;
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
    this.#dirty = true;
  }

  #frame(dt: number, now: number): void {
    const wallDt = this.#lastWall ? Math.max(0, Math.min(2, now - this.#lastWall)) : dt;
    this.#lastWall = now;
    if (
      this.clock.paused &&
      !this.#dirty &&
      !this.renderer.transitioning &&
      this.#captureTime === undefined
    ) {
      // Stop GPU work too. The existing canvas remains visible until playback resumes.
      return;
    }
    const artDt = this.clock.advance(dt);
    this.mapper.tick(artDt);
    const state = this.mapper.snapshot();
    state.u_time = this.#captureTime ?? this.clock.time;
    state.u_dt = this.#captureTime === undefined ? artDt : 1 / 60;
    const blend = 1 - Math.exp(-dt * 7);
    this.#pointer = this.#pointer.map(
      (v, i) => v + ((this.#pointerTarget[i] ?? v) - v) * blend,
    ) as [number, number, number];
    this.renderer.setArt(this.form, this.#pointer);
    this.renderer.render(state, wallDt);
    this.#dirty = false;
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
