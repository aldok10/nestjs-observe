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

export interface BunyanAdapterOptions extends LoggerAdapterOptions {
  readonly sink?: (record: LogRecord) => void | Promise<void>;
  readonly ownership?: 'backend' | 'package' | 'both';
  readonly levelMap?: Partial<Record<LogLevel, string>>;
}

export type AdapterOptions = BunyanAdapterOptions;

// Structural stand-in: bunyan stays a peer dependency and is never imported by the adapter.
export interface BunyanLike {
  trace?(...args: unknown[]): unknown;
  debug?(...args: unknown[]): unknown;
  info?(...args: unknown[]): unknown;
  warn?(...args: unknown[]): unknown;
  error?(...args: unknown[]): unknown;
  fatal?(...args: unknown[]): unknown;
  child?(bindings: Record<string, unknown>): BunyanLike;
  level?: string;
}

const BUNYAN_LEVELS: ResolvedLevelMap = {
  trace: 'trace',
  debug: 'debug',
  verbose: 'debug',
  info: 'info',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

const BUNYAN_SUPPORTED = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export const BUNYAN_ADAPTER_CAPABILITIES: AdapterCapabilities = {
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

export class BunyanLoggerAdapter implements LoggerAdapter<BunyanLike> {
  readonly name = 'bunyan';
  readonly capabilities: AdapterCapabilities = BUNYAN_ADAPTER_CAPABILITIES;
  private readonly levelMappingResolver = new LevelMappingResolver();

  create(logger: BunyanLike, options: BunyanAdapterOptions): UniversalLogger {
    const levelMap = this.levelMappingResolver.resolve(
      this.name,
      BUNYAN_LEVELS,
      options.levelMap,
      BUNYAN_SUPPORTED,
    );
    const redactionEngine = new RedactionEngine(options.redaction);
    return new AdapterLogBridge<BunyanLike>({
      name: this.name,
      backend: logger,
      options,
      levelMap,
      supportedLevels: BUNYAN_SUPPORTED,
      fallbackLevel: 'info',
      write: (backend, method, record) => this.writeRecord(backend, method, record),
      deriveChild: (target, context) => this.deriveChild(target, context, redactionEngine),
    }).createLogger();
  }

  private writeRecord(backend: BunyanLike, method: string, record: LogRecord): void {
    const fn: unknown = Reflect.get(backend, method);
    if (typeof fn !== 'function') return;
    fn.call(
      backend,
      { ...record, ...(record.error !== undefined ? { err: record.error } : {}) },
      record.message,
    );
  }

  private deriveChild(
    backend: BunyanLike,
    context: LogContext,
    redactionEngine: RedactionEngine,
  ): BunyanLike | undefined {
    if (typeof backend.child !== 'function') return undefined;
    const bindings = redactionEngine.sanitize(context);
    if (typeof bindings !== 'object' || bindings === null || Array.isArray(bindings))
      return undefined;
    return backend.child(Object.fromEntries(Object.entries(bindings)));
  }
}

export const BunyanAdapter = BunyanLoggerAdapter;
