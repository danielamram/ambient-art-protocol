import type { SourceStatus } from '@ambient/sdk';
import { SHADER_MANIFESTS } from '@ambient/shaders';
import { useEffect, useRef, useState } from 'react';
import { type Readout, SOURCE_OPTIONS } from './ambient.js';
import { NoticeRegion } from './components/NoticeRegion.js';
import { SavedLooks } from './components/SavedLooks.js';
import { PHASE_LABEL, SourcePicker } from './components/SourcePicker.js';
import { TuningPanel } from './components/TuningPanel.js';
import { useAmbientStage } from './hooks/use-ambient-stage.js';
import { useCanvasPointer } from './hooks/use-canvas-pointer.js';
import { useIdleChrome, useShortcuts } from './hooks/use-experience-controls.js';
import { useFullscreen } from './hooks/use-fullscreen.js';
import { useNotices } from './hooks/use-notices.js';
import { useSavedLooks } from './hooks/use-saved-looks.js';
import { useSourceSelection } from './hooks/use-source-selection.js';
import { applySettings } from './state/apply-settings.js';
import {
  type ArtworkSettingsV1,
  DEFAULT_DEVICE,
  type PaletteId,
  paletteOf,
  type QualityMode,
  resetArtwork,
  settingsEqual,
  withScene,
} from './state/artwork-settings.js';
import {
  ADJUSTED_NOTICE,
  decodeLookFragment,
  resolveStartup,
  shareUrl,
} from './state/look-codec.js';
import {
  browserStore,
  newLookId,
  normalizeName,
  readDevicePreferences,
  readLastLook,
  type SavedLookV1,
  STORAGE_KEYS,
  writeJson,
} from './state/look-storage.js';
import { type ShareEnvironment, shareLink } from './state/share.js';

const COLLECTION = SHADER_MANIFESTS.slice(0, 3);
const LAST_LOOK_DEBOUNCE_MS = 400;
const NOT_SAVED =
  'Changes could not be saved on this device. They will last until this tab closes.';
/** Bound navigator methods: calling an unbound `navigator.share` throws. */
const shareEnvironment = (): ShareEnvironment => ({
  ...(typeof navigator.share === 'function' ? { share: (d) => navigator.share(d) } : {}),
  ...(navigator.clipboard ? { clipboard: navigator.clipboard } : {}),
});

