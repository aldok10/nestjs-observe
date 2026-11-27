import type {
  AdapterCapabilities,
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

export interface Log4jsAdapterOptions extends LoggerAdapterOptions {
  readonly sink?: (record: LogRecord) => void | Promise<void>;
  readonly ownership?: 'backend' | 'package' | 'both';
  readonly levelMap?: Partial<Record<LogLevel, string>>;
}

export type AdapterOptions = Log4jsAdapterOptions;

// Structural stand-in: log4js stays a peer dependency and is never imported eagerly by the adapter.
export interface Log4jsLike {
  trace?(...args: unknown[]): unknown;
  debug?(...args: unknown[]): unknown;
  info?(...args: unknown[]): unknown;
  warn?(...args: unknown[]): unknown;
  error?(...args: unknown[]): unknown;
  fatal?(...args: unknown[]): unknown;
  mark?(...args: unknown[]): unknown;
  level?: string;
}

const LOG4JS_LEVELS: ResolvedLevelMap = {
  trace: 'trace',
  debug: 'debug',
  verbose: 'debug',
  info: 'info',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

const LOG4JS_SUPPORTED = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'mark'] as const;

export const LOG4JS_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  structuredMetadata: true,
  childLoggers: false,
  contextBinding: true,
  dynamicLogLevels: false,
  nativeTransports: true,
  redaction: true,
  serialization: true,
  flush: false,
  gracefulShutdown: false,
};

export class Log4jsLoggerAdapter implements LoggerAdapter<Log4jsLike> {
  readonly name = 'log4js';
  readonly capabilities: AdapterCapabilities = LOG4JS_ADAPTER_CAPABILITIES;
  private readonly levelMappingResolver = new LevelMappingResolver();

  create(logger: Log4jsLike, options: Log4jsAdapterOptions): UniversalLogger {
    const levelMap = this.levelMappingResolver.resolve(
      this.name,
      LOG4JS_LEVELS,
      options.levelMap,
      LOG4JS_SUPPORTED,
    );
    return new AdapterLogBridge<Log4jsLike>({
      name: this.name,
      backend: logger,
      options,
      levelMap,
      supportedLevels: LOG4JS_SUPPORTED,
      fallbackLevel: 'info',
      write: (backend, method, record) => this.writeRecord(backend, method, record),
    }).createLogger();
  }

  private writeRecord(backend: Log4jsLike, method: string, record: LogRecord): void {
    const fn: unknown = Reflect.get(backend, method);
    if (typeof fn !== 'function') return;
    const { message, ...meta } = record;
    fn.call(backend, message, meta);
  }
}

export const Log4jsAdapter = Log4jsLoggerAdapter;
