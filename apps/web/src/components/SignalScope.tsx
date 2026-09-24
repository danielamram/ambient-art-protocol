import {
  SCOPE_CHANNELS,
  SCOPE_LABEL,
  type SignalScope as Scope,
  sparklinePath,
} from '../state/signal-scope.js';

const W = 120;
const H = 22;

/**
 * Tiny sparklines of what reaches the bus: the input to the artwork, not the rendered result.
 * The graphs are decorative; each row states its latest value in text. Nothing is announced
 * as it updates.
 */
export function SignalScope({
  scope,
  windowSeconds,
  open,
  onToggle,
}: {
  scope: Scope;
  windowSeconds: number;
  open: boolean;
  onToggle(open: boolean): void;
}) {
  return (
    <details
      className="scope"
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>Signal scope</summary>
      {open && (
        <>
          <ul className="scope-rows">
            {SCOPE_CHANNELS.map((ch) => {
              const latest = scope.latest(ch);
              return (
                <li key={ch} className={`scope-row scope-${ch}`}>
                  <span className="scope-label">{SCOPE_LABEL[ch]}</span>
                  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
                    <line className="scope-base" x1="0" y1={H} x2={W} y2={H} />
                    <path d={sparklinePath(scope.series(ch), scope.length, W, H)} />
                  </svg>
                  <span className="scope-value">
                    {latest === null ? '–' : `${Math.round(latest * 100)}%`}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="fine-print">
            Everything reaching the artwork over the last {windowSeconds} s, including your own taps
            and palette. Pulses show the strongest in each moment.
          </p>
        </>
      )}
    </details>
  );
}
