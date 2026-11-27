import { randomUUID } from 'node:crypto';
import type { LogContext, LogLevel, LogRecord, LogSink } from '@aldok10/nestjs-observe-logger-core';
import { LogRecordFactory } from '@aldok10/nestjs-observe-logger-core';

export interface RequestIdOptions {
  readonly enabled: boolean;
  readonly header?: string;
  readonly generator?: () => string;
  readonly trustIncoming?: boolean;
}

export interface HttpLogLevels {
  readonly success?: LogLevel;
  readonly clientError?: LogLevel;
  readonly serverError?: LogLevel;
}

export interface RequestLoggingOptions {
  readonly requestId?: RequestIdOptions;
  readonly include?: readonly (string | RegExp)[];
  readonly exclude?: readonly (string | RegExp)[];
  readonly levels?: HttpLogLevels;
  readonly slowRequestMs?: number;
  readonly sampleRate?: number;
  readonly serializeHeaders?: (headers: Record<string, unknown>) => Record<string, unknown>;
  readonly redactHeaders?: readonly string[];
  readonly includeRequestHeaders?: boolean;
  readonly includeResponseHeaders?: boolean;
  readonly logErrors?: boolean;
  readonly onError?: (error: unknown, record: LogRecord) => void;
}

export interface HttpRequestLoggerOptions extends RequestLoggingOptions {
  readonly sink: LogSink;
}

export interface RequestLogInput {
  readonly options: HttpRequestLoggerOptions;
  readonly method: string;
  readonly route: string;
  readonly statusCode: number;
  readonly duration: number;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly responseHeaders?: Readonly<Record<string, unknown>>;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly clientDisconnected?: boolean;
  readonly error?: unknown;
}

export const DEFAULT_HEADER_ALLOWLIST: readonly string[] = [
  'accept',
  'content-type',
  'user-agent',
  'x-request-id',
  'x-correlation-id',
  'traceparent',
];

export class HttpRequestLogBuilder {
  constructor(private readonly recordFactory: LogRecordFactory = new LogRecordFactory()) {}

  isExcluded(route: string, exclude: HttpRequestLoggerOptions['exclude']): boolean {
    return (exclude ?? []).some((pattern) =>
      typeof pattern === 'string' ? route === pattern : pattern.test(route),
    );
  }

  shouldSkip(route: string, options: HttpRequestLoggerOptions): boolean {
    if (options.include !== undefined && options.include.length > 0) {
      const included = options.include.some((pattern) =>
        typeof pattern === 'string' ? route === pattern : pattern.test(route),
      );
      if (!included) return true;
    }
    return this.isExcluded(route, options.exclude);
  }

  shouldSample(options: HttpRequestLoggerOptions): boolean {
    const rate = options.sampleRate ?? 1;
    if (rate <= 0) return false;
    if (rate >= 1) return true;
    return Math.random() < rate;
  }

  build(input: RequestLogInput): LogRecord {
    const context = this.buildContext(input);
    const metadata = this.buildMetadata(input);
    const shouldLogError = input.options.logErrors ?? true;
    const record = this.recordFactory.create({
      level: this.resolveLevel(input),
      message: `${input.method} ${input.route} ${input.statusCode} ${Math.round(input.duration)}ms`,
      context: { ...context, metadata },
      ...(input.error !== undefined && shouldLogError ? { error: input.error } : {}),
    });
    return {
      ...record,
      method: input.method,
      route: input.route,
      statusCode: input.statusCode,
      duration: Math.round(input.duration * 1000) / 1000,
    };
  }

