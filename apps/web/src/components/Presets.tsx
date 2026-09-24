import type { SourcePreset } from '../state/presets.js';

/** Curated feed + look pairings. Choosing one starts that feed; nothing else ever does. */
export function Presets({
  presets,
  disabled,
  onApply,
}: {
  presets: readonly SourcePreset[];
  disabled: boolean;
  onApply(preset: SourcePreset): void;
}) {
  return (
    <fieldset className="presets" disabled={disabled}>
      <legend>Pairings</legend>
      <div className="preset-list">
        {presets.map((p) => (
          <button
            type="button"
            key={p.id}
            className="preset"
            aria-describedby={`preset-${p.id}`}
            onClick={() => onApply(p)}
          >
            <span className="preset-name">{p.name}</span>
            <span id={`preset-${p.id}`} className="preset-note">
              {p.description}
            </span>
          </button>
        ))}
      </div>
      <p className="fine-print">Starts that live feed with a matching look.</p>
    </fieldset>
  );
}
