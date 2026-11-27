import { describe, expect, it } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core';
import { ElasticsearchTransport } from './elasticsearch.transport.js';

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

describe('ElasticsearchTransport', () => {
  it('posts trailing-newline NDJSON bulk with ApiKey auth', async () => {
    const { fetchImpl, calls } = createStubFetch();
    const transport = new ElasticsearchTransport({
      endpoint: 'http://example.com',
      index: 'logs-{level}-{environment}',
      apiKey: 'key-1',
      fetchImpl,
    });
    transport.write(createRecord());
    await transport.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://example.com/_bulk');
    expect(headerOf(calls[0]!.init, 'Authorization')).toBe('ApiKey key-1');
    expect(headerOf(calls[0]!.init, 'Content-Type')).toBe('application/x-ndjson');
    const body = bodyOf(calls[0]!.init);
    expect(body.endsWith('\n')).toBe(true);
    const lines = body.trimEnd().split('\n');
    expect(JSON.parse(lines[0]!)).toEqual({ index: { _index: 'logs-info-production' } });
    expect(JSON.parse(lines[1]!)['message']).toBe('hello');
  });

  it('uses authorization header when apiKey is not provided', async () => {
    const { fetchImpl, calls } = createStubFetch();
    const transport = new ElasticsearchTransport({
      endpoint: 'http://example.com',
      authorization: 'Bearer token-1',
      fetchImpl,
    });
    transport.write(createRecord());
    await transport.flush();

    expect(headerOf(calls[0]!.init, 'Authorization')).toBe('Bearer token-1');
  });

  it('prefers ApiKey over authorization when both are provided', async () => {
    const { fetchImpl, calls } = createStubFetch();
    const transport = new ElasticsearchTransport({
      endpoint: 'http://example.com',
      apiKey: 'key-1',
      authorization: 'Bearer token-1',
      fetchImpl,
    });
    transport.write(createRecord());
    await transport.flush();

    expect(headerOf(calls[0]!.init, 'Authorization')).toBe('ApiKey key-1');
  });

  it('resolves index template with normalized level and environment', async () => {
    const { fetchImpl, calls } = createStubFetch();
    const transport = new ElasticsearchTransport({
      endpoint: 'http://example.com/',
      index: 'logs-{level}-{environment}',
      fetchImpl,
    });
    transport.write(createRecord({ level: 'error', environment: 'Pre-Prod' }));
    await transport.flush();

    const body = bodyOf(calls[0]!.init);
    const lines = body.trimEnd().split('\n');
    expect(JSON.parse(lines[0]!)).toEqual({ index: { _index: 'logs-error-pre-prod' } });
  });

  it('uses default endpoint and index template', async () => {
    const { fetchImpl, calls } = createStubFetch();
    const transport = new ElasticsearchTransport({ fetchImpl });
    transport.write(createRecord({ level: 'warn', environment: 'Staging' }));
    await transport.flush();

    expect(calls[0]!.url).toBe('http://localhost:9200/_bulk');
    const body = bodyOf(calls[0]!.init);
    const lines = body.trimEnd().split('\n');
    expect(JSON.parse(lines[0]!)).toEqual({ index: { _index: 'logs-warn-staging' } });
  });
});
