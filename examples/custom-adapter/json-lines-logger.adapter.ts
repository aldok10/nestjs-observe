import type {
  AdapterCapabilities,
  LogContext,
  LogLevel,
  LoggerAdapter,
  LoggerAdapterOptions,
  UniversalLogger,
} from '@aldok10/nestjs-observe-logger-core';

/** Anything with a `write(line)` method: process.stdout, a file stream, or an in-memory buffer. */
export interface LineSink {
  write(line: string): unknown;
}

const LEVEL_ORDER: readonly LogLevel[] = [
  'trace',
  'debug',
  'verbose',
  'info',
  'log',
  'warn',
  'error',
  'fatal',
];

/**
 * Minimal custom adapter: writes one JSON object per line to a sink.
 * It declares only the capabilities it really has; everything else stays false.
 */
export class JsonLinesLoggerAdapter implements LoggerAdapter<LineSink | undefined> {
  readonly name = 'json-lines';
  readonly capabilities: Partial<AdapterCapabilities> = {
    structuredMetadata: true,
    contextBinding: true,
    flush: false,
    gracefulShutdown: true,
  };
  private readonly defaultSink: LineSink;
  private disposed = false;

  constructor(defaultSink: LineSink = process.stdout) {
    this.defaultSink = defaultSink;
  }

  initialize(options?: LoggerAdapterOptions): void {
    this.defaultSink.write(
      `${JSON.stringify({ event: 'adapter.initialize', level: options?.level ?? 'info' })}\n`,
    );
  }

  create(logger: LineSink | undefined, options: LoggerAdapterOptions): UniversalLogger {
    return new JsonLinesLogger(logger ?? this.defaultSink, options, () => this.disposed);
  }

  dispose(): void {
    this.disposed = true;
    this.defaultSink.write(`${JSON.stringify({ event: 'adapter.dispose' })}\n`);
  }
}

class JsonLinesLogger implements UniversalLogger {
  private readonly minimum: number;

  constructor(
    private readonly sink: LineSink,
    private readonly options: LoggerAdapterOptions,
    private readonly isDisposed: () => boolean,
  ) {
    this.minimum = LEVEL_ORDER.indexOf(options.level);
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  log(message: string, context?: LogContext): void {
    this.write('log', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (this.isDisposed() || LEVEL_ORDER.indexOf(level) < this.minimum) return;
    const record = { level, message, ...this.options.context, ...context };
    this.sink.write(`${JSON.stringify(record)}\n`);
  }
}
