import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { TestCaptureRemoteTransport as TestTransport } from './test-capture.remote.transport.js';

function record(i: number): LogRecord {
  return { schemaVersion: 1, timestamp: i, level: 'info', message: `m${i}` };
}

describe('BufferedRemoteTransport shutdown', () => {
  it('clears its flush timer on close', async () => {
    vi.useFakeTimers();
    try {
      const transport = new TestTransport({
        endpoint: 'http://example.com',
        fetchImpl: async () => ({ ok: true, status: 200 }) as unknown as Response,
        flushIntervalMs: 60_000,
      });
      expect(vi.getTimerCount()).toBe(1);
      await transport.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not issue a fresh fetch after close', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      if (fetchImpl.mock.calls.length === 1) await gate;
      return { ok: false, status: 503 } as unknown as Response;
    });
    const transport = new TestTransport({
      endpoint: 'http://example.com',
      fetchImpl,
      maxRetries: 3,
      baseDelayMs: 20,
      flushIntervalMs: 60_000,
    });
    transport.write(record(1));
    const draining = transport.flush();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await transport.close();
    release();
    await draining;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(transport.health().dropped).toBe(1);
  });

  it('drops a deferred block enqueue after close', async () => {
    vi.useFakeTimers();
    try {
      const transport = new TestTransport({
        endpoint: 'http://example.com',
        fetchImpl: async () => ({ ok: true, status: 200 }) as unknown as Response,
        queueCapacity: 1,
        overflow: 'block',
        flushIntervalMs: 60_000,
      });
      transport.write(record(1));
      transport.write(record(2));
      const closing = transport.close();
      await vi.advanceTimersByTimeAsync(100);
      await closing;
      expect(transport.health().dropped).toBe(1);
      expect(transport.health().queued).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
