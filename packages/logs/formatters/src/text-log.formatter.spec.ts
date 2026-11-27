import { describe, expect, it } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { resolveFormatter } from '@aldok10/nestjs-observe-logger-core/formatters';
import { createTextFormatter, textFormatter } from './index.js';

function createRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    schemaVersion: 1,
    timestamp: 1_700_000_000_000,
    level: 'info',
    message: 'hello',
    ...overrides,
  };
}

describe('TextLogFormatter', () => {
  it('emits level and message in a single line', () => {
    const output = textFormatter.format(createRecord()) as string;
    expect(output).toContain(' INFO ');
    expect(output).toContain('hello');
    expect(output).not.toContain('\n');
  });

  it('escapes log injection characters', () => {
    const output = textFormatter.format(
      createRecord({ message: 'first\nsecond\rthird' }),
    ) as string;
    expect(output).toContain('first\\nsecond\\rthird');
    expect(output).not.toContain('\nsecond');
  });

  it('escapes ANSI and other control characters in every text field', () => {
    const output = textFormatter.format(
      createRecord({
        context: 'ctx\u001b[31mRED\u0007',
        message: 'a\u0000b\u000bc\u007fd',
        requestId: 'req\u2028x',
        metadata: { note: 'line\u001b[2Jend' },
      }),
    ) as string;
    // oxlint-disable-next-line no-control-regex
    expect(output).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
    expect(output).not.toContain('\u001b[');
    expect(output).toContain('\\u001b[31m');
    expect(output).toContain('\\u0000');
    expect(output).toContain('\\u2028');
  });

  it('escapes forged newlines in the level field', () => {
    const output = textFormatter.format(
      createRecord({ level: 'info\nERROR fake' as LogRecord['level'] }),
    ) as string;
    expect(output).not.toContain('\n');
    expect(output).toContain('INFO\\nERROR FAKE');
  });

  it('preserves request/trace ids and structured metadata', () => {
    const output = textFormatter.format(
      createRecord({
        requestId: 'req-1',
        traceId: 'trace-1',
        metadata: { userId: 'u-1' },
      }),
    ) as string;
    expect(output).toContain('requestId=req-1');
    expect(output).toContain('traceId=trace-1');
    expect(output).toContain('metadata={"userId":"u-1"}');
  });

  it('supports metadata exclusion and registers the text name', () => {
    const output = createTextFormatter({ includeMetadata: false }).format(
      createRecord({ metadata: { userId: 'u-1' } }),
    ) as string;
    expect(output).not.toContain('metadata=');
    expect(resolveFormatter('text').format(createRecord())).toContain(' INFO ');
  });
});
