import { describe, expect, it } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { resolveFormatter } from '@aldok10/nestjs-observe-logger-core/formatters';
import { createJsonFormatter, jsonFormatter } from './index.js';

function createRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    schemaVersion: 1,
    timestamp: 1_700_000_000_000,
    level: 'info',
    message: 'hello',
    metadata: { userId: 'u-1' },
    ...overrides,
  };
}

describe('JsonLogFormatter', () => {
  it('emits structured JSON with metadata', () => {
    const parsed = JSON.parse(jsonFormatter.format(createRecord()) as string);
    expect(parsed['message']).toBe('hello');
    expect(parsed['metadata']).toEqual({ userId: 'u-1' });
  });

  it('preserves serialized error information', () => {
    const parsed = JSON.parse(
      createJsonFormatter().format(
        createRecord({ error: { name: 'Error', message: 'boom', stack: 'stack line' } }),
      ) as string,
    );
    expect(parsed['error']['message']).toBe('boom');
    expect(parsed['error']['stack']).toBe('stack line');
  });

  it('supports ISO timestamps and metadata exclusion', () => {
    const parsed = JSON.parse(
      createJsonFormatter({ timestamp: 'iso', includeMetadata: false }).format(
        createRecord(),
      ) as string,
    );
    expect(parsed['timestamp']).toBe('2023-11-14T22:13:20.000Z');
    expect(parsed['metadata']).toBeUndefined();
  });

  it('registers the json name for resolver-based pipelines', () => {
    expect(resolveFormatter('json')).toBeInstanceOf(Object);
    expect(resolveFormatter('json').format(createRecord())).toContain('"message":"hello"');
  });
});
