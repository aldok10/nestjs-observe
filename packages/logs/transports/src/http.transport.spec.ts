import { describe, expect, it } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core';
import { BufferedRemoteTransport } from '@aldok10/nestjs-observe-logger-delivery';
import { HttpTransport } from './index.js';

function createRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    schemaVersion: 1,
    timestamp: 1_700_000_000_000,
    level: 'info',
    message: 'hello',
    application: 'app',
    service: 'svc',
    environment: 'production',
    instanceId: 'i-1',
    ...overrides,
  };
}

interface StubResponse {
  readonly status?: number;
  readonly fail?: string;
}

function createStubFetch(sequence: readonly StubResponse[] = []) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let cursor = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    const next = sequence[Math.min(cursor++, Math.max(sequence.length - 1, 0))];
    if (next?.fail) throw new Error(next.fail);
    const status = next?.status ?? 200;
    return { ok: status < 400, status } as unknown as Response;
  };
  return { fetchImpl, calls };
}

function bodyOf(init: RequestInit | undefined): string {
  const body = init?.body;
  return typeof body === 'string' ? body : Buffer.from(body as ArrayBuffer).toString('utf8');
}

function headerOf(init: RequestInit | undefined, key: string): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.[key];
}

describe('HttpTransport', () => {
  it('extends BufferedRemoteTransport and posts a JSON array of parsed record fields', async () => {
    const { fetchImpl, calls } = createStubFetch();
    const transport = new HttpTransport({
      endpoint: 'https://logs.example.com/ingest',
      fetchImpl,
    });

    expect(transport).toBeInstanceOf(BufferedRemoteTransport);
    expect(transport.name).toBe('http');

    transport.write(createRecord({ requestId: 'req-1', message: 'hello' }));
    await transport.flush();
    await transport.close();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://logs.example.com/ingest');
    expect(calls[0]!.init.method).toBe('POST');
    expect(headerOf(calls[0]!.init, 'Content-Type')).toBe('application/json');

    const payload = JSON.parse(bodyOf(calls[0]!.init)) as Array<Record<string, unknown>>;
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(1);
    expect(payload[0]!['message']).toBe('hello');
    expect(payload[0]!['requestId']).toBe('req-1');
    expect(payload[0]!['service']).toBe('svc');
    expect(transport.health().sent).toBe(1);
  });

  it('supports custom HTTP method via fetch wrapper', async () => {
    const { fetchImpl, calls } = createStubFetch();
    const transport = new HttpTransport({
      endpoint: 'https://logs.example.com/ingest',
      method: 'PUT',
      fetchImpl,
    });

    transport.write(createRecord());
    await transport.flush();

    expect(calls[0]!.init.method).toBe('PUT');
  });

  it('supports auth header and extra headers', async () => {
    const { fetchImpl, calls } = createStubFetch();
    const transport = new HttpTransport({
      endpoint: 'https://logs.example.com/ingest',
      authorization: 'Bearer token-123',
      headers: { 'X-Tenant-Id': 'tenant-a' },
      fetchImpl,
    });

    transport.write(createRecord());
    await transport.flush();

    expect(headerOf(calls[0]!.init, 'Authorization')).toBe('Bearer token-123');
    expect(headerOf(calls[0]!.init, 'X-Tenant-Id')).toBe('tenant-a');
    expect(headerOf(calls[0]!.init, 'Content-Type')).toBe('application/json');
  });

  it('uses parseRecordFields for custom formatter output', async () => {
    const { fetchImpl, calls } = createStubFetch();
    const transport = new HttpTransport({
      endpoint: 'https://logs.example.com/ingest',
      formatter: {
        format: (record) => `plain:${record.message}`,
      },
      fetchImpl,
    });

    transport.write(createRecord({ message: 'not-json' }));
    await transport.flush();

    const payload = JSON.parse(bodyOf(calls[0]!.init)) as Array<Record<string, unknown>>;
    expect(payload[0]!['message']).toBe('plain:not-json');
  });

  it('passes batching and retry options to BufferedRemoteTransport', async () => {
    const { fetchImpl, calls } = createStubFetch([{ status: 500 }, { status: 200 }]);
    const errors: unknown[] = [];
    const transport = new HttpTransport({
      endpoint: 'https://logs.example.com/ingest',
      fetchImpl,
      batchSize: 1,
      maxRetries: 1,
      baseDelayMs: 1,
      flushIntervalMs: 60_000,
      onError: (error) => errors.push(error),
    });

    transport.write(createRecord({ message: 'first' }));
    transport.write(createRecord({ message: 'second' }));
    await transport.flush();
    await transport.close();

    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(errors).toHaveLength(1);
    expect(transport.health().sent).toBe(2);
    expect(transport.health().failed).toBe(0);
  });
});