  private buildContext(input: RequestLogInput): LogContext {
    const headers = input.headers;
    const idOptions = input.options.requestId;
    const enabled = idOptions?.enabled ?? true;
    const incomingId = this.readHeader(headers, idOptions?.header ?? 'x-request-id');
    const requestId = enabled
      ? (input.requestId ??
        (idOptions?.trustIncoming === false ? undefined : incomingId) ??
        idOptions?.generator?.() ??
        randomUUID())
      : undefined;

    const spanIds = this.parseTraceparent(this.readHeader(headers, 'traceparent'));
    const correlationId = input.correlationId ?? this.readHeader(headers, 'x-correlation-id');
    const traceId = input.traceId ?? spanIds.traceId;
    const spanId = input.spanId ?? spanIds.spanId;
    return {
      ...(requestId !== undefined ? { requestId } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(traceId !== undefined ? { traceId } : {}),
      ...(spanId !== undefined ? { spanId } : {}),
    };
  }

  private buildMetadata(input: RequestLogInput): Record<string, unknown> {
    const requestHeaders =
      input.options.includeRequestHeaders === false
        ? {}
        : this.selectAllowlistedHeaders(input.headers, input.options.redactHeaders);
    const responseHeaders =
      input.options.includeResponseHeaders === true
        ? this.selectAllowlistedHeaders(input.responseHeaders, input.options.redactHeaders)
        : {};
    const serializeHeaders = input.options.serializeHeaders;
    const serializedRequest =
      Object.keys(requestHeaders).length > 0 && serializeHeaders !== undefined
        ? serializeHeaders(requestHeaders)
        : requestHeaders;
    const serializedResponse =
      Object.keys(responseHeaders).length > 0 && serializeHeaders !== undefined
        ? serializeHeaders(responseHeaders)
        : responseHeaders;
    const slowMs = input.options.slowRequestMs;
    const isSlow = slowMs !== undefined && input.duration >= slowMs;
    return {
      ...(Object.keys(serializedRequest).length > 0 ? { headers: serializedRequest } : {}),
      ...(Object.keys(serializedResponse).length > 0
        ? { responseHeaders: serializedResponse }
        : {}),
      ...(isSlow ? { slowRequest: true } : {}),
      ...(input.clientDisconnected === true ? { clientDisconnected: true } : {}),
    };
  }

  write(
    sink: LogSink,
    record: LogRecord,
    onError?: (error: unknown, record: LogRecord) => void,
  ): void {
    const report = (error: unknown): void => {
      if (onError === undefined) return;
      try {
        onError(error, record);
      } catch {
        // Diagnostics must not reach the request path.
      }
    };
    let result: void | Promise<void>;
    try {
      result = sink(record);
    } catch (error: unknown) {
      report(error);
      return;
    }
    if (result !== undefined && typeof result.then === 'function') void result.catch(report);
  }

  private readHeader(
    headers: Readonly<Record<string, unknown>> | undefined,
    name: string,
  ): string | undefined {
    if (headers === undefined) return undefined;
    const direct = headers[name];
    if (typeof direct === 'string') return direct;
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() !== lower) continue;
      const value = headers[key];
      if (typeof value === 'string') return value;
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    }
    return undefined;
  }

  private selectAllowlistedHeaders(
    headers: Readonly<Record<string, unknown>> | undefined,
    redactHeaders?: readonly string[],
  ): Record<string, unknown> {
    if (headers === undefined) return {};
    const redacted = new Set((redactHeaders ?? []).map((h) => h.toLowerCase()));
    const result: Record<string, unknown> = {};
    for (const key of DEFAULT_HEADER_ALLOWLIST) {
      if (redacted.has(key.toLowerCase())) continue;
      const value = this.readHeader(headers, key);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  private parseTraceparent(value: string | undefined): { traceId?: string; spanId?: string } {
    const parts = value?.split('-');
    if (parts === undefined || parts.length < 3) return {};
    const traceId = parts[1];
    const spanId = parts[2];
    return {
      ...(traceId !== undefined && /^[0-9a-f]{32}$/i.test(traceId) ? { traceId } : {}),
      ...(spanId !== undefined && /^[0-9a-f]{16}$/i.test(spanId) ? { spanId } : {}),
    };
  }

  private resolveLevel(input: RequestLogInput): LogLevel {
    if (input.statusCode >= 500) return input.options.levels?.serverError ?? 'error';
    if (input.statusCode >= 400) return input.options.levels?.clientError ?? 'warn';
    if (input.clientDisconnected === true) return 'warn';
    return input.options.levels?.success ?? 'info';
  }
}

const DEFAULT_HTTP_REQUEST_LOG_BUILDER = new HttpRequestLogBuilder();

export function isExcluded(route: string, exclude: HttpRequestLoggerOptions['exclude']): boolean {
  return DEFAULT_HTTP_REQUEST_LOG_BUILDER.isExcluded(route, exclude);
}

export function shouldSample(options: HttpRequestLoggerOptions): boolean {
  return DEFAULT_HTTP_REQUEST_LOG_BUILDER.shouldSample(options);
}

export function buildRequestLogRecord(input: RequestLogInput): LogRecord {
  return DEFAULT_HTTP_REQUEST_LOG_BUILDER.build(input);
}

export function writeLogRecord(
  sink: LogSink,
  record: LogRecord,
  onError?: (error: unknown, record: LogRecord) => void,
): void {
  DEFAULT_HTTP_REQUEST_LOG_BUILDER.write(sink, record, onError);
}
