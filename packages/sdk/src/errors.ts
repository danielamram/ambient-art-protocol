export class SignalValidationError extends Error {
  override readonly name = 'SignalValidationError';
  readonly field: string;
  readonly value: unknown;
  readonly sourceId: string | undefined;

  constructor(field: string, value: unknown, sourceId?: string) {
    const where = sourceId ? ` (source "${sourceId}")` : '';
    super(
      `Invalid signal field "${field}"${where}: expected a finite number, got ${String(value)}`,
    );
    this.field = field;
    this.value = value;
    this.sourceId = sourceId;
  }
}

export class BusDisposedError extends Error {
  override readonly name = 'BusDisposedError';
  constructor() {
    super('DataSignalBus has been disposed; no further signals can be emitted');
  }
}

export class SourceStateError extends Error {
  override readonly name = 'SourceStateError';
  readonly sourceId: string;
  readonly status: string;

  constructor(sourceId: string, status: string, attempted: string) {
    super(`Source "${sourceId}" cannot ${attempted} while ${status}`);
    this.sourceId = sourceId;
    this.status = status;
  }
}
