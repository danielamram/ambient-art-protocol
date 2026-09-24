import { type ArtworkSettingsV1, defaultSettings } from './artwork-settings.js';

/**
 * Curated pairings of a built-in feed with a look made from existing controls only. A preset is
 * the one place a live source starts together with a look, and only from an explicit click: links
 * and saved looks never start a feed.
 */
export interface SourcePreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** A SOURCE_OPTIONS id. */
  readonly source: string;
  readonly settings: ArtworkSettingsV1;
}

const look = (scene: string, patch: Partial<ArtworkSettingsV1>): ArtworkSettingsV1 => ({
  ...defaultSettings(scene),
  ...patch,
});

export const SOURCE_PRESETS: readonly SourcePreset[] = [
  {
    id: 'edit-tide',
    name: 'Edit tide',
    description: 'Wikipedia edits ripple through Resonant Silk.',
    source: 'wikipedia-edits',
    settings: look('resonant-silk', { palette: 'glacier', form: 0.55, motion: 0.4 }),
  },
  {
    id: 'market-ember',
    name: 'Market ember',
    description: 'BTC/USDT trades stir Chromatic Ink.',
    source: 'binance-trades',
    settings: look('chromatic-ink', { palette: 'ember', form: 0.45, motion: 0.5 }),
  },
  {
    id: 'aurora-mirror',
    name: 'Aurora mirror',
    description: 'Real geomagnetic storms stir Aurora Drift.',
    source: 'space-weather',
    settings: look('aurora-drift', { palette: 'glacier', form: 0.5, motion: 0.35 }),
  },
  {
    id: 'bluesky-heartbeat',
    name: 'Bluesky heartbeat',
    description: 'Posts in every language pulse through Living Filaments.',
    source: 'bluesky-jetstream',
    settings: look('living-filaments', { palette: 'ember', form: 0.4, motion: 0.5 }),
  },
  {
    id: 'seismic-memory',
    name: 'Seismic memory',
    description: 'Earthquakes bloom where they strike, in Resonant Silk.',
    source: 'usgs-earthquakes',
    settings: look('resonant-silk', { palette: 'iris', form: 0.6, motion: 0.3 }),
  },
  {
    id: 'rehearsal',
    name: 'Rehearsal',
    description: 'Simulated signals drive Living Filaments. Works offline.',
    source: 'mock',
    settings: look('living-filaments', { palette: 'iris', form: 0.5, motion: 0.45 }),
  },
];
