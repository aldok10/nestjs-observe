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

export interface WinstonAdapterOptions extends LoggerAdapterOptions {
  readonly sink?: (record: LogRecord) => void | Promise<void>;
  readonly ownership?: 'backend' | 'package' | 'both';
  readonly levelMap?: Partial<Record<LogLevel, string>>;
}

export type AdapterOptions = WinstonAdapterOptions;

// Structural stand-in: winston stays a peer dependency and is never imported eagerly by the adapter.
export interface WinstonLike {
  error?(...args: unknown[]): unknown;
  warn?(...args: unknown[]): unknown;
  info?(...args: unknown[]): unknown;
  http?(...args: unknown[]): unknown;
  verbose?(...args: unknown[]): unknown;
  debug?(...args: unknown[]): unknown;
  silly?(...args: unknown[]): unknown;
  child?(bindings: Record<string, unknown>): WinstonLike;
  level?: string;
}

const WINSTON_LEVELS: ResolvedLevelMap = {
  trace: 'debug',
  debug: 'debug',
  verbose: 'verbose',
  info: 'info',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
};

const WINSTON_SUPPORTED = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'] as const;

export const WINSTON_ADAPTER_CAPABILITIES: AdapterCapabilities = {
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

export class WinstonLoggerAdapter implements LoggerAdapter<WinstonLike> {
  readonly name = 'winston';
  readonly capabilities: AdapterCapabilities = WINSTON_ADAPTER_CAPABILITIES;
  private readonly levelMappingResolver = new LevelMappingResolver();

  create(logger: WinstonLike, options: WinstonAdapterOptions): UniversalLogger {
    const levelMap = this.levelMappingResolver.resolve(
      this.name,
      WINSTON_LEVELS,
      options.levelMap,
      WINSTON_SUPPORTED,
    );
    const redactionEngine = new RedactionEngine(options.redaction);
    return new AdapterLogBridge<WinstonLike>({
      name: this.name,
      backend: logger,
      options,
      levelMap,
      supportedLevels: WINSTON_SUPPORTED,
      fallbackLevel: 'info',
      write: (backend, method, record) => this.writeRecord(backend, method, record),
      deriveChild: (target, context) => this.deriveChild(target, context, redactionEngine),
    }).createLogger();
  }

  private writeRecord(backend: WinstonLike, method: string, record: LogRecord): void {
    const fn: unknown = Reflect.get(backend, method);
    if (typeof fn !== 'function') return;
    const { message, ...meta } = record;
    fn.call(backend, message, meta);
  }

  private deriveChild(
    backend: WinstonLike,
    context: LogContext,
    redactionEngine: RedactionEngine,
  ): WinstonLike | undefined {
    if (typeof backend.child !== 'function') return undefined;
    const bindings = redactionEngine.sanitize(context);
    if (typeof bindings !== 'object' || bindings === null || Array.isArray(bindings))
      return undefined;
    return backend.child(Object.fromEntries(Object.entries(bindings)));
  }
}

export const WinstonAdapter = WinstonLoggerAdapter;
