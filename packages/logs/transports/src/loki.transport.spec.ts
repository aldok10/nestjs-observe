import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { LokiTransport } from './loki.transport.js';

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function createRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    schemaVersion: 1,
    timestamp: 1_700_000_000_000,
    level: 'info',
    message: 'hello',
    ...overrides,
  };
}

function createFetchStub() {
  const requests: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { requests, fetchImpl };
}

function decodeBody(body: RequestInit['body'], gzip: boolean): unknown {
  if (gzip) {
    expect(Buffer.isBuffer(body)).toBe(true);
    return JSON.parse(gunzipSync(body as Buffer).toString('utf8'));
  }
  expect(typeof body).toBe('string');
  return JSON.parse(body as string);
}

describe('LokiTransport', () => {
  it('pushes gzipped payloads with tenant/auth headers and stable labels', async () => {
    const { requests, fetchImpl } = createFetchStub();
    const transport = new LokiTransport({
      endpoint: 'http://loki:3100/',
      tenantId: 'tenant-a',
      authorization: 'Bearer token',
      fetchImpl,
    });

    transport.write(
      createRecord({
        application: 'app',
        environment: 'test',
        service: 'svc',
        level: 'error',
        instanceId: 'i-1',
        requestId: 'req-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        correlationId: 'corr-1',
        metadata: { region: 'us-east-1' },
      }),
    );
    await transport.close();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://loki:3100/loki/api/v1/push');
    const headers = requests[0]?.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(headers['X-Scope-OrgID']).toBe('tenant-a');
    expect(headers['Authorization']).toBe('Bearer token');

    const payload = decodeBody(requests[0]?.init.body, true) as {
      streams: Array<{ stream: Record<string, string>; values: unknown[][] }>;
    };
    expect(payload.streams).toHaveLength(1);
    const [stream] = payload.streams;
    expect(stream?.stream).toEqual({
      application: 'app',
      environment: 'test',
      service: 'svc',
      level: 'error',
      region: 'us-east-1',
      instance: 'i-1',
    });
    expect(stream?.values).toHaveLength(1);
    const [ts, line, metadata] = stream?.values[0] ?? [];
    expect(ts).toBe('1700000000000000000');
    expect(JSON.parse(String(line))).toMatchObject({ message: 'hello', requestId: 'req-1' });
    expect(metadata).toEqual({
      requestId: 'req-1',
      traceId: 'trace-1',
      spanId: 'span-1',
      correlationId: 'corr-1',
    });
  });

  it('applies extra label allowlist and excludes high-cardinality IDs from labels', async () => {
    const { requests, fetchImpl } = createFetchStub();
    const transport = new LokiTransport({
      endpoint: 'http://loki:3100',
      gzip: false,
      fetchImpl,
      extraLabels: {
        team: 'core',
        requestId: 'should-not-be-label',
        ignored: 'nope',
      },
      extraLabelAllowlist: ['team', 'requestId', 'ignored'],
    });

    transport.write(
      createRecord({
        application: 'app',
        environment: 'prod',
        service: 'api',
        hostname: 'host-1',
        metadata: { region: 'eu-west-1' },
      }),
    );
    await transport.close();

    const payload = decodeBody(requests[0]?.init.body, false) as {
      streams: Array<{ stream: Record<string, string>; values: unknown[][] }>;
    };
    expect(payload.streams[0]?.stream).toMatchObject({
      application: 'app',
      environment: 'prod',
      service: 'api',
      region: 'eu-west-1',
      instance: 'host-1',
      team: 'core',
    });
    expect(payload.streams[0]?.stream).not.toHaveProperty('requestId');
    expect(payload.streams[0]?.stream).toHaveProperty('ignored', 'nope');
  });

  it('supports extra label key arrays and blocks keys not in allowlist', async () => {
    const { requests, fetchImpl } = createFetchStub();
    const transport = new LokiTransport({
      endpoint: 'http://loki:3100',
      gzip: false,
      fetchImpl,
      extraLabels: ['team', 'tenant', 'traceId'],
      extraLabelAllowlist: ['team'],
    });

    transport.write(
      createRecord({
        application: 'app',
        level: 'info',
        metadata: { team: 'platform', tenant: 't1' },
        traceId: 'trace-x',
      }),
    );
    await transport.close();

    const payload = decodeBody(requests[0]?.init.body, false) as {
      streams: Array<{ stream: Record<string, string> }>;
    };
    const labels = payload.streams[0]?.stream ?? {};
    expect(labels['team']).toBe('platform');
    expect(labels).not.toHaveProperty('tenant');
    expect(labels).not.toHaveProperty('traceId');
  });
});
