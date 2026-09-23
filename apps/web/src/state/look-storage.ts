import {
  type ArtworkSettingsV1,
  type DevicePreferencesV1,
  type SceneRegistry,
  validateDevicePreferences,
  validateSettings,
} from './artwork-settings.js';

/**
 * Best-effort local persistence for saved looks, the last look, and device preferences.
 * Storage is injected, so blocked storage, corrupt JSON, quota failures and other tabs can be
 * tested in Node. Nothing here throws: every failure is a result the UI can explain.
 *
 * Multi-tab: each mutation re-reads the latest stored list and applies itself by id. The final
 * write is still last-write-wins; two tabs mutating in the same instant can lose one change.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEYS = {
  looks: 'aap:saved-looks:v1',
  lastLook: 'aap:last-look:v1',
  device: 'aap:device-preferences:v1',
  /** A copy of a looks document that could not be fully read, kept before it is rewritten. */
  looksBackup: 'aap:saved-looks:v1:unreadable-backup',
} as const;

export const MAX_LOOKS = 30;
export const MAX_NAME_LENGTH = 60;
export const MAX_DOCUMENT_CHARS = 256 * 1024;

export interface SavedLookV1 {
  readonly id: string;
  readonly name: string;
  /** ISO date. */
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly settings: ArtworkSettingsV1;
}

export interface SavedLooksDocumentV1 {
  readonly version: 1;
  readonly looks: readonly SavedLookV1[];
}

/** Resolve `window.localStorage`, which can throw on access when storage is blocked. */
export function browserStore(get: () => KeyValueStore | null | undefined): KeyValueStore | null {
  try {
    const store = get();
    if (!store) return null;
    const probe = 'aap:probe';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

/** Trim and bound a user-entered name, counting Unicode code points. null when empty. */
export function normalizeName(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return null;
  return [...trimmed].slice(0, MAX_NAME_LENGTH).join('');
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function validateLook(input: unknown, scenes: SceneRegistry): SavedLookV1 | null {
  if (typeof input !== 'object' || input === null) return null;
  const o = input as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '' || o.id.length > 100) return null;
  if (typeof o.name !== 'string') return null;
  const name = normalizeName(o.name);
  if (name === null || name !== o.name) return null;
  if (typeof o.createdAt !== 'string' || !ISO.test(o.createdAt)) return null;
  if (typeof o.updatedAt !== 'string' || !ISO.test(o.updatedAt)) return null;
  const settings = validateSettings(o.settings, scenes);
  if (!settings.ok) return null;
  return {
    id: o.id,
    name,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    settings: settings.value,
  };
}

export type LooksReadStatus =
  /** Clean read, including "nothing stored yet". */
  | 'ok'
  /** Some records were invalid and were skipped; the valid ones are returned. */
  | 'recovered'
  /** Nothing readable: bad JSON, too large, or not a looks document. */
  | 'corrupt'
  /** Written by a newer version. Left untouched and never overwritten. */
  | 'unsupported'
  | 'unavailable';

export interface LooksRead {
  readonly status: LooksReadStatus;
  readonly looks: readonly SavedLookV1[];
  /** Records that could not be read. */
  readonly dropped: number;
}

export function readLooks(store: KeyValueStore | null, scenes: SceneRegistry): LooksRead {
  if (!store) return { status: 'unavailable', looks: [], dropped: 0 };
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEYS.looks);
  } catch {
    return { status: 'unavailable', looks: [], dropped: 0 };
  }
  return parseLooks(raw, scenes);
}

/** Parse a stored looks document. Also used for `storage` events from other tabs. */
export function parseLooks(raw: string | null, scenes: SceneRegistry): LooksRead {
  if (raw === null) return { status: 'ok', looks: [], dropped: 0 };
  if (raw.length > MAX_DOCUMENT_CHARS) return { status: 'corrupt', looks: [], dropped: 0 };
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', looks: [], dropped: 0 };
  }
  if (typeof doc !== 'object' || doc === null) return { status: 'corrupt', looks: [], dropped: 0 };
  const o = doc as Record<string, unknown>;
  if (typeof o.version === 'number' && o.version !== 1) {
    return { status: 'unsupported', looks: [], dropped: 0 };
  }
  if (o.version !== 1 || !Array.isArray(o.looks)) {
    return { status: 'corrupt', looks: [], dropped: 0 };
  }
  const looks: SavedLookV1[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  for (const item of o.looks) {
    const look = validateLook(item, scenes);
    // Duplicate ids are ambiguous: keep the first, count the rest as unreadable.
    if (!look || ids.has(look.id) || looks.length >= MAX_LOOKS) {
      dropped += 1;
      continue;
    }
    ids.add(look.id);
    looks.push(look);
  }
  return { status: dropped > 0 ? 'recovered' : 'ok', looks, dropped };
}

export type LookMutation =
  | { readonly type: 'create'; readonly look: SavedLookV1 }
  | { readonly type: 'rename'; readonly id: string; readonly name: string; readonly at: string }
  | {
      readonly type: 'update';
      readonly id: string;
      readonly settings: ArtworkSettingsV1;
      readonly at: string;
    }
  | { readonly type: 'delete'; readonly id: string }
  /** Undo a delete: put the look back where it was. */
  | { readonly type: 'restore'; readonly look: SavedLookV1; readonly index: number };

export type MutationFailure = 'limit' | 'missing' | 'name';

