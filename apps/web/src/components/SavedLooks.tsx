import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { Persistence } from '../hooks/use-saved-looks.js';
import {
  type ArtworkSettingsV1,
  paletteOf,
  type SceneRegistry,
  sceneName,
  settingsEqual,
} from '../state/artwork-settings.js';
import { MAX_LOOKS, MAX_NAME_LENGTH, type SavedLookV1 } from '../state/look-storage.js';
import type { ShareOutcome } from '../state/share.js';

export interface SavedLooksProps {
  readonly looks: readonly SavedLookV1[];
  readonly scenes: SceneRegistry;
  readonly current: ArtworkSettingsV1;
  readonly loadedId: string | null;
  readonly persistence: Persistence;
  /** Returns false when the name was rejected, so the form stays open. */
  onSave(name: string): boolean;
  onLoad(look: SavedLookV1): void;
  onRename(id: string, name: string): boolean;
  onUpdate(id: string): void;
  onDelete(id: string): void;
  onShare(): Promise<{ outcome: ShareOutcome; url: string }>;
}

const suggestedName = (scenes: SceneRegistry, s: ArtworkSettingsV1) =>
  `${sceneName(scenes, s.scene)} · ${paletteOf(s.palette).name}`;

/** Escape inside an inline form cancels that form rather than closing the whole panel. */
const keepEscape = (e: React.KeyboardEvent, cancel: () => void) => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  e.nativeEvent.stopImmediatePropagation();
  cancel();
};

