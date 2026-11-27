export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticEvent {
  readonly domain: string;
  readonly level: DiagnosticLevel;
  readonly message: string;
  readonly error?: unknown;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface DiagnosticsSink {
  emit(event: DiagnosticEvent): void;
}

export class NoopDiagnosticsSink implements DiagnosticsSink {
  emit(_event: DiagnosticEvent): void {
    // Intentionally empty.
  }
}

export class StderrDiagnosticsSink implements DiagnosticsSink {
  private readonly minLevel: DiagnosticLevel;
  private readonly stream: Pick<NodeJS.WriteStream, 'write'>;

  constructor(
    options: {
      readonly minLevel?: DiagnosticLevel;
      readonly stream?: Pick<NodeJS.WriteStream, 'write'>;
    } = {},
  ) {
    this.minLevel = options.minLevel ?? 'warn';
    this.stream = options.stream ?? process.stderr;
  }

  emit(event: DiagnosticEvent): void {
    if (!shouldEmit(event.level, this.minLevel)) return;
    const errorSuffix =
      event.error instanceof Error
        ? ` (${event.error.message})`
        : typeof event.error === 'string'
          ? ` (${event.error})`
          : event.error !== undefined
            ? ` (${JSON.stringify(event.error)})`
            : '';
    this.stream.write(
      `[nestjs-observe:${event.domain}] [${event.level.toUpperCase()}] ${event.message}${errorSuffix}\n`,
    );
  }
}

const LEVEL_ORDER: Readonly<Record<DiagnosticLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldEmit(level: DiagnosticLevel, minLevel: DiagnosticLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}
