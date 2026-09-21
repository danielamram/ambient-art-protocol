import { SignalValidationError } from './errors.js';
import { clamp01 } from './math.js';
import {
  type AmbianceInput,
  type CurrentInput,
  type InputOf,
  isSignalType,
  type PayloadOf,
  type Point,
  PROTOCOL_VERSION,
  type PulseInput,
  type SignalType,
  type VisualSignal,
} from './protocol.js';

export interface NormalizeOptions {
  /** When true, a non-finite number throws instead of clamping to 0. */
  readonly validate: boolean;
  readonly sourceId?: string;
}

export function assertFinite(
  value: unknown,
  field: string,
  sourceId?: string,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SignalValidationError(field, value, sourceId);
  }
}

function unit(value: unknown, field: string, opts: NormalizeOptions): number {
  if (opts.validate) {
    assertFinite(value, field, opts.sourceId);
    return clamp01(value);
  }
  return clamp01(typeof value === 'number' ? value : Number.NaN);
}

function point(value: Point, field: string, opts: NormalizeOptions): Point {
  return { x: unit(value.x, `${field}.x`, opts), y: unit(value.y, `${field}.y`, opts) };
}

/**
 * Build a clean, clamped payload from plugin-author input.
 * Always returns a fresh plain object and never mutates `input`.
 */
export function normalizePayload<T extends SignalType>(
  type: T,
  input: InputOf<T>,
  opts: NormalizeOptions,
): PayloadOf<T> {
  switch (type) {
    case 'pulse': {
      const p = input as unknown as PulseInput;
      const out: { type: 'pulse'; magnitude: number; location?: Point } = {
        type: 'pulse',
        magnitude: unit(p.magnitude, 'magnitude', opts),
      };
      if (p.location !== undefined) out.location = point(p.location, 'location', opts);
      return out as PayloadOf<T>;
    }
    case 'current': {
      const c = input as unknown as CurrentInput;
      return {
        type: 'current',
        x: unit(c.x, 'x', opts),
        y: unit(c.y, 'y', opts),
        velocity: unit(c.velocity, 'velocity', opts),
      } as PayloadOf<T>;
    }
    case 'ambiance': {
      const a = input as unknown as AmbianceInput;
      return {
        type: 'ambiance',
        moodScore: unit(a.moodScore, 'moodScore', opts),
        turbulence: unit(a.turbulence, 'turbulence', opts),
      } as PayloadOf<T>;
    }
    default:
      throw new SignalValidationError('type', type, opts.sourceId);
  }
}

/**
 * Structural check of a complete VisualSignal, e.g. one that arrived over the wire.
 * Throws SignalValidationError on the first problem.
 */
export function validateSignal(signal: unknown): asserts signal is VisualSignal {
  if (typeof signal !== 'object' || signal === null) {
    throw new SignalValidationError('signal', signal);
  }
  const s = signal as Record<string, unknown>;
  if (s.v !== PROTOCOL_VERSION) throw new SignalValidationError('v', s.v);
  if (typeof s.sourceId !== 'string' || s.sourceId.length === 0) {
    throw new SignalValidationError('sourceId', s.sourceId);
  }
  assertFinite(s.ts, 'ts', s.sourceId);
  if (!isSignalType(s.type)) throw new SignalValidationError('type', s.type, s.sourceId);
  // Re-normalizing in validate mode throws on any bad numeric field.
  normalizePayload(s.type, s as never, { validate: true, sourceId: s.sourceId });
}

export function isVisualSignal(value: unknown): value is VisualSignal {
  try {
    validateSignal(value);
    return true;
  } catch {
    return false;
  }
}
