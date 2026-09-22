// Protocol

// Bus and transport
export { DataSignalBus, type DataSignalBusOptions } from './bus.js';
export { isDev } from './env.js';
export { BusDisposedError, SignalValidationError, SourceStateError } from './errors.js';
// Math and validation
export { clamp01, isUnit, normalize } from './math.js';
export { bufferSignals, latestSignal, ofType, throttleSignals } from './operators.js';
export {
  type AmbianceInput,
  type AmbianceState,
  type CurrentInput,
  type CurrentVector,
  isSignalOf,
  isSignalType,
  type PayloadOf,
  type Point,
  PROTOCOL_VERSION,
  type ProtocolVersion,
  type PulseEvent,
  type PulseInput,
  SIGNAL_TYPES,
  type SignalMeta,
  type SignalOf,
  type SignalPayload,
  type SignalType,
  type Unit,
  type VisualSignal,
  type WireEnvelope,
} from './protocol.js';
export { mount, SourceRegistry } from './registry.js';
// Shader contract
export {
  type GeometryPass,
  type PostHints,
  type ShaderManifest,
  STANDARD_UNIFORMS,
  type StandardUniform,
  type UniformDeclaration,
  type UniformKind,
} from './shader-manifest.js';

// Sources
export {
  createSource,
  type Source,
  type SourceContext,
  type SourceDefinition,
  type SourceFactory,
  type SourceInstanceOptions,
  type SourceStatus,
  type Teardown,
} from './source.js';
export { InMemoryTransport, type SignalTransport } from './transport.js';
export {
  assertFinite,
  isVisualSignal,
  type NormalizeOptions,
  normalizePayload,
  validateSignal,
} from './validate.js';
