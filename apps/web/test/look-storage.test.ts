import { SHADER_MANIFESTS } from '@ambient/shaders';
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/state/artwork-settings.js';
import {
  applyMutation,
  browserStore,
  commitMutation,
  type KeyValueStore,
  MAX_DOCUMENT_CHARS,
  MAX_LOOKS,
  normalizeName,
  parseLooks,
  readDevicePreferences,
  readLastLook,
  readLooks,
  type SavedLookV1,
  STORAGE_KEYS,
  writeJson,
} from '../src/state/look-storage.js';

const S = SHADER_MANIFESTS;
const AT = '2026-09-23T10:00:00.000Z';
const mk = (id: string, name = `Look ${id}`): SavedLookV1 => ({
  id,
  name,
  createdAt: AT,
  updatedAt: AT,
  settings: defaultSettings(),
});
const doc = (looks: unknown[], version: unknown = 1) => JSON.stringify({ version, looks });

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  quota = Number.POSITIVE_INFINITY;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('browserStore', () => {
  it('returns null when storage access throws or writes are refused', () => {
    expect(
      browserStore(() => {
        throw new DOMException('denied', 'SecurityError');
      }),
    ).toBeNull();
    const refusing = new MemoryStore();
    refusing.quota = 0;
    expect(browserStore(() => refusing)).toBeNull();
    const ok = new MemoryStore();
    expect(browserStore(() => ok)).toBe(ok);
    expect(ok.data.size).toBe(0);
  });
});

