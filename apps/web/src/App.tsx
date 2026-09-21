import { useEffect, useRef, useState } from 'react';
import { AmbientStage, type Readout } from './ambient.js';

const f = (n: number) => n.toFixed(2);

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
  const [mock, setMock] = useState(false);

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
    void stageRef.current?.setMock(mock);
  }, [mock]);

  useEffect(() => {
    stageRef.current?.setTheme(theme);
  }, [theme]);

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
            Tap the canvas to send a pulse. Sliders emit signals onto the same bus a plugin would.
          </p>
        </header>

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

        <div className="row">
          <button type="button" id="pulse" onClick={() => stageRef.current?.pulse(1)}>
            Pulse
          </button>
          <label className="check">
            <input
              id="mock"
              type="checkbox"
              checked={mock}
              onChange={(e) => setMock(e.target.checked)}
            />
            Mock source
          </label>
        </div>

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
