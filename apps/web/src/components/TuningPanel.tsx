import type { ReactNode, RefObject } from 'react';
import {
  type ArtworkSettingsV1,
  PALETTES,
  type PaletteId,
  type QualityMode,
  type SceneRegistry,
} from '../state/artwork-settings.js';
import { Slider } from './Slider.js';

export interface TuningPanelProps {
  readonly open: boolean;
  readonly panelRef: RefObject<HTMLElement | null>;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly scenes: SceneRegistry;
  readonly settings: ArtworkSettingsV1;
  /** The glow the stage is actually using: the explicit override or the scene default. */
  readonly effectiveGlow: number;
  readonly quality: QualityMode;
  onClose(): void;
  onScene(id: string): void;
  onPalette(id: PaletteId): void;
  onForm(v: number): void;
  onMotion(v: number): void;
  onGlow(v: number): void;
  onResetLighting(): void;
  onResetArtwork(): void;
  onQuality(q: QualityMode): void;
  /** Look actions (save/share), placed under the sliders. */
  readonly actions?: ReactNode;
  readonly looks?: ReactNode;
  readonly source: ReactNode;
  readonly diagnostics?: ReactNode;
  readonly shortcuts: string;
}

/**
 * A non-modal side panel: the canvas stays usable while it is open, so there is no focus trap
 * and no aria-modal. `hidden` removes every control from the tab order when closed.
 */
export function TuningPanel(p: TuningPanelProps) {
  return (
    <aside
      ref={p.panelRef}
      id="tuning"
      className="panel"
      hidden={!p.open}
      aria-labelledby="tuning-heading"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ART DIRECTION</span>
          <h2 id="tuning-heading" ref={p.headingRef} tabIndex={-1}>
            Make it yours.
          </h2>
        </div>
        <button
          type="button"
          className="round-button"
          aria-label="Close controls"
          onClick={p.onClose}
        >
          ×
        </button>
      </div>
      <label className="select-label">
        Scene
        <select value={p.settings.scene} onChange={(e) => p.onScene(e.target.value)}>
          {p.scenes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="palette">
        <legend>Palette</legend>
        {PALETTES.map((palette) => (
          <button
            type="button"
            key={palette.id}
            className={p.settings.palette === palette.id ? 'chosen' : ''}
            aria-pressed={p.settings.palette === palette.id}
            onClick={() => p.onPalette(palette.id)}
          >
            <i style={{ background: palette.color }} />
            {palette.name}
          </button>
        ))}
      </fieldset>
      <Slider label="Form" value={p.settings.form} onChange={p.onForm} />
      <Slider label="Motion" value={p.settings.motion} onChange={p.onMotion} />
      <Slider
        label="Glow"
        value={p.effectiveGlow}
        onChange={p.onGlow}
        {...(p.settings.glow === null ? { hint: 'scene default' } : {})}
      />
      {p.actions}
      {p.looks}
      {p.source}
      <details>
        <summary>Studio settings</summary>
        <div className="studio">
          <label className="select-label">
            Quality on this device
            <select value={p.quality} onChange={(e) => p.onQuality(e.target.value as QualityMode)}>
              <option value="auto">Adaptive</option>
              <option value="high">Full detail</option>
              <option value="low">Lightweight</option>
            </select>
          </label>
          <div className="text-actions">
            <button type="button" className="text-button" onClick={p.onResetLighting}>
              Reset scene lighting
            </button>
            <button type="button" className="text-button" onClick={p.onResetArtwork}>
              Reset artwork
            </button>
          </div>
          <p className="fine-print">
            Reset artwork restores the palette, form, motion and glow for this scene. Pause and
            quality stay as they are.
          </p>
          {p.diagnostics}
          <p className="shortcuts">{p.shortcuts}</p>
        </div>
      </details>
      <p className="panel-note">Real-time light. No two moments alike.</p>
    </aside>
  );
}
