import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { LogPipeline } from '@aldok10/nestjs-observe-logger-core';
import { TestCaptureRemoteTransport as CaptureRemoteTransport } from './test-capture.remote.transport.js';

describe('delivery redaction order', () => {
  it('redacts before queuing and before any external fetch', async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body;
      bodies.push(typeof body === 'string' ? body : '');
      return { ok: true, status: 200 } as unknown as Response;
    }) as unknown as typeof fetch;
    const remote = new CaptureRemoteTransport({
      endpoint: 'http://example.com',
      fetchImpl,
      flushIntervalMs: 60_000,
    });
    const pipeline = new LogPipeline({ transports: [remote] });
    const record: LogRecord = {
      schemaVersion: 1,
      timestamp: 1_700_000_000_000,
      level: 'info',
      message: 'login password=hunter2',
      metadata: { password: 'hunter2', authorization: 'Bearer hunter2' },
    };

    await pipeline.emit(record);
    expect(remote.health().queued).toBe(1);
    expect(bodies).toHaveLength(0);

    await pipeline.flush();
    const sent = bodies.join('\n');
    expect(sent).not.toContain('hunter2');
    expect(sent).toContain('[REDACTED]');
    await remote.close();
  });
});
