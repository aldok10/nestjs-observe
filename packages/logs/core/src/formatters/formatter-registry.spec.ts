import { describe, expect, it } from 'vitest';
import type { LogFormatter, LogRecord } from '../contracts/index.js';
import { InvalidLoggerConfigurationException } from '../exceptions/index.js';
import { defaultFormatter } from './default.formatter.js';
import { registerFormatter, resolveFormatter } from './formatter.registry.js';

function createRecord(): LogRecord {
  return {
    schemaVersion: 1,
    timestamp: 1_700_000_000_000,
    level: 'info',
    message: 'hello',
    metadata: { userId: 'u-1' },
  };
}

describe('formatter registry', () => {
  it('uses the minimal core formatter when no formatter is configured', () => {
    const output = resolveFormatter(undefined).format(createRecord()) as string;
    expect(JSON.parse(output)['message']).toBe('hello');
  });

  it('accepts a custom LogFormatter without any format package', () => {
    const custom: LogFormatter = { format: (record) => `CUSTOM:${record.message}` };
    expect(resolveFormatter(custom).format(createRecord())).toBe('CUSTOM:hello');
  });

  it('rejects unknown formatter names with an explicit registration hint', () => {
    expect(() => resolveFormatter('not-installed' as never)).toThrow(
      InvalidLoggerConfigurationException,
    );
    expect(() => resolveFormatter('not-installed' as never)).toThrow(/registerFormatter/);
  });

  it('resolves a registered formatter with options', () => {
    registerFormatter('test-format', (options) => ({
      format: (record) => `${record.level}:${record.message}:${String(options.includeMetadata)}`,
    }));
    const formatter = resolveFormatter('test-format' as never, { includeMetadata: false });
    expect(formatter.format(createRecord())).toBe('info:hello:false');
  });

  it('default formatter keeps structured metadata', () => {
    const output = defaultFormatter.format(createRecord()) as string;
    expect(JSON.parse(output)['metadata']).toEqual({ userId: 'u-1' });
  });
});
