import type { ReactNode } from 'react';
import type { SourceOption } from '../ambient.js';
import type { SourceView } from '../state/source-coordinator.js';

export const PHASE_LABEL = {
  autonomous: 'Autonomous',
  connecting: 'Connecting',
  live: 'Live signal',
  unavailable: 'Source unavailable',
} as const;

export function SourcePicker({
  options,
  view,
  disabled,
  onSelect,
  onRetry,
  children,
}: {
  options: readonly SourceOption[];
  view: SourceView;
  disabled: boolean;
  onSelect(id: string): void;
  onRetry(): void;
  /** Settings for the selected source, shown under the picker. */
  children?: ReactNode;
}) {
  const selected = options.find((o) => o.id === view.selected);
  return (
    <div className="source">
      <label className="select-label">
        Driven by
        <select
          value={view.selected}
          disabled={disabled}
          onChange={(e) => onSelect(e.target.value)}
          aria-describedby="source-note"
        >
          <option value="">Autonomous motion</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id === 'mock' ? 'Demo signals (simulated)' : s.name}
            </option>
          ))}
        </select>
      </label>
      <p id="source-note" className="fine-print">
        {selected
          ? `${PHASE_LABEL[view.phase]}. ${selected.description} Live data shifts the palette, motion and pulses of the look you chose.`
          : 'Live data can influence the selected look. Links and saved looks never start a feed.'}
      </p>
      {children}
      {view.phase === 'unavailable' && (
        <div className="source-failure" role="alert">
          <span>Source unavailable. The artwork keeps running on its own.</span>
          <span className="text-actions">
            <button type="button" className="text-button" onClick={onRetry}>
              Retry
            </button>
            <button type="button" className="text-button" onClick={() => onSelect('')}>
              Autonomous
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
