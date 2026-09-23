import type { SourceStatus } from '@ambient/sdk';
import { SHADER_MANIFESTS } from '@ambient/shaders';
import { useEffect, useRef, useState } from 'react';
import { type Readout, SOURCE_OPTIONS } from './ambient.js';
import { PHASE_LABEL, SourcePicker } from './components/SourcePicker.js';
import { TuningPanel } from './components/TuningPanel.js';
import { useAmbientStage } from './hooks/use-ambient-stage.js';
import { useSourceSelection } from './hooks/use-source-selection.js';
import { applySettings } from './state/apply-settings.js';
import {
  type ArtworkSettingsV1,
  DEFAULT_SCENE,
  defaultSettings,
  hasScene,
  type PaletteId,
  paletteOf,
  type QualityMode,
  resetArtwork,
  withScene,
} from './state/artwork-settings.js';

const COLLECTION = SHADER_MANIFESTS.slice(0, 3);
const initialSettings = (): ArtworkSettingsV1 => {
  const id = new URLSearchParams(location.search).get('scene');
  return defaultSettings(hasScene(SHADER_MANIFESTS, id) ? id : DEFAULT_SCENE);
};
const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName));

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const pointer = useRef<number | null>(null);
  const [initial] = useState(() => ({ settings: initialSettings(), quality: 'auto' as const }));
  const [settings, setSettings] = useState<ArtworkSettingsV1>(initial.settings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [glow, setGlow] = useState(0.28);
  const [quality, setQuality] = useState<QualityMode>(initial.quality);
  const [open, setOpen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [paused, setPaused] = useState(false);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const capture = new URLSearchParams(location.search).has('capture');
  const active = SHADER_MANIFESTS.find((m) => m.id === settings.scene) ?? SHADER_MANIFESTS[0];

  const sourceStatus = useRef<(id: string, s: SourceStatus) => void>(() => undefined);
  const { handle, mounted } = useAmbientStage(canvas, initial, {
    onReadout: setReadout,
    onError: setError,
    onSourceStatus: (id, s) => sourceStatus.current(id, s),
  });
  const sources = useSourceSelection(handle, mounted, () => {
    // Autonomous: the overlay's own signals again, from the settings selected *now*.
    const h = handle.current;
    h?.art.setPalette(paletteOf(settingsRef.current.palette).mood);
    h?.stage.setCurrent(0.5, 0.5, 0);
  });
  sourceStatus.current = sources.onStatus;
  useEffect(() => {
    if (!mounted) return;
    setSettings(mounted.settings);
    setGlow(mounted.glow);
  }, [mounted]);

  useEffect(() => {
    let timer = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!panel.current?.contains(document.activeElement)) setIdle(true);
      }, 7000);
    };
    for (const event of ['pointermove', 'pointerdown', 'keydown', 'focusin'])
      window.addEventListener(event, wake);
    wake();
    return () => {
      window.clearTimeout(timer);
      for (const event of ['pointermove', 'pointerdown', 'keydown', 'focusin'])
        window.removeEventListener(event, wake);
    };
  }, []);

  /** Apply a complete look through the one ordered path; UI changes only after the stage agrees. */
  const applyLook = (next: ArtworkSettingsV1): boolean => {
    const h = handle.current;
    if (!h) return false;
    const result = applySettings(h.art, next, settingsRef.current);
    if (!result.ok) {
      if (result.reason === 'apply') setError('That look could not be applied.');
      return false;
    }
    setSettings(next);
    setGlow(result.glow);
    setError(null);
    return true;
  };
  const selectScene = (id: string) => {
    if (id !== settingsRef.current.scene) applyLook(withScene(settingsRef.current, id));
  };
  const update = (patch: Partial<ArtworkSettingsV1>, write: () => void) => {
    write();
    setSettings((s) => ({ ...s, ...patch }));
  };
  const setPalette = (palette: PaletteId) =>
    update({ palette }, () => handle.current?.art.setPalette(paletteOf(palette).mood));
  const setForm = (form: number) => update({ form }, () => handle.current?.art.setForm(form));
  const setMotion = (motion: number) =>
    update({ motion }, () => handle.current?.art.setMotion(motion));
  const setGlowOverride = (value: number) =>
    update({ glow: value }, () => {
      const g = handle.current?.art.setGlow(value);
      if (g !== undefined) setGlow(g);
    });
  const resetLighting = () => {
    const g = handle.current?.art.clearLighting();
    if (g === undefined) return;
    setGlow(g);
    setSettings((s) => ({ ...s, glow: null }));
  };
  const pause = () => {
    const s = handle.current?.stage;
    if (!s) return;
    s.setPaused(!s.clock.paused);
    setPaused(s.clock.paused);
  };
  const fullscreen = () => {
    const action = document.fullscreenElement
      ? document.exitFullscreen?.()
      : document.documentElement.requestFullscreen?.();
    void action?.catch(() => setError('Fullscreen is not available in this browser.'));
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
        return;
      }
      if (editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        handle.current?.stage.pulse(0.65);
      } else if (e.key.toLowerCase() === 'p') pause();
      else if (e.key.toLowerCase() === 'h') setOpen((v) => !v);
      else if (e.key.toLowerCase() === 'f') fullscreen();
      else if (/^[1-9]$/.test(e.key)) {
        const next = SHADER_MANIFESTS[Number(e.key) - 1];
        if (next) selectScene(next.id);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const position = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };
  const release = (e: React.PointerEvent<HTMLCanvasElement>, pulse: boolean) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    const p = position(e);
    handle.current?.stage.setPointer(p.x, p.y, false);
    if (pulse) handle.current?.stage.pulse(0.7, p);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const closePanel = () => {
    setOpen(false);
    toggle.current?.focus();
  };

  return (
    <main className={`experience ${idle && !open ? 'is-idle' : ''} ${capture ? 'is-capture' : ''}`}>
      <canvas
        ref={canvas}
        className="stage"
        aria-label="Interactive generative artwork. Hold to gather light, release to send a pulse."
        onPointerDown={(e) => {
          if (pointer.current !== null) return;
          pointer.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = position(e);
          handle.current?.stage.setPointer(p.x, p.y, true);
        }}
        onPointerMove={(e) => {
          if (pointer.current === e.pointerId) {
            const p = position(e);
            handle.current?.stage.setPointer(p.x, p.y, true);
          }
        }}
        onPointerUp={(e) => release(e, true)}
        onPointerCancel={(e) => release(e, false)}
        onLostPointerCapture={(e) => release(e, false)}
      />
      <header className="masthead chrome">
        <a className="wordmark" href="./" aria-label="Ambient Art Protocol home">
          <span className="mark" aria-hidden="true">
            ◎
          </span>
          <span>
            AMBIENT<span className="wordmark-sub">ART PROTOCOL</span>
          </span>
        </a>
        <div className="header-right">
          <span className={`live-label ${sources.view.phase === 'live' ? 'connected' : ''}`}>
            <i />
            {PHASE_LABEL[sources.view.phase]}
          </span>
          <button
            type="button"
            ref={toggle}
            className="round-button"
            onClick={() => setOpen(!open)}
            aria-label="Tune artwork"
            aria-expanded={open}
            aria-controls="tuning"
          >
            ☷
          </button>
        </div>
      </header>
      <div className="art-caption chrome">
        <span className="eyebrow">
          {String(SHADER_MANIFESTS.findIndex((m) => m.id === settings.scene) + 1).padStart(2, '0')}{' '}
          / GENERATIVE STUDIES
        </span>
        <h1>{active?.name}</h1>
        <p>{active?.description}</p>
      </div>
      <footer className="bottom chrome">
        <nav className="collection" aria-label="Artwork collection">
          {COLLECTION.map((m, i) => (
            <button
              type="button"
              key={m.id}
              className={settings.scene === m.id ? 'selected' : ''}
              aria-pressed={settings.scene === m.id}
              onClick={() => selectScene(m.id)}
            >
              <span className="scene-number">0{i + 1}</span>
              {m.name}
              <span className="selected-dot" />
            </button>
          ))}
        </nav>
        <div className="transport">
          <span className="gesture-hint">Hold to gather · release to resonate</span>
          <button
            type="button"
            className="round-button"
            onClick={pause}
            aria-label={paused ? 'Play animation' : 'Pause animation'}
          >
            {paused ? '▷' : 'Ⅱ'}
          </button>
          <button
            type="button"
            className="round-button fullscreen"
            onClick={fullscreen}
            aria-label="Fullscreen"
          >
            ⛶
          </button>
        </div>
      </footer>
      <TuningPanel
        open={open}
        panelRef={panel}
        headingRef={heading}
        scenes={SHADER_MANIFESTS}
        settings={settings}
        effectiveGlow={glow}
        quality={quality}
        onClose={closePanel}
        onScene={selectScene}
        onPalette={setPalette}
        onForm={setForm}
        onMotion={setMotion}
        onGlow={setGlowOverride}
        onResetLighting={resetLighting}
        onResetArtwork={() => applyLook(resetArtwork(settingsRef.current))}
        onQuality={(q) => {
          setQuality(q);
          handle.current?.stage.setQualityMode(q);
        }}
        source={
          <SourcePicker
            options={SOURCE_OPTIONS}
            view={sources.view}
            disabled={capture}
            onSelect={(id) => void sources.select(id)}
            onRetry={() => void sources.retry()}
          />
        }
        diagnostics={
          readout && (
            <p className="readout">
              {readout.fps.toFixed(0)} fps · {readout.quality} · {readout.hdr ? 'HDR' : 'standard'}
            </p>
          )
        }
        shortcuts="1–6 scenes · P pause · F fullscreen · Space pulse"
      />
      {error && (
        <div className="error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
    </main>
  );
}
