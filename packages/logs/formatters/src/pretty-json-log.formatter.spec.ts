import { describe, expect, it } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { resolveFormatter } from '@aldok10/nestjs-observe-logger-core/formatters';
import { createPrettyJsonFormatter, prettyJsonFormatter } from './index.js';

function createRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    schemaVersion: 1,
    timestamp: 1_700_000_000_000,
    level: 'info',
    message: 'hello',
    metadata: { nested: { value: 1 } },
    ...overrides,
  };
}

describe('PrettyJsonLogFormatter', () => {
  it('emits indented JSON preserving structured metadata', () => {
    const output = prettyJsonFormatter.format(createRecord()) as string;
    expect(output).toContain('\n  "message": "hello"');
    expect(JSON.parse(output)['metadata']).toEqual({ nested: { value: 1 } });
  });

  it('supports metadata exclusion', () => {
    const output = createPrettyJsonFormatter({ includeMetadata: false }).format(
      createRecord(),
    ) as string;
    expect(JSON.parse(output)['metadata']).toBeUndefined();
  });

  it('registers the prettyJson name', () => {
    expect(resolveFormatter('prettyJson').format(createRecord())).toContain('\n  "level"');
  });
});
