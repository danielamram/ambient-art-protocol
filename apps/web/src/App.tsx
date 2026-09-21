import type { SourceStatus } from '@ambient/sdk';
import { useEffect, useRef, useState } from 'react';
import { AmbientStage, type Readout, SOURCE_OPTIONS } from './ambient.js';

const f = (n: number) => n.toFixed(2);

const STATUS_LABEL: Record<SourceStatus, string> = {
  idle: 'off',
  starting: 'connecting',
  running: 'live',
  stopping: 'stopping',
  stopped: 'off',
  error: 'error',
};

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<AmbientStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [open, setOpen] = useState(true);
  const [theme, setTheme] = useState('aurora-drift');
  const [mood, setMood] = useState(0.5);
  const [turbulence, setTurbulence] = useState(0.2);
  const [cx, setCx] = useState(0.5);
  const [cy, setCy] = useState(0.5);
  const [velocity, setVelocity] = useState(0);
  const [sources, setSources] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, SourceStatus>>({});

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
    stageRef.current?.setTheme(theme);
  }, [theme]);

  const toggleSource = (id: string, on: boolean) => {
    setSources((prev) => ({ ...prev, [id]: on }));
    void stageRef.current?.setSource(id, on);
  };

  const onCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    stageRef.current?.pulse(0.9, { x, y });
  };

  return (
    <>
      <canvas ref={canvasRef} className="stage" onPointerDown={onCanvasPointer} />
      {error && (
        <div className="error" role="alert">
          <strong>Could not start the renderer.</strong> {error}
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
            Tap the canvas to send a pulse. Switch on a live source, or drive the sliders yourself;
            both emit onto the same bus.
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
            {stageRef.current?.themes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            )) ?? <option value="aurora-drift">Aurora Drift</option>}
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

        <button type="button" id="pulse" onClick={() => stageRef.current?.pulse(1)}>
          Pulse
        </button>

        {readout && (
          <dl className="readout" aria-live="off">
            <dt>fps</dt>
            <dd>{readout.fps.toFixed(0)}</dd>
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
