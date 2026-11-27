import type {
  BackendConfig,
  LogContext,
  LogLevel,
  LogRecord,
  LogTransport,
  LoggerAdapter,
  UniversalLogger,
} from '../contracts/index.js';
import type { AdapterResolver } from '../resolver/adapter.resolver.js';
import type { AdapterOptionsBase } from './adapter-log.bridge.js';

export interface BackendTransportDefaults {
  readonly level?: LogLevel | undefined;
  readonly format?: AdapterOptionsBase['format'];
  readonly redaction?: AdapterOptionsBase['redaction'];
  readonly context?: LogContext | undefined;
}

export class BackendTransportAdapter implements LogTransport {
  readonly name: string;
  private readonly logger: UniversalLogger;

  constructor(
    backend: BackendConfig,
    resolver: AdapterResolver,
    defaults: BackendTransportDefaults = {},
  ) {
    const adapterName = backend.adapter?.name ?? backend.type;
    this.name = `backend:${adapterName}`;
    this.logger = resolveBackendLogger(backend, resolver, {
      level: defaults.level ?? backend.level ?? 'trace',
      ...(defaults.format !== undefined || backend.format !== undefined
        ? { format: defaults.format ?? backend.format }
        : {}),
      ...(defaults.redaction !== undefined || backend.redaction !== undefined
        ? { redaction: defaults.redaction ?? backend.redaction }
        : {}),
      ...(defaults.context !== undefined || backend.context !== undefined
        ? { context: defaults.context ?? backend.context }
        : {}),
      ownership: 'backend',
    });
  }

  write(record: LogRecord): void {
    const metadata =
      record.error !== undefined ? { ...record.metadata, error: record.error } : record.metadata;
    const context: LogContext = {
      ...(record.context !== undefined ? { context: record.context } : {}),
      ...(record.traceId !== undefined ? { traceId: record.traceId } : {}),
      ...(record.spanId !== undefined ? { spanId: record.spanId } : {}),
      ...(record.requestId !== undefined ? { requestId: record.requestId } : {}),
      ...(record.correlationId !== undefined ? { correlationId: record.correlationId } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    };
    switch (record.level) {
      case 'trace':
        (this.logger.trace ?? this.logger.log)(record.message, context);
        break;
      case 'debug':
        this.logger.debug(record.message, context);
        break;
      case 'verbose':
        (this.logger.verbose ?? this.logger.log)(record.message, context);
        break;
      case 'info':
        (this.logger.info ?? this.logger.log)(record.message, context);
        break;
      case 'log':
        this.logger.log(record.message, context);
        break;
      case 'warn':
        this.logger.warn(record.message, context);
        break;
      case 'error':
        this.logger.error(record.message, context);
        break;
      case 'fatal':
        (this.logger.fatal ?? this.logger.error)(record.message, context);
        break;
    }
  }
}

export function hasExternalBackend(backend: BackendConfig | undefined): backend is BackendConfig {
  if (backend === undefined) return false;
  return backend.logger !== undefined || backend.adapter !== undefined;
}

export function resolveBackendLogger(
  backend: BackendConfig,
  resolver: AdapterResolver,
  options: AdapterOptionsBase,
): UniversalLogger {
  const adapter: LoggerAdapter = backend.adapter ?? resolver.resolve(backend.type);
  return adapter.create(backend.logger, options);
}

export function createBackendTransport(
  backend: BackendConfig,
  resolver: AdapterResolver,
  defaults: BackendTransportDefaults = {},
): LogTransport {
  return new BackendTransportAdapter(backend, resolver, defaults);
}