export function SavedLooks(p: SavedLooksProps) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [share, setShare] = useState<{ outcome: ShareOutcome; url: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const manualUrl = useRef<HTMLInputElement>(null);
  const atLimit = p.looks.length >= MAX_LOOKS;
  const loaded = p.looks.find((l) => l.id === p.loadedId);
  const modified = loaded !== undefined && !settingsEqual(loaded.settings, p.current);

  useEffect(() => {
    if (naming) nameInput.current?.select();
  }, [naming]);
  useEffect(() => {
    if (share?.outcome === 'manual') manualUrl.current?.select();
  }, [share]);

  const closeNaming = () => {
    setNaming(false);
    saveButton.current?.focus();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (p.onSave(name)) closeNaming();
  };

  return (
    <section className="looks" aria-labelledby="looks-heading">
      <div className="look-actions">
        <button
          type="button"
          ref={saveButton}
          className="pill-button"
          disabled={atLimit}
          aria-describedby={atLimit ? 'looks-limit' : undefined}
          onClick={() => {
            setName(suggestedName(p.scenes, p.current));
            setNaming(true);
          }}
        >
          Save look
        </button>
        <button
          type="button"
          className="pill-button"
          disabled={sharing}
          aria-describedby="share-note"
          onClick={async () => {
            setSharing(true);
            try {
              setShare(await p.onShare());
            } finally {
              setSharing(false);
            }
          }}
        >
          Share these settings
        </button>
      </div>
      <p id="share-note" className="fine-print">
        Reopens this look. Animation and live signals may differ.
      </p>
      {share?.outcome === 'manual' && (
        <div className="manual-copy">
          <label className="select-label">
            Copying is not available here. Select the link and copy it yourself:
            <input ref={manualUrl} readOnly value={share.url} onFocus={(e) => e.target.select()} />
          </label>
        </div>
      )}
      {naming && (
        <form className="name-form" onSubmit={submit} onKeyDown={(e) => keepEscape(e, closeNaming)}>
          <label className="select-label">
            Name this look
            <input
              ref={nameInput}
              value={name}
              maxLength={MAX_NAME_LENGTH * 2}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <span className="text-actions">
            <button type="submit" className="text-button">
              Save
            </button>
            <button type="button" className="text-button" onClick={closeNaming}>
              Cancel
            </button>
          </span>
        </form>
      )}
      {atLimit && (
        <p id="looks-limit" className="fine-print">
          You have {MAX_LOOKS} saved looks, the most this device keeps. Delete one, or open a look's
          options and choose Update to replace it with the current settings.
        </p>
      )}
      <details className="saved-list" open={p.looks.length > 0 && p.looks.length <= 3}>
        <summary id="looks-heading">
          Saved looks <span className="count">{p.looks.length}</span>
        </summary>
        {p.persistence !== 'durable' && (
          <p className="fine-print">Not saved on this device: looks last until this tab closes.</p>
        )}
        {p.looks.length === 0 ? (
          <p className="fine-print">Save a look to come back to it later on this device.</p>
        ) : (
          <ul>
            {p.looks.map((look) => (
              <LookRow
                key={look.id}
                look={look}
                scenes={p.scenes}
                loaded={look.id === p.loadedId}
                modified={look.id === p.loadedId && modified}
                editing={editing === look.id}
                onEdit={(on) => setEditing(on ? look.id : null)}
                onLoad={() => p.onLoad(look)}
                onRename={(n) => p.onRename(look.id, n)}
                onUpdate={() => p.onUpdate(look.id)}
                onDelete={() => {
                  setEditing(null);
                  p.onDelete(look.id);
                }}
              />
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

function LookRow({
  look,
  scenes,
  loaded,
  modified,
  editing,
  onEdit,
  onLoad,
  onRename,
  onUpdate,
  onDelete,
}: {
  look: SavedLookV1;
  scenes: SceneRegistry;
  loaded: boolean;
  modified: boolean;
  editing: boolean;
  onEdit(on: boolean): void;
  onLoad(): void;
  onRename(name: string): boolean;
  onUpdate(): void;
  onDelete(): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(look.name);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const date = new Date(look.updatedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const status = modified ? ' · modified' : loaded ? ' · showing' : '';
  return (
    <li className={loaded ? 'look loaded' : 'look'}>
      <div className="look-row">
        <button type="button" className="look-load" onClick={onLoad}>
          <i
            className="look-swatch"
            style={{ background: paletteOf(look.settings.palette).color }}
            aria-hidden="true"
          />
          <span className="look-text">
            <span className="look-name">{look.name}</span>
            <span className="look-meta">
              {sceneName(scenes, look.settings.scene)} · {date}
              {status}
            </span>
          </span>
        </button>
        {modified && (
          <button type="button" className="text-button" onClick={onUpdate}>
            Update
          </button>
        )}
        <button
          type="button"
          ref={optionsButton}
          className="icon-button"
          aria-expanded={editing}
          aria-label={`Options for ${look.name}`}
          onClick={() => onEdit(!editing)}
        >
          ⋯
        </button>
      </div>
      {editing &&
        (renaming ? (
          <form
            className="name-form"
            onKeyDown={(e) =>
              keepEscape(e, () => {
                setRenaming(false);
                optionsButton.current?.focus();
              })
            }
            onSubmit={(e) => {
              e.preventDefault();
              if (onRename(draft)) {
                setRenaming(false);
                onEdit(false);
                optionsButton.current?.focus();
              }
            }}
          >
            <label className="select-label">
              Rename
              <input
                value={draft}
                maxLength={MAX_NAME_LENGTH * 2}
                onChange={(e) => setDraft(e.target.value)}
                required
                // biome-ignore lint/a11y/noAutofocus: the user just asked to rename this look.
                autoFocus
              />
            </label>
            <span className="text-actions">
              <button type="submit" className="text-button">
                Save name
              </button>
              <button type="button" className="text-button" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </span>
          </form>
        ) : (
          <div className="text-actions look-options">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setDraft(look.name);
                setRenaming(true);
              }}
            >
              Rename
            </button>
            <button type="button" className="text-button" onClick={onUpdate}>
              Update to current settings
            </button>
            <button type="button" className="text-button danger" onClick={onDelete}>
              Delete
            </button>
          </div>
        ))}
    </li>
  );
}