describe('readLooks', () => {
  it('reads nothing stored as an empty, healthy list', () => {
    expect(readLooks(new MemoryStore(), S)).toEqual({ status: 'ok', looks: [], dropped: 0 });
  });

  it('reports blocked storage as unavailable', () => {
    expect(readLooks(null, S).status).toBe('unavailable');
  });

  it('treats unparseable, oversized and wrongly shaped documents as corrupt', () => {
    for (const raw of [
      '{nope',
      'null',
      '[]',
      '{"version":1}',
      'x'.repeat(MAX_DOCUMENT_CHARS + 1),
    ]) {
      expect(parseLooks(raw, S).status).toBe('corrupt');
    }
  });

  it('marks a newer document version unsupported', () => {
    expect(parseLooks(doc([mk('a')], 2), S)).toEqual({
      status: 'unsupported',
      looks: [],
      dropped: 0,
    });
  });

  it('recovers valid records from a partially corrupt list', () => {
    const bad = [
      { ...mk('b'), settings: { ...defaultSettings(), scene: 'gone' } },
      { ...mk('c'), name: '   ' },
      { ...mk('d'), createdAt: 'yesterday' },
      { ...mk('e'), name: '<b>x</b>'.padEnd(80, 'x') },
      'junk',
      mk('a', 'Duplicate id'),
    ];
    const r = parseLooks(doc([mk('a'), ...bad, mk('f')]), S);
    expect(r.status).toBe('recovered');
    expect(r.looks.map((l) => l.id)).toEqual(['a', 'f']);
    expect(r.dropped).toBe(bad.length);
  });

  it('keeps names as plain text, markup included', () => {
    const r = parseLooks(doc([mk('a', '<img src=x onerror=alert(1)>')]), S);
    expect(r.looks[0]?.name).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('normalizeName', () => {
  it('trims, collapses whitespace, rejects empty and bounds code points', () => {
    expect(normalizeName('  Night   walk ')).toBe('Night walk');
    expect(normalizeName('   ')).toBeNull();
    const emoji = '🌊'.repeat(70);
    expect([...(normalizeName(emoji) ?? '')]).toHaveLength(60);
  });
});

describe('applyMutation', () => {
  it('enforces the look limit', () => {
    const full = Array.from({ length: MAX_LOOKS }, (_, i) => mk(String(i)));
    expect(applyMutation(full, { type: 'create', look: mk('new') })).toEqual({
      ok: false,
      reason: 'limit',
    });
  });

  it('renames, updates and deletes by id and reports missing looks', () => {
    const looks = [mk('a'), mk('b')];
    const renamed = applyMutation(looks, { type: 'rename', id: 'b', name: ' Dusk ', at: 'T' });
    expect(renamed.ok && renamed.looks[1]).toMatchObject({ name: 'Dusk', updatedAt: 'T' });
    const settings = { ...defaultSettings(), glow: 0 };
    const updated = applyMutation(looks, { type: 'update', id: 'a', settings, at: 'T' });
    expect(updated.ok && updated.looks[0]?.settings.glow).toBe(0);
    expect(applyMutation(looks, { type: 'delete', id: 'zz' })).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(applyMutation(looks, { type: 'rename', id: 'a', name: '  ', at: 'T' })).toEqual({
      ok: false,
      reason: 'name',
    });
  });

  it('undo restores a deleted look at its old position', () => {
    const looks = [mk('a'), mk('b'), mk('c')];
    const deleted = applyMutation(looks, { type: 'delete', id: 'b' });
    if (!deleted.ok) throw new Error('delete failed');
    const restored = applyMutation(deleted.looks, { type: 'restore', look: mk('b'), index: 1 });
    expect(restored.ok && restored.looks.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('commitMutation', () => {
  it('re-reads the latest document so changes from another tab are kept', () => {
    const store = new MemoryStore();
    store.setItem(STORAGE_KEYS.looks, doc([mk('other-tab')]));
    const stale: SavedLookV1[] = [];
    const r = commitMutation(store, S, stale, { type: 'create', look: mk('mine') });
    expect(r.ok && r.durable).toBe(true);
    expect(parseLooks(store.getItem(STORAGE_KEYS.looks), S).looks.map((l) => l.id)).toEqual([
      'mine',
      'other-tab',
    ]);
  });

  it('never reports durable success when setItem throws', () => {
    const store = new MemoryStore();
    store.quota = 10;
    const r = commitMutation(store, S, [], { type: 'create', look: mk('a') });
    expect(r).toMatchObject({ ok: true, durable: false, reason: 'quota' });
    expect(r.looks.map((l) => l.id)).toEqual(['a']);
  });

  it('keeps changes in memory when storage is unavailable', () => {
    const memory = [mk('a')];
    const r = commitMutation(null, S, memory, { type: 'create', look: mk('b') });
    expect(r).toMatchObject({ ok: true, durable: false, reason: 'unavailable' });
    expect(r.looks.map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('leaves a newer-version document untouched', () => {
    const store = new MemoryStore();
    const newer = doc([{ future: true }], 2);
    store.setItem(STORAGE_KEYS.looks, newer);
    const r = commitMutation(store, S, [], { type: 'create', look: mk('a') });
    expect(r).toMatchObject({ ok: true, durable: false, reason: 'unsupported' });
    expect(store.getItem(STORAGE_KEYS.looks)).toBe(newer);
  });

  it('backs up an unreadable document once before rewriting it', () => {
    const store = new MemoryStore();
    store.setItem(STORAGE_KEYS.looks, '{broken');
    commitMutation(store, S, [], { type: 'create', look: mk('a') });
    commitMutation(store, S, [], { type: 'create', look: mk('b') });
    expect(store.getItem(STORAGE_KEYS.looksBackup)).toBe('{broken');
    expect(readLooks(store, S).looks.map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('backs up a partially corrupt list before dropping its unreadable records', () => {
    const store = new MemoryStore();
    const raw = doc([mk('a'), { junk: true }]);
    store.setItem(STORAGE_KEYS.looks, raw);
    commitMutation(store, S, [], { type: 'rename', id: 'a', name: 'Kept', at: AT });
    expect(store.getItem(STORAGE_KEYS.looksBackup)).toBe(raw);
    expect(readLooks(store, S)).toMatchObject({ status: 'ok', looks: [{ id: 'a', name: 'Kept' }] });
  });

  it('uses this tab’s list when another tab corrupted the document', () => {
    const store = new MemoryStore();
    store.setItem(STORAGE_KEYS.looks, 'garbage');
    const r = commitMutation(store, S, [mk('a')], { type: 'create', look: mk('b') });
    expect(r.looks.map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('a look deleted in another tab is reported missing instead of resurrected', () => {
    const store = new MemoryStore();
    store.setItem(STORAGE_KEYS.looks, doc([]));
    const r = commitMutation(store, S, [mk('a')], {
      type: 'update',
      id: 'a',
      settings: defaultSettings(),
      at: AT,
    });
    expect(r).toMatchObject({ ok: false, reason: 'missing', looks: [] });
  });
});

describe('last look and device preferences', () => {
  it('round-trips and ignores invalid or corrupt values', () => {
    const store = new MemoryStore();
    const s = { ...defaultSettings('chromatic-ink'), glow: 0 };
    expect(writeJson(store, STORAGE_KEYS.lastLook, s)).toBe(true);
    expect(readLastLook(store, S)).toEqual(s);
    store.setItem(STORAGE_KEYS.lastLook, '{"version":1,"scene":"gone"}');
    expect(readLastLook(store, S)).toBeNull();
    store.setItem(STORAGE_KEYS.device, 'not json');
    expect(readDevicePreferences(store)).toBeNull();
    expect(writeJson(null, STORAGE_KEYS.device, {})).toBe(false);
  });
});
