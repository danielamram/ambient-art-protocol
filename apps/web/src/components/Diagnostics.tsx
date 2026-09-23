import { useEffect, useRef, useState } from 'react';
import type { Readout } from '../ambient.js';
import { TIER_LABEL } from '../state/diagnostics.js';

/**
 * Existing measurements only: the stage's aggregate fps sample, its effective quality tier and
 * render scale, and whether the internal float render target is available. The last is about
 * the offscreen buffers, not whether the display presents HDR.
 */
export function Diagnostics({
  readout,
  onCopy,
}: {
  readout: Readout | null;
  onCopy(): Promise<{ outcome: 'copied' | 'manual'; text: string }>;
}) {
  const [manual, setManual] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (manual) area.current?.select();
  }, [manual]);
  return (
    <div className="diagnostics">
      <dl className="readout">
        <div>
          <dt>Frame rate</dt>
          <dd>{readout ? `${readout.fps.toFixed(0)} fps` : 'No sample yet'}</dd>
        </div>
        <div>
          <dt>Quality tier</dt>
          <dd>{readout ? (TIER_LABEL[readout.quality] ?? readout.quality) : '–'}</dd>
        </div>
        <div>
          <dt>Render scale</dt>
          <dd>{readout ? `${Math.round(readout.renderScale * 100)}%` : '–'}</dd>
        </div>
        <div>
          <dt>Float render target</dt>
          <dd>{readout ? (readout.hdr ? 'Available' : 'Unavailable (8-bit)') : '–'}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="text-button"
        onClick={async () => {
          const r = await onCopy();
          setManual(r.outcome === 'manual' ? r.text : null);
        }}
      >
        Copy diagnostics
      </button>
      {manual && (
        <label className="select-label">
          Copying is not available here. Select the report and copy it yourself:
          <textarea ref={area} readOnly rows={6} value={manual} />
        </label>
      )}
      <p className="fine-print">Stays on this device unless you paste it somewhere.</p>
    </div>
  );
}
