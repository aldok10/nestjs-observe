import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { LogLevel, LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { ConsoleTransport } from './console.transport.js';

function createRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    schemaVersion: 1,
    timestamp: 1_700_000_000_000,
    level: 'info',
    message: 'hello',
    ...overrides,
  };
}

function createCollector(chunks: string[] = []): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
}

const CONSOLE_ROUTING_CASES: ReadonlyArray<{
  readonly level: LogLevel;
  readonly target: 'stdout' | 'stderr';
}> = [
  { level: 'trace', target: 'stdout' },
  { level: 'debug', target: 'stdout' },
  { level: 'verbose', target: 'stdout' },
  { level: 'info', target: 'stdout' },
  { level: 'log', target: 'stdout' },
  { level: 'warn', target: 'stderr' },
  { level: 'error', target: 'stderr' },
  { level: 'fatal', target: 'stderr' },
];

describe('ConsoleTransport', () => {
  it.each(CONSOLE_ROUTING_CASES)('routes "$level" to $target', async ({ level, target }) => {
    const out: string[] = [];
    const err: string[] = [];
    const transport = new ConsoleTransport({
      formatter: 'text',
      stdout: createCollector(out),
      stderr: createCollector(err),
    });

    await transport.write(createRecord({ level, message: `msg-${level}` }));
    if (target === 'stdout') {
      expect(out).toHaveLength(1);
      expect(out[0]).toContain(`msg-${level}`);
      expect(err).toHaveLength(0);
    } else {
      expect(err).toHaveLength(1);
      expect(err[0]).toContain(`msg-${level}`);
      expect(out).toHaveLength(0);
    }
  });

  it('reports stream errors without throwing', () => {
    const errors: unknown[] = [];
    const broken = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('write failed'));
      },
    });
    const transport = new ConsoleTransport({
      stdout: broken,
      onError: (error) => errors.push(error),
    });
    expect(() => transport.write(createRecord())).not.toThrow();
  });

  it('colors output when requested', async () => {
    const out: string[] = [];
    const transport = new ConsoleTransport({
      formatter: 'text',
      color: true,
      stdout: createCollector(out),
    });
    await transport.write(createRecord({ level: 'info' }));
    expect(out[0]).toContain('\x1b[32m');
  });

  it('close is idempotent and removes owned error listeners', async () => {
    const out = createCollector();
    const err = createCollector();
    const transport = new ConsoleTransport({ stdout: out, stderr: err });
    const outBefore = out.listenerCount('error');
    const errBefore = err.listenerCount('error');

    await transport.close();
    await transport.close();

    expect(out.listenerCount('error')).toBe(outBefore - 1);
    expect(err.listenerCount('error')).toBe(errBefore - 1);
    expect(() => transport.write(createRecord({ level: 'info' }))).not.toThrow();
  });
});
