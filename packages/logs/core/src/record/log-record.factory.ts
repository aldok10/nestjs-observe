import { hostname } from 'node:os';
import { readProcessEnvelope } from '../config/env.js';
import type { LogContext, LogLevel, LogRecord } from '../contracts/index.js';
import { RedactionEngine, type SafeValue } from '../redaction/redaction-engine.js';
import { ErrorSerializer } from './error.serializer.js';

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_METADATA_KEYS = 64;
const DEFAULT_MAX_METADATA_DEPTH = 4;

interface ProcessEnvelope {
  readonly hostname: string;
  readonly processId: number;
  readonly service?: string;
  readonly application?: string;
  readonly environment?: string;
  readonly instanceId?: string;
}

export interface CreateLogRecordLimits {
  readonly maxMetadataKeys?: number;
  readonly maxMetadataDepth?: number;
  readonly maxCauseDepth?: number;
}

export interface CreateLogRecordInput {
  readonly level: LogLevel;
  readonly message: string;
  readonly channel?: string;
  readonly context?: LogContext;
  readonly error?: unknown;
  readonly source?: LogRecord['source'];
  readonly limits?: CreateLogRecordLimits;
}

export class LogRecordFactory {
  private cachedEnvelope: ProcessEnvelope | undefined;

  constructor(private readonly errorSerializer: ErrorSerializer = new ErrorSerializer()) {}

  create(input: CreateLogRecordInput): LogRecord {
    const context = input.context;
    const source = input.source !== undefined ? sanitizeSource(input.source) : undefined;
    const metadata = this.safeMetadata(
      context?.metadata,
      input.limits?.maxMetadataKeys ?? DEFAULT_MAX_METADATA_KEYS,
      input.limits?.maxMetadataDepth ?? DEFAULT_MAX_METADATA_DEPTH,
    );
    const error =
      input.error !== undefined
        ? this.errorSerializer.serialize(input.error, input.limits?.maxCauseDepth)
        : undefined;

    return {
      ...this.getProcessEnvelope(),
      schemaVersion: SCHEMA_VERSION,
      timestamp: Date.now(),
      level: input.level,
      message: RedactionEngine.safeString(input.message),
      ...(input.channel !== undefined
        ? { channel: RedactionEngine.safeString(input.channel) }
        : {}),
      ...(context?.context !== undefined ? { context: context.context } : {}),
      ...(context?.traceId !== undefined ? { traceId: context.traceId } : {}),
      ...(context?.spanId !== undefined ? { spanId: context.spanId } : {}),
      ...(context?.requestId !== undefined ? { requestId: context.requestId } : {}),
      ...(context?.correlationId !== undefined ? { correlationId: context.correlationId } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(error !== undefined ? { error } : {}),
    };
  }

  private getProcessEnvelope(): ProcessEnvelope {
    if (this.cachedEnvelope !== undefined) return this.cachedEnvelope;
    const env = readProcessEnvelope();
    const envelope: ProcessEnvelope = {
      hostname: hostname(),
      processId: process.pid,
      ...env,
    };
    this.cachedEnvelope = envelope;
    return envelope;
  }

  private safeMetadata(
    input: unknown,
    maxKeys: number,
    maxDepth: number,
  ): Record<string, unknown> | undefined {
    const sanitized = new RedactionEngine({ maxKeys, maxDepth }).sanitize(input);
    if (!isSafeRecord(sanitized) || Object.keys(sanitized).length === 0) return undefined;
    return sanitized;
  }
}

function sanitizeSource(source: NonNullable<LogRecord['source']>): LogRecord['source'] | undefined {
  const sanitized = new RedactionEngine({ maxKeys: 16, maxDepth: 2 }).sanitize(source);
  if (!isSafeRecord(sanitized)) return undefined;
  const file = sanitized['file'];
  const line = sanitized['line'];
  const fn = sanitized['function'];
  const normalized: NonNullable<LogRecord['source']> = {
    ...(typeof file === 'string' ? { file } : {}),
    ...(typeof line === 'number' ? { line } : {}),
    ...(typeof fn === 'string' ? { function: fn } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isSafeRecord(value: SafeValue): value is { readonly [key: string]: SafeValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DEFAULT_LOG_RECORD_FACTORY = new LogRecordFactory();

export function createLogRecord(input: CreateLogRecordInput): LogRecord {
  return DEFAULT_LOG_RECORD_FACTORY.create(input);
}
