export { LOG_LEVELS, isLogLevel, levelIndex, normalizeLogLevel } from './levels.js';

export type LogLevel = 'trace' | 'debug' | 'verbose' | 'info' | 'log' | 'warn' | 'error' | 'fatal';

/** Structured metadata attached to log events/records. */
export type LogMetadata = Readonly<Record<string, unknown>>;

/**
 * Canonical log event record emitted through the pipeline.
 * @deprecated Use `LogRecord` instead. See docs/MIGRATION.md.
 */
export type LogEvent = LogRecord;

export interface LogContext {
  readonly context?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface UniversalLogger {
  trace?(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  verbose?(message: string, context?: LogContext): void;
  info?(message: string, context?: LogContext): void;
  log(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  fatal?(message: string, context?: LogContext): void;
}

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly code?: string;
  readonly cause?: unknown;
}

export interface LogSource {
  readonly file?: string;
  readonly line?: number;
  readonly function?: string;
}

export interface LogRecord {
  readonly schemaVersion: number;
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly message: string;
  readonly channel?: string;
  readonly service?: string;
  readonly application?: string;
  readonly environment?: string;
  readonly instanceId?: string;
  readonly hostname?: string;
  readonly processId?: number;
  readonly context?: string;
  readonly module?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly method?: string;
  readonly route?: string;
  readonly statusCode?: number;
  readonly duration?: number;
  readonly source?: LogSource;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly error?: SerializedError;
}

export type RedactionMatcher = (key: string, value: unknown) => boolean;

export interface LogRedactor {
  redact<T>(value: T): T;
  redactRecord(record: LogRecord): LogRecord;
}

export interface RedactionOptions {
  readonly patterns?: readonly (string | RegExp)[];
  readonly allowlist?: readonly string[];
  readonly denylist?: readonly string[];
  readonly matchers?: readonly RedactionMatcher[];
  readonly replacement?: string;
  readonly maxDepth?: number;
  readonly maxKeys?: number;
  readonly maxStringLength?: number;
}

export type TimestampFormat = 'iso' | 'epoch';

export interface FormatterOptions {
  readonly timestamp?: TimestampFormat;
  readonly includeMetadata?: boolean;
}

export type FormatterType = 'json' | 'prettyJson' | 'text';

export interface LogFormatter {
  format(record: LogRecord): string | Buffer;
}

export interface LogSerializer<TInput = LogRecord, TOutput = string | Buffer> {
  serialize(value: TInput): TOutput;
}

export interface LoggerAdapterOptions {
  readonly level: LogLevel;
  readonly redaction?: RedactionOptions;
  readonly format?: FormatterType | LogFormatter;
  readonly context?: LogContext;
}

export interface AdapterCapabilities {
  readonly structuredMetadata: boolean;
  readonly childLoggers: boolean;
  readonly contextBinding: boolean;
  readonly dynamicLogLevels: boolean;
  readonly nativeTransports: boolean;
  readonly redaction: boolean;
  readonly serialization: boolean;
  readonly flush: boolean;
  readonly gracefulShutdown: boolean;
}

export interface LoggerAdapter<TLogger = unknown> {
  readonly name: string;
  readonly capabilities?: Partial<AdapterCapabilities>;
  initialize?(options?: LoggerAdapterOptions): Promise<void> | void;
  create(logger: TLogger, options: LoggerAdapterOptions): UniversalLogger;
  dispose?(): Promise<void> | void;
}

export interface BackendConfigBase {
  readonly level?: LogLevel;
  readonly redaction?: RedactionOptions;
  readonly format?: FormatterType | LogFormatter;
  readonly context?: LogContext;
}

/**
 * Generic backend adapter configuration. Core does not implement backend-specific integrations;
 * adapters/backends are registered explicitly and owned by their packages.
 */
export interface BackendConfig extends BackendConfigBase {
  readonly type: string;
  readonly logger?: unknown;
  readonly adapter?: LoggerAdapter;
}

export interface TransportHealth {
  readonly name: string;
  readonly status: 'healthy' | 'degraded' | 'down';
  readonly healthy: boolean;
  readonly queued: number;
  readonly capacity: number;
  readonly dropped: number;
  readonly sent: number;
  readonly failed: number;
  readonly lastSuccessAt?: number;
  readonly lastErrorAt?: number;
  readonly lastError?: string;
}
export interface LogTransport {
  readonly name: string;
  write(record: LogRecord): void | Promise<void>;
  flush?(timeoutMs?: number): Promise<void>;
  health?(): TransportHealth;
  close?(): Promise<void>;
}
export interface RemoteLogTransport {
  write(records: readonly LogRecord[]): Promise<void>;
  healthCheck?(): Promise<TransportHealth>;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}
export interface LogPipelineOptions {
  readonly redaction?: RedactionOptions;
  readonly format?: FormatterType | LogFormatter;
  readonly transports: readonly LogTransport[];
  readonly onTransportError?: (transportName: string, error: unknown) => void;
}
export interface ResolverOptions {
  readonly level: LogLevel;
  readonly redaction?: RedactionOptions;
  readonly format?: FormatterType | LogFormatter;
  readonly context?: LogContext;
}

/** Filter/predicate contract for accepting or dropping log records. */
export type LogFilter = (record: LogRecord, context?: LogContext) => boolean;

/** Provides contextual fields to be merged into log records/events. */
export interface LogContextProvider {
  getContext(): LogContext | undefined;
  runWithContext?<T>(context: LogContext, fn: () => T): T;
}

/** Result of a delivery attempt to a transport/destination. */
export interface DeliveryResult {
  readonly transport: string;
  readonly ok: boolean;
  readonly records: number;
  readonly durationMs?: number;
  readonly error?: unknown;
}

/** Typed pipeline failure information for observability and error handling. */
export interface LogPipelineError {
  readonly stage: 'normalize' | 'redact' | 'format' | 'write' | 'flush' | 'close' | 'route';
  readonly transport?: string;
  readonly channel?: string;
  readonly error: unknown;
  readonly record?: LogRecord;
}

/** Resource with explicit lifecycle ownership. */
export interface LifecycleManaged {
  initialize?(): Promise<void> | void;
  flush?(timeoutMs?: number): Promise<void>;
  close?(): Promise<void>;
  isHealthy?(): boolean;
}

/** Coordinates lifecycle for registered managed resources. */
export interface LifecycleOwner {
  register(resource: LifecycleManaged): void;
  flush(timeoutMs?: number): Promise<void>;
  shutdown(timeoutMs?: number): Promise<void>;
}