/** Everything decided once, before the stage exists. */
function boot() {
  const capture = new URLSearchParams(location.search).has('capture');
  const store = browserStore(() => window.localStorage);
  const startup = resolveStartup({
    search: location.search,
    hash: location.hash,
    // Capture mode bypasses anything saved on this device.
    stored: capture ? null : readLastLook(store, SHADER_MANIFESTS),
    scenes: SHADER_MANIFESTS,
  });
  const device = capture ? DEFAULT_DEVICE : (readDevicePreferences(store) ?? DEFAULT_DEVICE);
  return { capture, store, startup, device };
}

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const [{ capture, store, startup, device }] = useState(boot);
  const [initial] = useState(() => ({ settings: startup.settings, quality: device.quality }));
  const [settings, setSettings] = useState<ArtworkSettingsV1>(initial.settings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** Only user-initiated changes are remembered as the last look, never startup fallbacks. */
  const userChanged = useRef(false);
  const [glow, setGlow] = useState(0.28);
  const [quality, setQuality] = useState<QualityMode>(initial.quality);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { notice, notify, dismiss } = useNotices(!capture);
  const saved = useSavedLooks(store, SHADER_MANIFESTS, notify);
  const active = SHADER_MANIFESTS.find((m) => m.id === settings.scene) ?? SHADER_MANIFESTS[0];

  const sourceStatus = useRef<(id: string, s: SourceStatus) => void>(() => undefined);
  const { handle, mounted } = useAmbientStage(canvas, initial, {
    onReadout: setReadout,
    onError: setError,
    onSourceStatus: (id, s) => sourceStatus.current(id, s),
  });
  const sources = useSourceSelection(handle, mounted, () => {
    // Autonomous: the overlay's own signals again, from the settings selected *now*.
    const h = handle.current;
    h?.art.setPalette(paletteOf(settingsRef.current.palette).mood);
    h?.stage.setCurrent(0.5, 0.5, 0);
  });
  sourceStatus.current = sources.onStatus;
  useEffect(() => {
    if (!mounted) return;
    setSettings(mounted.settings);
    setGlow(mounted.glow);
  }, [mounted]);
  useEffect(() => {
    if (startup.notice) notify(startup.notice);
  }, [startup, notify]);

  // Remember the last look, debounced, and flush when the page is hidden.
  useEffect(() => {
    if (capture || !userChanged.current) return;
    let written = false;
    const write = () => {
      if (written) return;
      written = true;
      if (!writeJson(store, STORAGE_KEYS.lastLook, settingsRef.current) && store) notify(NOT_SAVED);
    };
    const timer = window.setTimeout(write, LAST_LOOK_DEBOUNCE_MS);
    window.addEventListener('pagehide', write);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', write);
    };
  }, [settings, capture, store, notify]);

  const idle = useIdleChrome(main, !capture);
  const pointer = useCanvasPointer(handle);
  const fullscreen = useFullscreen(notify);

  /** Apply a complete look through the one ordered path; UI changes only after the stage agrees. */
  const applyLook = (next: ArtworkSettingsV1): boolean => {
    const h = handle.current;
    if (!h) return false;
    const result = applySettings(h.art, next, settingsRef.current);
    if (!result.ok) {
      notify(
        result.reason === 'scene'
          ? 'That scene could not be shown, so the current look was kept.'
          : 'That look could not be applied, so the current look was kept.',
      );
      return false;
    }
    // Updated now, not on the next render: a settling source coordinator reads it.
    settingsRef.current = next;
    userChanged.current = true;
    setSettings(next);
    setGlow(result.glow);
    return true;
  };
  /**
   * Load a saved or shared look. A live source is returned to Autonomous first: selecting
   * Autonomous aborts the source synchronously, so no late event can override the look.
   */
  const loadLook = (next: ArtworkSettingsV1, id: string | null, message?: string) => {
    const hadSource = sources.view.selected !== '';
    if (hadSource) void sources.select('');
    if (!applyLook(next)) return false;
    setLoadedId(id);
    const parts = [message, hadSource ? 'Live source stopped; back to Autonomous.' : undefined];
    const text = parts.filter(Boolean).join(' ');
    if (text) notify(text);
    return true;
  };
  const selectScene = (id: string) => {
    if (id !== settingsRef.current.scene) applyLook(withScene(settingsRef.current, id));
  };
  const update = (patch: Partial<ArtworkSettingsV1>, write: () => void) => {
    write();
    userChanged.current = true;
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
  };
  const setPalette = (palette: PaletteId) =>
    update({ palette }, () => handle.current?.art.setPalette(paletteOf(palette).mood));
  const setForm = (form: number) => update({ form }, () => handle.current?.art.setForm(form));
  const setMotion = (motion: number) =>
    update({ motion }, () => handle.current?.art.setMotion(motion));
  const setGlowOverride = (value: number) =>
    update({ glow: value }, () => {
      const g = handle.current?.art.setGlow(value);
      if (g !== undefined) setGlow(g);
    });
  const resetLighting = () => {
    const g = handle.current?.art.clearLighting();
    if (g === undefined) return;
    setGlow(g);
    update({ glow: null }, () => undefined);
  };
  const changeQuality = (q: QualityMode) => {
    setQuality(q);
    handle.current?.stage.setQualityMode(q);
    if (!writeJson(store, STORAGE_KEYS.device, { version: 1, quality: q }) && store) {
      notify(NOT_SAVED);
    }
  };

  // Shared links opened while the app is running (paste, back/forward). Nothing here writes the
  // hash, so applying a link can never trigger another hashchange.
  const onHash = useRef<() => void>(() => undefined);
  onHash.current = () => {
    const decoded = decodeLookFragment(location.hash, SHADER_MANIFESTS);
    if (decoded.kind === 'invalid') {
      notify('That link’s look could not be read, so nothing was changed.');
    } else if (decoded.kind === 'ok' && !settingsEqual(decoded.settings, settingsRef.current)) {
      loadLook(
        decoded.settings,
        null,
        decoded.adjusted ? `Opened a shared look. ${ADJUSTED_NOTICE}` : 'Opened a shared look.',
      );
    }
  };
  useEffect(() => {
    if (capture) return;
    const listener = () => onHash.current();
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, [capture]);

  // Saved looks.
  const now = () => new Date().toISOString();
  const persisted = (result: ReturnType<typeof saved.mutate>, done: string): boolean => {
    if (!result.ok) {
      notify(
        result.reason === 'limit'
          ? 'You already have 30 saved looks. Delete one or update an existing look.'
          : result.reason === 'name'
            ? 'Give the look a name first.'
            : 'That look is no longer saved here; the list has been refreshed.',
      );
      return false;
    }
    notify(result.durable ? done : `${done} ${NOT_SAVED}`);
    return true;
  };
  const saveLook = (rawName: string): boolean => {
    const name = normalizeName(rawName);
    if (name === null) {
      notify('Give the look a name first.');
      return false;
    }
    const at = now();
    const look: SavedLookV1 = {
      id: newLookId(),
      name,
      createdAt: at,
      updatedAt: at,
      settings: settingsRef.current,
    };
    const ok = persisted(saved.mutate({ type: 'create', look }), 'Look saved.');
    if (ok) setLoadedId(look.id);
    return ok;
  };
  const deleteLook = (id: string) => {
    const index = saved.looks.findIndex((l) => l.id === id);
    const look = saved.looks[index];
    const result = saved.mutate({ type: 'delete', id });
    if (!result.ok || !look) return void persisted(result, '');
    if (loadedId === id) setLoadedId(null);
    notify(`Deleted “${look.name}”.`, {
      label: 'Undo',
      run: () => {
        persisted(saved.mutate({ type: 'restore', look, index }), 'Look restored.');
        dismiss();
      },
    });
  };

  // Focus follows the panel: into its heading on open, back to the opener on close, but only
  // if focus was inside the panel, so closing never steals focus from elsewhere.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) heading.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);
  const setPanelOpen = (next: boolean) => {
    if (!next && panel.current?.contains(document.activeElement)) {
      toggle.current?.focus({ preventScroll: true });
    }
    setOpen(next);
  };
  const setPanelOpenRef = useRef(setPanelOpen);
  setPanelOpenRef.current = setPanelOpen;
  // Escape closes the panel, the only app overlay, and is left alone while it is closed.
  // Inline forms inside the panel stop Escape first, to cancel just themselves.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setPanelOpenRef.current(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const pause = () => {
    const s = handle.current?.stage;
    if (!s) return;
    s.setPaused(!s.clock.paused);
    setPaused(s.clock.paused);
  };
  useShortcuts(
    {
      pulse: () => handle.current?.stage.pulse(0.65),
      pause,
      togglePanel: () => setPanelOpenRef.current(!open),
      ...(fullscreen.supported ? { fullscreen: fullscreen.toggle } : {}),
      scene: (index) => {
        const next = SHADER_MANIFESTS[index];
        if (next) selectScene(next.id);
      },
    },
    // Capture mode keeps its previous keyboard behavior; it only drops chrome and notices.
    true,
  );

  return (
    <main
      ref={main}
      className={`experience ${idle && !open ? 'is-idle' : ''} ${capture ? 'is-capture' : ''}`}
    >
      <canvas
        ref={canvas}
        className="stage"
        aria-label="Interactive generative artwork. Hold to gather light, release to send a pulse."
        {...pointer}
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
          <span className={`live-label ${sources.view.phase === 'live' ? 'connected' : ''}`}>
            <i />
            {PHASE_LABEL[sources.view.phase]}
          </span>
          <button
            type="button"
            ref={toggle}
            className="round-button"
            onClick={() => setPanelOpen(!open)}
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
          {String(SHADER_MANIFESTS.findIndex((m) => m.id === settings.scene) + 1).padStart(2, '0')}{' '}
          / GENERATIVE STUDIES
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
              className={settings.scene === m.id ? 'selected' : ''}
              aria-pressed={settings.scene === m.id}
              onClick={() => selectScene(m.id)}
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
          {fullscreen.supported && (
            <button
              type="button"
              className="round-button fullscreen"
              onClick={fullscreen.toggle}
              aria-label={fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'}
            >
              ⛶
            </button>
          )}
        </div>
      </footer>
      <TuningPanel
        open={open}
        panelRef={panel}
        headingRef={heading}
        scenes={SHADER_MANIFESTS}
        settings={settings}
        effectiveGlow={glow}
        quality={quality}
        onClose={() => setPanelOpen(false)}
        onScene={selectScene}
        onPalette={setPalette}
        onForm={setForm}
        onMotion={setMotion}
        onGlow={setGlowOverride}
        onResetLighting={resetLighting}
        onResetArtwork={() => applyLook(resetArtwork(settingsRef.current))}
        onQuality={changeQuality}
        looks={
          <SavedLooks
            looks={saved.looks}
            scenes={SHADER_MANIFESTS}
            current={settings}
            loadedId={loadedId}
            persistence={saved.persistence}
            onSave={saveLook}
            onLoad={(look) => loadLook(look.settings, look.id, `Loaded “${look.name}”.`)}
            onRename={(id, name) =>
              persisted(saved.mutate({ type: 'rename', id, name, at: now() }), 'Look renamed.')
            }
            onUpdate={(id) => {
              if (
                persisted(
                  saved.mutate({ type: 'update', id, settings: settingsRef.current, at: now() }),
                  'Look updated.',
                )
              )
                setLoadedId(id);
            }}
            onDelete={deleteLook}
            onShare={async () => {
              const url = shareUrl(location, settingsRef.current);
              const outcome = await shareLink(
                shareEnvironment(),
                url,
                `${active?.name ?? 'Ambient'} look`,
              );
              if (outcome === 'copied') notify('Link copied.');
              return { outcome, url };
            }}
          />
        }
        source={
          <SourcePicker
            options={SOURCE_OPTIONS}
            view={sources.view}
            disabled={capture}
            onSelect={(id) => void sources.select(id)}
            onRetry={() => void sources.retry()}
          />
        }
        diagnostics={
          readout && (
            <p className="readout">
              {readout.fps.toFixed(0)} fps · {readout.quality} · {readout.hdr ? 'HDR' : 'standard'}
            </p>
          )
        }
        shortcuts={`1–${SHADER_MANIFESTS.length} scenes · P pause · H panel${fullscreen.supported ? ' · F fullscreen' : ''} · Space pulse`}
      />
      {!capture && <NoticeRegion notice={notice} onDismiss={dismiss} />}
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
