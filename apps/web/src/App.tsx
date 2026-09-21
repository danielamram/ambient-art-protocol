import type { SourceStatus } from '@ambient/sdk';
import { SHADER_MANIFESTS } from '@ambient/shaders';
import { useEffect, useRef, useState } from 'react';
import { AmbientStage, type QualityMode, type Readout, SOURCE_OPTIONS } from './ambient.js';

const f = (n: number) => n.toFixed(2);

const STATUS_LABEL: Record<SourceStatus, string> = {
  idle: 'off',
  starting: 'connecting',
  running: 'live',
  stopping: 'stopping',
  stopped: 'off',
  error: 'error',
};

const IDLE_MS = 3000;
const DRAG_THRESHOLD_PX = 6;

const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName);

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<AmbientStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [open, setOpen] = useState(true);
  const [idle, setIdle] = useState(false);
  const [theme, setTheme] = useState(SHADER_MANIFESTS[0]?.id ?? 'aurora-drift');
  const [mood, setMood] = useState(0.5);
  const [turbulence, setTurbulence] = useState(0.2);
  const [cx, setCx] = useState(0.5);
  const [cy, setCy] = useState(0.5);
  const [velocity, setVelocity] = useState(0);
  const [postOn, setPostOn] = useState(true);
  const [bloom, setBloom] = useState(0.65);
  const [grain, setGrain] = useState(0.3);
  const [quality, setQuality] = useState<QualityMode>('auto');
  const [sources, setSources] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, SourceStatus>>({});
  const drag = useRef<{
    x: number;
    y: number;
    t: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let stage: AmbientStage;
    try {
      stage = new AmbientStage(canvas);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    stageRef.current = stage;
    stage.onReadout(setReadout);
    stage.onSourceStatus((id, s) => setStatus((prev) => ({ ...prev, [id]: s })));
    stage.onError(setError);
    stage.start();
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    stageRef.current?.setAmbiance(mood, turbulence);
  }, [mood, turbulence]);

  useEffect(() => {
    stageRef.current?.setCurrent(cx, cy, velocity);
  }, [cx, cy, velocity]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (stage.setTheme(theme)) {
      setError(null);
      const p = stage.post;
      setBloom(p.bloom);
      setGrain(p.grain);
    }
  }, [theme]);

  useEffect(() => {
    stageRef.current?.setPost({ enabled: postOn, bloom, grain });
  }, [postOn, bloom, grain]);

  useEffect(() => {
    stageRef.current?.setQualityMode(quality);
  }, [quality]);

  // Cinema mode: hide the chrome and the cursor when nobody has touched anything for a while.
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('idle', idle);
  }, [idle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        stageRef.current?.pulse(1);
      } else if (e.key === 'h' || e.key === 'H') {
        setOpen((o) => !o);
      } else if (e.key === 'f' || e.key === 'F') {
        const el = document.documentElement;
        if (document.fullscreenElement) void document.exitFullscreen?.();
        else void el.requestFullscreen?.();
      } else if (/^[1-9]$/.test(e.key)) {
        const m = SHADER_MANIFESTS[Number(e.key) - 1];
        if (m) setTheme(m.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleSource = (id: string, on: boolean) => {
    setSources((prev) => ({ ...prev, [id]: on }));
    void stageRef.current?.setSource(id, on);
  };

  const norm = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  // Tap = pulse. Drag = steer the current; releasing hands the direction to the sliders.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = norm(e);
    drag.current = { x, y, t: e.timeStamp, startX: e.clientX, startY: e.clientY, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.dragging && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) {
      return;
    }
    d.dragging = true;
    const { x, y } = norm(e);
    const dt = Math.max(1, e.timeStamp - d.t) / 1000;
    const rect = e.currentTarget.getBoundingClientRect();
    const speedPx = Math.hypot((x - d.x) * rect.width, (y - d.y) * rect.height) / dt;
    const v = Math.min(1, speedPx / 1800);
    stageRef.current?.setCurrent(x, y, Math.max(v, velocity));
    d.x = x;
    d.y = y;
    d.t = e.timeStamp;
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const { x, y } = norm(e);
    if (d.dragging) {
      setCx(x);
      setCy(y);
      stageRef.current?.setCurrent(x, y, velocity);
    } else {
      stageRef.current?.pulse(0.9, { x, y });
    }
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
      {error && (
        <div className="error" role="alert">
          <strong>Renderer problem.</strong> {error}
        </div>
      )}
      <button
        type="button"
        className="toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? 'Hide controls' : 'Controls'}
      </button>
      <aside className="panel" hidden={!open} aria-label="Signal controls">
        <header>
          <h1>Ambient Art Protocol</h1>
          <p>
            Tap the canvas to pulse, drag to steer the current. Switch on a live source or drive the
            sliders; both emit onto the same bus.
          </p>
          <p className="keys">
            <kbd>space</kbd> pulse · <kbd>1</kbd>–<kbd>{SHADER_MANIFESTS.length}</kbd> theme ·{' '}
            <kbd>h</kbd> hide · <kbd>f</kbd> fullscreen
          </p>
        </header>

        <fieldset>
          <legend>Live sources</legend>
          {SOURCE_OPTIONS.map((opt) => {
            const s = status[opt.id] ?? 'idle';
            return (
              <label key={opt.id} className="source" title={opt.description}>
                <input
                  id={`source-${opt.id}`}
                  type="checkbox"
                  checked={sources[opt.id] ?? false}
                  onChange={(e) => toggleSource(opt.id, e.target.checked)}
                />
                <span className="source-name">{opt.name}</span>
                <span className={`status status-${s}`}>{STATUS_LABEL[s]}</span>
              </label>
            );
          })}
        </fieldset>

        <label>
          <span>Theme</span>
          <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
            {SHADER_MANIFESTS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend>Ambiance</legend>
          <Slider id="mood" label="Mood" value={mood} onChange={setMood} />
          <Slider id="turbulence" label="Turbulence" value={turbulence} onChange={setTurbulence} />
        </fieldset>

        <fieldset>
          <legend>Current</legend>
          <Slider id="cx" label="Direction X" value={cx} onChange={setCx} />
          <Slider id="cy" label="Direction Y" value={cy} onChange={setCy} />
          <Slider id="velocity" label="Velocity" value={velocity} onChange={setVelocity} />
        </fieldset>

        <fieldset>
          <legend>Look</legend>
          <label className="check">
            <input
              id="post"
              type="checkbox"
              checked={postOn}
              onChange={(e) => setPostOn(e.target.checked)}
            />
            <span className="source-name">Post FX (bloom, grain, tonemap)</span>
          </label>
          <Slider id="bloom" label="Bloom" value={bloom} onChange={setBloom} />
          <Slider id="grain" label="Grain" value={grain} onChange={setGrain} />
          <label>
            <span>Quality</span>
            <select
              id="quality"
              value={quality}
              onChange={(e) => setQuality(e.target.value as QualityMode)}
            >
              <option value="auto">Auto (adapts to frame rate)</option>
              <option value="high">High</option>
              <option value="low">Low (mobile)</option>
            </select>
          </label>
        </fieldset>

        <button type="button" id="pulse" onClick={() => stageRef.current?.pulse(1)}>
          Pulse
        </button>

        {readout && (
          <dl className="readout" aria-live="off">
            <dt>fps</dt>
            <dd>
              {readout.fps.toFixed(0)} · {readout.quality} @ {readout.renderScale.toFixed(2)}
              {readout.hdr ? ' · hdr' : ' · 8-bit'}
            </dd>
            <dt>mood</dt>
            <dd>{f(readout.mood)}</dd>
            <dt>turb</dt>
            <dd>{f(readout.turbulence)}</dd>
            <dt>current</dt>
            <dd>{readout.current.map(f).join(' ')}</dd>
            <dt>pulse</dt>
            <dd>
              {f(readout.pulse)} ({readout.livePulses} live)
            </dd>
            <dt>energy</dt>
            <dd>{f(readout.energy)}</dd>
          </dl>
        )}
      </aside>
    </>
  );
}

function Slider(props: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span>
        {props.label} <output>{f(props.value)}</output>
      </span>
      <input
        id={props.id}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
