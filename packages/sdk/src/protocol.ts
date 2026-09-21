/**
 * The Ambient Art Protocol wire types.
 *
 * Everything in this file is plain JSON by construction. A signal produced in Node
 * (a webhook listener), in a browser (a mock slider), or by a Python script that
 * POSTs JSON must all look identical here. Keep it boring: no classes, no Dates.
 */

export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

export const SIGNAL_TYPES = ['pulse', 'current', 'ambiance'] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

/** A number in the closed range [0, 1]. Enforced at runtime by the SDK, not the type system. */
export type Unit = number;

/** Normalized canvas coordinates. (0, 0) is top-left, (1, 1) is bottom-right. */
export interface Point {
  readonly x: Unit;
  readonly y: Unit;
}

/** Metadata stamped on every signal by the SDK. */
export interface SignalMeta {
  readonly v: ProtocolVersion;
  /** Which source instance produced this signal. */
  readonly sourceId: string;
  /** Wall-clock epoch milliseconds. Survives a relay unchanged. */
  readonly ts: number;
}

/** A discrete event: something happened. Renders as a shockwave, flash, or ripple. */
export interface PulseEvent {
  readonly type: 'pulse';
  readonly magnitude: Unit;
  /** Where on the canvas the pulse originates. Absent means "engine picks". */
  readonly location?: Point;
}

/** A directional flow: which way and how fast things are moving. */
export interface CurrentVector {
  readonly type: 'current';
  readonly x: Unit;
  readonly y: Unit;
  readonly velocity: Unit;
}

/** Slow-moving state: the overall feel. Palette and chaos. */
export interface AmbianceState {
  readonly type: 'ambiance';
  readonly moodScore: Unit;
  readonly turbulence: Unit;
}

export type SignalPayload = PulseEvent | CurrentVector | AmbianceState;

/** A payload plus its metadata: the unit that travels over the bus and the wire. */
export type VisualSignal = SignalPayload & SignalMeta;

export type SignalOf<T extends SignalType> = Extract<VisualSignal, { type: T }>;
export type PayloadOf<T extends SignalType> = Extract<SignalPayload, { type: T }>;

/** What a source author passes to the typed emit helpers: the fields only. */
export type PulseInput = Omit<PulseEvent, 'type'>;
export type CurrentInput = Omit<CurrentVector, 'type'>;
export type AmbianceInput = Omit<AmbianceState, 'type'>;
export type InputOf<T extends SignalType> = Omit<PayloadOf<T>, 'type'>;

/** Envelope for a future WebSocket relay. Types only in Phase 1. */
export type WireEnvelope =
  | { readonly v: ProtocolVersion; readonly kind: 'signal'; readonly signal: VisualSignal }
  | { readonly v: ProtocolVersion; readonly kind: 'hello'; readonly sourceIds: readonly string[] };

export function isSignalType(value: unknown): value is SignalType {
  return typeof value === 'string' && (SIGNAL_TYPES as readonly string[]).includes(value);
}

export function isSignalOf<T extends SignalType>(type: T) {
  return (signal: VisualSignal): signal is SignalOf<T> => signal.type === type;
}
