import { describe, expect, it } from 'vitest';
import { SignalValidationError } from '../src/errors.js';
import { PROTOCOL_VERSION, type VisualSignal } from '../src/protocol.js';
import { isVisualSignal, normalizePayload, validateSignal } from '../src/validate.js';

const strict = { validate: true, sourceId: 'test' };
const lenient = { validate: false, sourceId: 'test' };

describe('normalizePayload', () => {
  it('clamps every field of each type', () => {
    expect(normalizePayload('pulse', { magnitude: 3 }, strict)).toEqual({
      type: 'pulse',
      magnitude: 1,
    });
    expect(
      normalizePayload('pulse', { magnitude: 0.5, location: { x: -1, y: 2 } }, strict),
    ).toEqual({ type: 'pulse', magnitude: 0.5, location: { x: 0, y: 1 } });
    expect(normalizePayload('current', { x: 5, y: -5, velocity: 0.3 }, strict)).toEqual({
      type: 'current',
      x: 1,
      y: 0,
      velocity: 0.3,
    });
    expect(normalizePayload('ambiance', { moodScore: 1.5, turbulence: -0.5 }, strict)).toEqual({
      type: 'ambiance',
      moodScore: 1,
      turbulence: 0,
    });
  });

  it('omits location when not provided', () => {
    const out = normalizePayload('pulse', { magnitude: 0.1 }, strict);
    expect('location' in out).toBe(false);
  });

  it('throws a SignalValidationError naming the field in validate mode', () => {
    expect(() => normalizePayload('pulse', { magnitude: Number.NaN }, strict)).toThrow(
      SignalValidationError,
    );
    try {
      normalizePayload('current', { x: 0.1, y: 'nope' as unknown as number, velocity: 0 }, strict);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SignalValidationError);
      expect((err as SignalValidationError).field).toBe('y');
      expect((err as SignalValidationError).sourceId).toBe('test');
    }
    try {
      normalizePayload('pulse', { magnitude: 1, location: { x: 0, y: Number.NaN } }, strict);
      expect.unreachable();
    } catch (err) {
      expect((err as SignalValidationError).field).toBe('location.y');
    }
  });

  it('maps NaN to 0 silently in lenient mode', () => {
    expect(
      normalizePayload('ambiance', { moodScore: Number.NaN, turbulence: 0.2 }, lenient),
    ).toEqual({ type: 'ambiance', moodScore: 0, turbulence: 0.2 });
  });

  it('never mutates the input', () => {
    const input = { magnitude: 7, location: { x: 9, y: 9 } };
    const snapshot = structuredClone(input);
    normalizePayload('pulse', input, strict);
    expect(input).toEqual(snapshot);
  });
});

describe('validateSignal', () => {
  const good: VisualSignal = {
    v: PROTOCOL_VERSION,
    sourceId: 's',
    ts: 1,
    type: 'ambiance',
    moodScore: 0.5,
    turbulence: 0.5,
  };

  it('accepts a well-formed signal', () => {
    expect(() => validateSignal(good)).not.toThrow();
    expect(isVisualSignal(good)).toBe(true);
  });

  it.each([
    ['not an object', 'str'],
    ['wrong version', { ...good, v: 2 }],
    ['missing sourceId', { ...good, sourceId: '' }],
    ['non-number ts', { ...good, ts: '1' }],
    ['unknown type', { ...good, type: 'sparkle' }],
    ['bad numeric field', { ...good, moodScore: Number.POSITIVE_INFINITY }],
  ])('rejects %s', (_label, value) => {
    expect(() => validateSignal(value)).toThrow(SignalValidationError);
    expect(isVisualSignal(value)).toBe(false);
  });
});
