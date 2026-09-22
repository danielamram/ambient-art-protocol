import { SHADER_MANIFESTS } from '@ambient/shaders';
import { useEffect, useRef, useState } from 'react';
import { AmbientStage, type QualityMode, type Readout, SOURCE_OPTIONS } from './ambient.js';

const COLLECTION = SHADER_MANIFESTS.slice(0, 3);
const PALETTES = [
  { name: 'Glacier', value: 0, color: '#9adfcd' },
  { name: 'Ember', value: 0.5, color: '#e8a26a' },
  { name: 'Iris', value: 1, color: '#b7a0ec' },
];
const initialTheme = (): string => {
  const id = new URLSearchParams(location.search).get('scene');
  return SHADER_MANIFESTS.find((m) => m.id === id)?.id ?? 'living-filaments';
};
const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName));

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<AmbientStage | null>(null);
  const panel = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const pointer = useRef<number | null>(null);
  const sourceChange = useRef(Promise.resolve());
  const [theme, setTheme] = useState(initialTheme);
  const [open, setOpen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mood, setMood] = useState(0);
  const [form, setForm] = useState(0.45);
  const [motion, setMotion] = useState(0.45);
  const [bloom, setBloom] = useState(0.28);
  const [quality, setQuality] = useState<QualityMode>('auto');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('Autonomous');
  const [readout, setReadout] = useState<Readout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const capture = new URLSearchParams(location.search).has('capture');
  const active = SHADER_MANIFESTS.find((m) => m.id === theme) ?? SHADER_MANIFESTS[0];

  useEffect(() => {
    if (!canvas.current) return;
    let instance: AmbientStage;
    try {
      instance = new AmbientStage(canvas.current);
      stage.current = instance;
      instance.setAmbiance(0, 0.2);
      instance.setTheme(initialTheme());
      setBloom(instance.post.bloom);
      instance.onReadout(setReadout);
      instance.onError(setError);
      instance.onSourceStatus((_id, s) =>
        setStatus(
          s === 'running'
            ? 'Live signal'
            : s === 'error'
              ? 'Source unavailable'
              : s === 'starting'
                ? 'Connecting'
                : 'Autonomous',
        ),
      );
      instance.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    return () => {
      stage.current = null;
      instance.dispose();
    };
  }, []);

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

  const selectTheme = (id: string) => {
    const s = stage.current;
    if (!s?.setTheme(id)) return;
    s.setPaused(false);
    setPaused(false);
    setTheme(id);
    setBloom(s.resetLook().bloom);
    setError(null);
  };
  const pause = () => {
    const s = stage.current;
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
        stage.current?.pulse(0.65);
      } else if (e.key.toLowerCase() === 'p') pause();
      else if (e.key.toLowerCase() === 'h') setOpen((v) => !v);
      else if (e.key.toLowerCase() === 'f') fullscreen();
      else if (/^[1-6]$/.test(e.key)) {
        const next = SHADER_MANIFESTS[Number(e.key) - 1];
        if (next) selectTheme(next.id);
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
    stage.current?.setPointer(p.x, p.y, false);
    if (pulse) stage.current?.pulse(0.7, p);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const changeSource = (id: string) => {
    setSource(id);
    // Serialize changes: two feeds never compete for the palette/current accidentally.
    sourceChange.current = sourceChange.current
      .then(async () => {
        const s = stage.current;
        if (!s) return;
        for (const opt of SOURCE_OPTIONS) await s.setSource(opt.id, false);
        if (id) await s.setSource(id, true);
        else {
          s.setAmbiance(mood, 0.2);
          s.setCurrent(0.5, 0.5, 0);
          setStatus('Autonomous');
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
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
          stage.current?.setPointer(p.x, p.y, true);
        }}
        onPointerMove={(e) => {
          if (pointer.current === e.pointerId) {
            const p = position(e);
            stage.current?.setPointer(p.x, p.y, true);
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
          <span className={`live-label ${source ? 'connected' : ''}`}>
            <i />
            {status}
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
          {String(SHADER_MANIFESTS.findIndex((m) => m.id === theme) + 1).padStart(2, '0')} /
          GENERATIVE STUDIES
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
              className={theme === m.id ? 'selected' : ''}
              aria-pressed={theme === m.id}
              onClick={() => selectTheme(m.id)}
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
      <aside ref={panel} id="tuning" className="panel" hidden={!open} aria-label="Tune artwork">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ART DIRECTION</span>
            <h2>Make it yours.</h2>
          </div>
          <button
            type="button"
            className="round-button"
            aria-label="Close controls"
            onClick={() => {
              setOpen(false);
              toggle.current?.focus();
            }}
          >
            ×
          </button>
        </div>
        <label className="select-label">
          Scene
          <select value={theme} onChange={(e) => selectTheme(e.target.value)}>
            {SHADER_MANIFESTS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="palette">
          <legend>Palette</legend>
          {PALETTES.map((p) => (
            <button
              type="button"
              key={p.name}
              className={mood === p.value ? 'chosen' : ''}
              aria-pressed={mood === p.value}
              onClick={() => {
                setMood(p.value);
                stage.current?.setAmbiance(p.value, 0.2);
              }}
            >
              <i style={{ background: p.color }} />
              {p.name}
            </button>
          ))}
        </fieldset>
        <Slider
          label="Form"
          value={form}
          onChange={(v) => {
            setForm(v);
            if (stage.current) {
              stage.current.form = v;
              stage.current.invalidate();
            }
          }}
        />
        <Slider
          label="Motion"
          value={motion}
          onChange={(v) => {
            setMotion(v);
            if (stage.current) stage.current.clock.motion = v;
          }}
        />
        <Slider
          label="Glow"
          value={bloom}
          onChange={(v) => {
            setBloom(v);
            stage.current?.setPost({ bloom: v });
          }}
        />
        <label className="select-label">
          Driven by
          <select value={source} disabled={capture} onChange={(e) => changeSource(e.target.value)}>
            <option value="">Autonomous motion</option>
            {SOURCE_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === 'mock' ? 'Demo signals (simulated)' : s.name}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary>Studio settings</summary>
          <label className="select-label">
            Quality
            <select
              value={quality}
              onChange={(e) => {
                const q = e.target.value as QualityMode;
                setQuality(q);
                stage.current?.setQualityMode(q);
              }}
            >
              <option value="auto">Adaptive</option>
              <option value="high">Full detail</option>
              <option value="low">Lightweight</option>
            </select>
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              const p = stage.current?.resetLook();
              if (p) setBloom(p.bloom);
            }}
          >
            Reset scene lighting
          </button>
          {readout && (
            <p className="readout">
              {readout.fps.toFixed(0)} fps · {readout.quality} · {readout.hdr ? 'HDR' : 'standard'}
            </p>
          )}
          <p className="shortcuts">1–6 scenes · P pause · F fullscreen · Space pulse</p>
        </details>
        <p className="panel-note">Real-time light. No two moments alike.</p>
      </aside>
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
function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span>
        {label}
        <output>{Math.round(value * 100)}%</output>
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
