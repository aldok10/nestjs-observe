import type { FormatterOptions, LogRecord } from '../contracts/index.js';
import { RedactionEngine, type SafeValue } from '../redaction/redaction-engine.js';

const FIELD_ORDER = [
  'schemaVersion',
  'timestamp',
  'level',
  'message',
  'channel',
  'service',
  'application',
  'environment',
  'instanceId',
  'hostname',
  'processId',
  'context',
  'module',
  'requestId',
  'correlationId',
  'traceId',
  'spanId',
  'method',
  'route',
  'statusCode',
  'duration',
  'source',
  'error',
  'metadata',
] as const;

export class LogRecordNormalizer {
  private readonly redactionEngine = new RedactionEngine();

  normalize(record: LogRecord, options: FormatterOptions = {}): Record<string, SafeValue> {
    const source = this.toSafeSource(record);
    const result: Record<string, SafeValue> = {};

    for (const field of FIELD_ORDER) {
      const value = source[field];
      if (value !== undefined) result[field] = value;
    }

    if (options.timestamp === 'iso' && Number.isFinite(record.timestamp)) {
      result['timestamp'] = new Date(record.timestamp).toISOString();
    }
    if (options.includeMetadata === false) {
      delete result['metadata'];
    }

    return result;
  }

  readStringField(fields: Readonly<Record<string, unknown>>, key: string): string | undefined {
    const value = fields[key];
    return typeof value === 'string' ? value : undefined;
  }

  private toSafeSource(record: LogRecord): { readonly [key: string]: SafeValue } {
    if (RedactionEngine.isSanitized(record) && isSafeObject(record)) {
      return record;
    }
    const sanitized = this.redactionEngine.sanitize(record);
    return isSafeObject(sanitized) ? sanitized : {};
  }
}

function isSafeObject(value: unknown): value is { readonly [key: string]: SafeValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DEFAULT_NORMALIZER = new LogRecordNormalizer();

export function normalizedFields(
  record: LogRecord,
  options: FormatterOptions = {},
): Record<string, SafeValue> {
  return DEFAULT_NORMALIZER.normalize(record, options);
}

export function stringField(
  fields: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  return DEFAULT_NORMALIZER.readStringField(fields, key);
}