/** Pure list transition, applied by id so it composes with changes made in other tabs. */
export function applyMutation(
  looks: readonly SavedLookV1[],
  m: LookMutation,
): { ok: true; looks: SavedLookV1[] } | { ok: false; reason: MutationFailure } {
  switch (m.type) {
    case 'create': {
      if (looks.length >= MAX_LOOKS) return { ok: false, reason: 'limit' };
      if (normalizeName(m.look.name) !== m.look.name) return { ok: false, reason: 'name' };
      return { ok: true, looks: [m.look, ...looks.filter((l) => l.id !== m.look.id)] };
    }
    case 'restore': {
      if (looks.some((l) => l.id === m.look.id)) return { ok: true, looks: [...looks] };
      if (looks.length >= MAX_LOOKS) return { ok: false, reason: 'limit' };
      const next = [...looks];
      next.splice(Math.max(0, Math.min(m.index, next.length)), 0, m.look);
      return { ok: true, looks: next };
    }
    case 'rename': {
      const name = normalizeName(m.name);
      if (name === null) return { ok: false, reason: 'name' };
      return edit(looks, m.id, (l) => ({ ...l, name, updatedAt: m.at }));
    }
    case 'update':
      return edit(looks, m.id, (l) => ({ ...l, settings: m.settings, updatedAt: m.at }));
    case 'delete': {
      if (!looks.some((l) => l.id === m.id)) return { ok: false, reason: 'missing' };
      return { ok: true, looks: looks.filter((l) => l.id !== m.id) };
    }
  }
}

function edit(
  looks: readonly SavedLookV1[],
  id: string,
  change: (l: SavedLookV1) => SavedLookV1,
): { ok: true; looks: SavedLookV1[] } | { ok: false; reason: MutationFailure } {
  if (!looks.some((l) => l.id === id)) return { ok: false, reason: 'missing' };
  return { ok: true, looks: looks.map((l) => (l.id === id ? change(l) : l)) };
}

export type CommitResult =
  | { readonly ok: true; readonly looks: readonly SavedLookV1[]; readonly durable: true }
  /** Storage is unavailable or full: the change applies for this tab only. */
  | {
      readonly ok: true;
      readonly looks: readonly SavedLookV1[];
      readonly durable: false;
      readonly reason: 'unavailable' | 'quota' | 'unsupported';
    }
  | {
      readonly ok: false;
      readonly reason: MutationFailure;
      readonly looks: readonly SavedLookV1[];
    };

/**
 * Re-read the latest stored list, apply one mutation by id, and write it back.
 * `memory` is this tab's list, used only when storage cannot be read at all.
 */
export function commitMutation(
  store: KeyValueStore | null,
  scenes: SceneRegistry,
  memory: readonly SavedLookV1[],
  m: LookMutation,
): CommitResult {
  const latest = readLooks(store, scenes);
  // Unreadable storage (including a document another tab corrupted): this tab's list is the
  // best copy available. Otherwise the stored list is the latest truth.
  const base =
    latest.status === 'unavailable' ||
    latest.status === 'unsupported' ||
    latest.status === 'corrupt'
      ? memory
      : latest.looks;
  const result = applyMutation(base, m);
  if (!result.ok) return { ok: false, reason: result.reason, looks: base };
  if (!store || latest.status === 'unavailable') {
    return { ok: true, looks: result.looks, durable: false, reason: 'unavailable' };
  }
  if (latest.status === 'unsupported') {
    // Never overwrite a document from a newer version of the app.
    return { ok: true, looks: result.looks, durable: false, reason: 'unsupported' };
  }
  try {
    if (latest.status === 'corrupt' || latest.status === 'recovered') {
      // Keep the unreadable original once, so a rewrite never destroys the only copy.
      const raw = store.getItem(STORAGE_KEYS.looks);
      if (raw !== null && store.getItem(STORAGE_KEYS.looksBackup) === null) {
        store.setItem(STORAGE_KEYS.looksBackup, raw);
      }
    }
  } catch {
    // A failed backup (usually quota) must not block the user's change; the write below reports.
  }
  const doc: SavedLooksDocumentV1 = { version: 1, looks: result.looks };
  try {
    store.setItem(STORAGE_KEYS.looks, JSON.stringify(doc));
  } catch {
    return { ok: true, looks: result.looks, durable: false, reason: 'quota' };
  }
  return { ok: true, looks: result.looks, durable: true };
}

export function readLastLook(
  store: KeyValueStore | null,
  scenes: SceneRegistry,
): ArtworkSettingsV1 | null {
  const value = readJson(store, STORAGE_KEYS.lastLook);
  const r = validateSettings(value, scenes);
  return r.ok ? r.value : null;
}

export function readDevicePreferences(store: KeyValueStore | null): DevicePreferencesV1 | null {
  return validateDevicePreferences(readJson(store, STORAGE_KEYS.device));
}

/** Returns false when the write did not persist. */
export function writeJson(store: KeyValueStore | null, key: string, value: unknown): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readJson(store: KeyValueStore | null, key: string): unknown {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (raw === null || raw.length > MAX_DOCUMENT_CHARS) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** A collision-resistant id; crypto.randomUUID where available. */
export function newLookId(random: () => number = Math.random): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `look-${Date.now().toString(36)}-${Math.floor(random() * 2 ** 48).toString(36)}`;
}
