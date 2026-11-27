import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { TestCaptureRemoteTransport as TestTransport } from './test-capture.remote.transport.js';

function record(i: number): LogRecord {
  return { schemaVersion: 1, timestamp: i, level: 'info', message: `m${i}` };
}

describe('BufferedRemoteTransport queue policies', () => {
  it('reports drops for drop-oldest overflow', () => {
    const onError = vi.fn();
    const t = new TestTransport({
      endpoint: 'http://example.com',
      fetchImpl: async () => ({ ok: true, status: 200 }) as unknown as Response,
      queueCapacity: 1,
      flushIntervalMs: 60_000,
      overflow: 'drop-oldest',
      onError,
    });
    t.write(record(1));
    t.write(record(2));
    expect(t.health().dropped).toBe(1);
    expect(onError).toHaveBeenCalled();
  });

  it('fails explicitly on overflow when configured', () => {
    const t = new TestTransport({
      endpoint: 'http://example.com',
      fetchImpl: async () => ({ ok: true, status: 200 }) as unknown as Response,
      queueCapacity: 1,
      flushIntervalMs: 60_000,
      overflow: 'fail',
    });
    t.write(record(1));
    expect(() => t.write(record(2))).toThrow(/overflow/i);
    expect(t.health().dropped).toBe(1);
  });

  it('does not retry permanent 4xx and calls dead-letter', async () => {
    const dead = vi.fn();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    const t = new TestTransport({
      endpoint: 'http://example.com',
      fetchImpl,
      maxRetries: 3,
      baseDelayMs: 1,
      flushIntervalMs: 60_000,
      onDeadLetter: dead,
    });
    t.write(record(1));
    await t.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(t.health().failed).toBe(1);
    expect(dead).toHaveBeenCalledTimes(1);
  });

  it('honors the retry limit and dead-letters after retryable failures', async () => {
    const dead = vi.fn();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response);
    const t = new TestTransport({
      endpoint: 'http://example.com',
      fetchImpl,
      maxRetries: 2,
      baseDelayMs: 1,
      flushIntervalMs: 60_000,
      onDeadLetter: dead,
    });
    t.write(record(1));
    await t.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(dead).toHaveBeenCalledTimes(1);
    expect(t.health().failed).toBe(1);
  });

  it('isolates dead-letter failures from delivery', async () => {
    const onError = vi.fn();
    const t = new TestTransport({
      endpoint: 'http://example.com',
      fetchImpl: async () => ({ ok: false, status: 400 }) as unknown as Response,
      flushIntervalMs: 60_000,
      onDeadLetter: () => {
        throw new Error('dead-letter unavailable');
      },
      onError,
    });
    t.write(record(1));
    await expect(t.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalled();
    expect(t.health().failed).toBe(1);
  });

  it('drains queued records on graceful shutdown and closes idempotently', async () => {
    const t = new TestTransport({
      endpoint: 'http://example.com',
      fetchImpl: async () => ({ ok: true, status: 200 }) as unknown as Response,
      flushIntervalMs: 60_000,
      batchSize: 2,
    });
    t.write(record(1));
    t.write(record(2));
    t.write(record(3));
    const closing = t.close();
    expect(t.close()).toBe(closing);
    await closing;
    expect(t.health().sent).toBe(3);
    expect(t.health().queued).toBe(0);
    t.write(record(4));
    expect(t.health().queued).toBe(0);
  });

  it('marks the transport down after repeated failures', async () => {
    const t = new TestTransport({
      endpoint: 'http://example.com',
      fetchImpl: async () => ({ ok: false, status: 400 }) as unknown as Response,
      flushIntervalMs: 60_000,
    });
    for (let i = 0; i < 5; i += 1) {
      t.write(record(i));
      // oxlint-disable-next-line no-await-in-loop
      await t.flush();
    }
    expect(t.health().status).toBe('down');
  });

  it('remains bounded under high-volume overflow (stress smoke)', async () => {
    const onError = vi.fn();
    const t = new TestTransport({
      endpoint: 'http://example.com',
      fetchImpl: async () => ({ ok: true, status: 200 }) as unknown as Response,
      queueCapacity: 100,
      flushIntervalMs: 60_000,
      overflow: 'drop-oldest',
      onError,
    });
    for (let i = 0; i < 5000; i += 1) t.write(record(i));
    const health = t.health();
    expect(health.queued).toBeLessThanOrEqual(100);
    expect(health.dropped).toBeGreaterThan(0);
    expect(health.capacity).toBe(100);
  });
});
