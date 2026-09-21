import { CanvasRenderer, FrameLoop, SignalToUniformMapper } from '@ambient/engine';
import { DataSignalBus, type Source, SourceRegistry } from '@ambient/sdk';
import { createMockSource } from '@ambient/sdk/testing';
import { auroraDrift, findShader, SHADER_MANIFESTS } from '@ambient/shaders';

export const OVERLAY_SOURCE = 'overlay';

export interface Readout {
  mood: number;
  turbulence: number;
  current: readonly [number, number, number];
  pulse: number;
  livePulses: number;
  fps: number;
  time: number;
}

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
  #mock: Source | undefined;
  #frames = 0;
  #fpsWindowStart = 0;
  #fps = 0;
  #onReadout: ((r: Readout) => void) | undefined;
  #resizeObserver: ResizeObserver | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.mapper = new SignalToUniformMapper({ moodTau: 2.0, turbulenceTau: 1.2, currentTau: 0.8 });
    this.mapper.attach(this.bus);
    this.renderer = new CanvasRenderer({ canvas, manifest: auroraDrift });
    this.loop = new FrameLoop((dt, now) => this.#frame(dt, now));
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(canvas);
    this.#resize();
  }

  start(): void {
    this.loop.start();
  }

  onReadout(cb: (r: Readout) => void): void {
    this.#onReadout = cb;
  }

  setTheme(id: string): void {
    const m = findShader(id);
    if (m) this.renderer.setShader(m);
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

  get mockRunning(): boolean {
    return this.#mock?.status === 'running';
  }

  async setMock(on: boolean): Promise<void> {
    if (on) {
      if (!this.#mock) {
        this.#mock = createMockSource({ intervalMs: 900, seed: Date.now() % 100000 });
        this.registry.add(this.#mock);
      }
      await this.#mock.start(this.bus);
    } else if (this.#mock) {
      await this.#mock.stop();
    }
  }

  dispose(): void {
    this.loop.stop();
    this.#resizeObserver?.disconnect();
    this.mapper.dispose();
    this.renderer.dispose();
    void this.registry.dispose();
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
    if (now - this.#fpsWindowStart >= 0.5) {
      this.#fps = this.#frames / (now - this.#fpsWindowStart);
      this.#frames = 0;
      this.#fpsWindowStart = now;
      this.#onReadout?.({
        mood: state.u_mood,
        turbulence: state.u_turbulence,
        current: state.u_current,
        pulse: state.u_pulse,
        livePulses: this.mapper.pulses.size,
        fps: this.#fps,
        time: state.u_time,
      });
    }
  }
}
