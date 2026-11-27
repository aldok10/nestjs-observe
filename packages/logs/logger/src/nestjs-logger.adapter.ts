import type {
  AdapterCapabilities,
  LogContext,
  LogLevel,
  LogRecord,
  LoggerAdapter,
  LoggerAdapterOptions,
  UniversalLogger,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import {
  AdapterLogBridge,
  LevelMappingResolver,
  type ResolvedLevelMap,
} from '@aldok10/nestjs-observe-logger-core';

export interface NestjsAdapterOptions extends LoggerAdapterOptions {
  readonly sink?: (record: LogRecord) => void | Promise<void>;
  readonly ownership?: 'backend' | 'package' | 'both';
  readonly levelMap?: Partial<Record<LogLevel, string>>;
}

export type AdapterOptions = NestjsAdapterOptions;

// Structural stand-in for @nestjs/common LoggerService.
export interface LoggerServiceLike {
  log?(...args: unknown[]): unknown;
  error?(...args: unknown[]): unknown;
  warn?(...args: unknown[]): unknown;
  debug?(...args: unknown[]): unknown;
  verbose?(...args: unknown[]): unknown;
  fatal?(...args: unknown[]): unknown;
  child?(context: string): LoggerServiceLike;
  setLogLevels?(levels: readonly string[]): void;
}

const NEST_LEVELS: ResolvedLevelMap = {
  trace: 'verbose',
  debug: 'debug',
  verbose: 'verbose',
  info: 'log',
  log: 'log',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

const NEST_SUPPORTED = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;

export const NESTJS_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  structuredMetadata: false,
  childLoggers: true,
  contextBinding: true,
  dynamicLogLevels: true,
  nativeTransports: false,
  redaction: true,
  serialization: false,
  flush: false,
  gracefulShutdown: false,
};

export class NestjsLoggerAdapter implements LoggerAdapter<LoggerServiceLike> {
  readonly name = 'nestjs';
  readonly capabilities: AdapterCapabilities = NESTJS_ADAPTER_CAPABILITIES;
  private readonly levelMappingResolver = new LevelMappingResolver();

  create(logger: LoggerServiceLike, options: NestjsAdapterOptions): UniversalLogger {
    const levelMap = this.levelMappingResolver.resolve(
      this.name,
      NEST_LEVELS,
      options.levelMap,
      NEST_SUPPORTED,
    );
    return new AdapterLogBridge<LoggerServiceLike>({
      name: this.name,
      backend: logger,
      options,
      levelMap,
      supportedLevels: NEST_SUPPORTED,
      fallbackLevel: 'log',
      write: (backend, method, record) => this.writeRecord(backend, method, record),
      deriveChild: (backend, context) => this.deriveChild(backend, context),
      setLevels: (backend, levels) => {
        if (typeof backend.setLogLevels !== 'function') return;
        backend.setLogLevels(Array.from(new Set(levels.map((level) => levelMap[level]))));
      },
    }).createLogger();
  }

  private writeRecord(backend: LoggerServiceLike, method: string, record: LogRecord): void {
    const fn: unknown = Reflect.get(backend, method);
    if (typeof fn !== 'function') return;
    if (method === 'error' && record.error !== undefined) {
      fn.call(
        backend,
        record.message,
        record.context ?? '',
        record.error.stack ?? record.error.message,
      );
      return;
    }
    fn.call(backend, record.message, record.context ?? '');
  }

  private deriveChild(
    backend: LoggerServiceLike,
    context: LogContext,
  ): LoggerServiceLike | undefined {
    if (typeof backend.child !== 'function') return undefined;
    return backend.child(context.context ?? '');
  }
}

/**
 * @deprecated Use `NestjsLoggerAdapter` instead. See docs/MIGRATION.md.
 */
export const NestjsAdapter = NestjsLoggerAdapter;
