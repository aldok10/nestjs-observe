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
import { RedactionEngine } from '@aldok10/nestjs-observe-logger-core/redaction';

export interface PinoAdapterOptions extends LoggerAdapterOptions {
  readonly sink?: (record: LogRecord) => void | Promise<void>;
  readonly ownership?: 'backend' | 'package' | 'both';
  readonly levelMap?: Partial<Record<LogLevel, string>>;
}

export type AdapterOptions = PinoAdapterOptions;

// Structural stand-in: pino stays a peer dependency and is never imported eagerly by the adapter.
export interface PinoLike {
  trace?(...args: unknown[]): unknown;
  debug?(...args: unknown[]): unknown;
  info?(...args: unknown[]): unknown;
  warn?(...args: unknown[]): unknown;
  error?(...args: unknown[]): unknown;
  fatal?(...args: unknown[]): unknown;
  child?(bindings: Record<string, unknown>): PinoLike;
  level?: string;
}

const PINO_LEVELS: ResolvedLevelMap = {
  trace: 'trace',
  debug: 'debug',
  verbose: 'debug',
  info: 'info',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

const PINO_SUPPORTED = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export const PINO_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  structuredMetadata: true,
  childLoggers: true,
  contextBinding: true,
  dynamicLogLevels: false,
  nativeTransports: true,
  redaction: true,
  serialization: true,
  flush: false,
  gracefulShutdown: false,
};

export class PinoLoggerAdapter implements LoggerAdapter<PinoLike> {
  readonly name = 'pino';
  readonly capabilities: AdapterCapabilities = PINO_ADAPTER_CAPABILITIES;
  private readonly levelMappingResolver = new LevelMappingResolver();

  create(logger: PinoLike, options: PinoAdapterOptions): UniversalLogger {
    const levelMap = this.levelMappingResolver.resolve(
      this.name,
      PINO_LEVELS,
      options.levelMap,
      PINO_SUPPORTED,
    );
    const redactionEngine = new RedactionEngine(options.redaction);
    return new AdapterLogBridge<PinoLike>({
      name: this.name,
      backend: logger,
      options,
      levelMap,
      supportedLevels: PINO_SUPPORTED,
      fallbackLevel: 'info',
      write: (backend, method, record) => this.writeRecord(backend, method, record),
      deriveChild: (target, context) => this.deriveChild(target, context, redactionEngine),
    }).createLogger();
  }

  private writeRecord(backend: PinoLike, method: string, record: LogRecord): void {
    const fn: unknown = Reflect.get(backend, method);
    if (typeof fn !== 'function') return;
    fn.call(
      backend,
      { ...record, ...(record.error !== undefined ? { err: record.error } : {}) },
      record.message,
    );
  }

  private deriveChild(
    backend: PinoLike,
    context: LogContext,
    redactionEngine: RedactionEngine,
  ): PinoLike | undefined {
    if (typeof backend.child !== 'function') return undefined;
    const bindings = redactionEngine.sanitize(context);
    if (typeof bindings !== 'object' || bindings === null || Array.isArray(bindings))
      return undefined;
    return backend.child(Object.fromEntries(Object.entries(bindings)));
  }
}

export const PinoAdapter = PinoLoggerAdapter;
