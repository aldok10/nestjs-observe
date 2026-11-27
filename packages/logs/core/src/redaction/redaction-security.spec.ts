import { describe, expect, it } from 'vitest';
import { LogPipeline } from '../pipeline/log-pipeline.js';
import type { LogRecord, RedactionMatcher } from '../contracts/index.js';
import { InMemoryCaptureTransport } from '../test-capture.transport.js';

describe('redaction security', () => {
  it('redacts sensitive metadata before transport write', async () => {
    const capture = new InMemoryCaptureTransport();
    const pipeline = new LogPipeline({ transports: [capture] });
    const record: LogRecord = {
      schemaVersion: 1,
      timestamp: Date.now(),
      level: 'info',
      message: 'login',
      metadata: {
        password: 'secret',
        headers: { authorization: 'Bearer token', cookie: 'a=b' },
        query: { apiKey: 'key123' },
      },
    };

    await pipeline.emit(record);
    const metadata = capture.records[0]?.metadata;
    expect(metadata?.['password']).toBe('[REDACTED]');
    const headers = metadata?.['headers'] as Record<string, unknown> | undefined;
    const query = metadata?.['query'] as Record<string, unknown> | undefined;
    expect(headers?.['authorization']).toBe('[REDACTED]');
    expect(headers?.['cookie']).toBe('[REDACTED]');
    expect(query?.['apiKey']).toBe('[REDACTED]');
  });

  it('keeps default secret patterns active when callers add custom patterns', async () => {
    const capture = new InMemoryCaptureTransport();
    const pipeline = new LogPipeline({
      transports: [capture],
      redaction: { patterns: [] },
    });
    await pipeline.emit({
      schemaVersion: 1,
      timestamp: Date.now(),
      level: 'info',
      message: 'login',
      metadata: { password: 'default-secret', authorization: 'Bearer default-token' },
    });
    expect(JSON.stringify(capture.records[0])).not.toContain('default-secret');
    expect(JSON.stringify(capture.records[0])).not.toContain('default-token');
  });

  it('fails closed when a custom matcher throws', async () => {
    const capture = new InMemoryCaptureTransport();
    const pipeline = new LogPipeline({
      transports: [capture],
      redaction: {
        matchers: [
          () => {
            throw new Error('matcher unavailable');
          },
        ],
      },
    });
    await pipeline.emit({
      schemaVersion: 1,
      timestamp: Date.now(),
      level: 'info',
      message: 'login',
      metadata: { password: 'secret' },
    });
    expect(capture.records).toHaveLength(1);
    expect(JSON.stringify(capture.records[0])).not.toContain('secret');
    expect(capture.records[0]?.message).toBe('[REDACTED]');
  });

  it('fails closed when a custom RegExp pattern throws', async () => {
    const capture = new InMemoryCaptureTransport();
    const broken = {
      test() {
        throw new Error('pattern unavailable');
      },
    } as unknown as RegExp;
    const pipeline = new LogPipeline({
      transports: [capture],
      redaction: { patterns: [broken] },
    });
    await pipeline.emit({
      schemaVersion: 1,
      timestamp: Date.now(),
      level: 'info',
      message: 'login',
      metadata: { password: 'pattern-secret' },
    });
    expect(JSON.stringify(capture.records[0])).not.toContain('pattern-secret');
    expect(capture.records[0]?.message).toBe('[REDACTED]');
  });

  it('fails closed when the matcher collection itself throws', async () => {
    const capture = new InMemoryCaptureTransport();
    const matchers = {
      [Symbol.iterator]() {
        throw new Error('matcher list unavailable');
      },
    } as unknown as readonly RedactionMatcher[];
    const pipeline = new LogPipeline({ transports: [capture], redaction: { matchers } });
    await pipeline.emit({
      schemaVersion: 1,
      timestamp: Date.now(),
      level: 'info',
      message: 'login',
      metadata: { password: 'secret' },
    });
    expect(capture.records).toHaveLength(1);
    expect(JSON.stringify(capture.records[0])).not.toContain('secret');
  });

  it('handles large metadata without throwing (perf-oriented guard)', async () => {
    const capture = new InMemoryCaptureTransport();
    const pipeline = new LogPipeline({ transports: [capture] });
    const metadata: Record<string, unknown> = {};
    for (let i = 0; i < 2000; i += 1) metadata[`k${i}`] = i % 10 === 0 ? { password: 'x' } : i;
    const record: LogRecord = {
      schemaVersion: 1,
      timestamp: Date.now(),
      level: 'info',
      message: 'bulk',
      metadata,
    };

    const start = Date.now();
    await pipeline.emit(record);
    const elapsed = Date.now() - start;
    expect(capture.records).toHaveLength(1);
    expect(elapsed).toBeLessThan(2000);
  });
});
