import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { LogRecord, LogTransport } from '@aldok10/nestjs-observe-logger-core/contracts';
import { HttpTransport } from '@aldok10/nestjs-observe-logger-transports/http';
import { LokiTransport } from '@aldok10/nestjs-observe-logger-transports/loki';
import { OpenObserveTransport } from '@aldok10/nestjs-observe-logger-transports/openobserve';
import { ElasticsearchTransport } from '@aldok10/nestjs-observe-logger-transports/elasticsearch';

const record: LogRecord = {
  schemaVersion: 1,
  timestamp: 1_700_000_000_000,
  level: 'info',
  message: 'hello',
  requestId: 'req-1',
  application: 'app',
  service: 'svc',
  environment: 'staging',
};

interface WireHit {
  readonly url: string;
  readonly init: RequestInit;
}

function stubFetch(hits: WireHit[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    hits.push({ url, init: init ?? {} });
    return { ok: true, status: 200 } as unknown as Response;
  }) as typeof fetch;
}

function bytesOf(init: RequestInit): Buffer {
  const body = init.body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (Buffer.isBuffer(body)) return body;
  return Buffer.from(body as ArrayBuffer);
}

function bodyOf(init: RequestInit): string {
  return bytesOf(init).toString('utf8');
}

function headerOf(init: RequestInit, key: string): string | undefined {
  const headers = init.headers as Record<string, string> | undefined;
  if (headers === undefined) return undefined;
  const wanted = key.toLowerCase();
  return Object.entries(headers).find(([name]) => name.toLowerCase() === wanted)?.[1];
}

describe('remote wire shape (one shared suite)', () => {
  const cases = [
    {
      name: 'http JSON array',
      create: (fetchImpl: typeof fetch): LogTransport =>
        new HttpTransport({
          endpoint: 'http://example.com/ingest',
          fetchImpl,
          flushIntervalMs: 60_000,
        }),
      check: (hit: WireHit): void => {
        expect(new URL(hit.url).pathname).toBe('/ingest');
        expect(headerOf(hit.init, 'content-type')).toBe('application/json');
        expect(JSON.parse(bodyOf(hit.init))).toEqual([
          expect.objectContaining({ message: 'hello', requestId: 'req-1' }),
        ]);
      },
    },
    {
      name: 'loki gzip streams',
      create: (fetchImpl: typeof fetch): LogTransport =>
        new LokiTransport({
          endpoint: 'http://example.com',
          gzip: true,
          fetchImpl,
          flushIntervalMs: 60_000,
        }),
      check: (hit: WireHit): void => {
        expect(new URL(hit.url).pathname).toBe('/loki/api/v1/push');
        expect(headerOf(hit.init, 'content-encoding')).toBe('gzip');
        const parsed = JSON.parse(gunzipSync(bytesOf(hit.init)).toString('utf8')) as {
          streams: Array<{ stream: object; values: unknown[] }>;
        };
        expect(parsed.streams).toHaveLength(1);
        expect(parsed.streams[0]?.stream).toMatchObject({ level: 'info', service: 'svc' });
        expect(parsed.streams[0]?.values).toHaveLength(1);
      },
    },
    {
      name: 'openobserve path and basic auth',
      create: (fetchImpl: typeof fetch): LogTransport =>
        new OpenObserveTransport({
          endpoint: 'http://example.com',
          organization: 'org',
          stream: 'logs',
          username: 'u',
          password: 'p',
          fetchImpl,
          flushIntervalMs: 60_000,
        }),
      check: (hit: WireHit): void => {
        expect(new URL(hit.url).pathname).toBe('/api/org/logs/_json');
        expect(headerOf(hit.init, 'authorization')).toBe(
          `Basic ${Buffer.from('u:p').toString('base64')}`,
        );
        expect(JSON.parse(bodyOf(hit.init))).toEqual([
          expect.objectContaining({ message: 'hello' }),
        ]);
      },
    },
    {
      name: 'elasticsearch bulk NDJSON',
      create: (fetchImpl: typeof fetch): LogTransport =>
        new ElasticsearchTransport({
          endpoint: 'http://example.com',
          index: 'logs-{level}',
          apiKey: 'key',
          fetchImpl,
          flushIntervalMs: 60_000,
        }),
      check: (hit: WireHit): void => {
        expect(new URL(hit.url).pathname).toBe('/_bulk');
        expect(headerOf(hit.init, 'content-type')).toBe('application/x-ndjson');
        expect(headerOf(hit.init, 'authorization')).toBe('ApiKey key');
        const lines = bodyOf(hit.init)
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toEqual({ index: { _index: 'logs-info' } });
        expect(lines[1]).toMatchObject({ message: 'hello' });
      },
    },
  ];

  it.each(cases)('$name emits the expected bytes and headers', async ({ create, check }) => {
    const hits: WireHit[] = [];
    const transport = create(stubFetch(hits));
    if (!transport.flush) throw new Error('transport lacks flush');
    if (!transport.close) throw new Error('transport lacks close');
    void transport.write(record);
    await transport.flush();
    await transport.close();
    expect(hits).toHaveLength(1);
    check(hits[0]!);
  });

  it('HttpTransport sends the actual request over a local node:http server', async () => {
    const seen: Array<{
      method: string | undefined;
      url: string | undefined;
      headers: IncomingHttpHeaders;
      body: string;
    }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        seen.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      });
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    try {
      const transport = new HttpTransport({
        endpoint: `http://127.0.0.1:${port}/ingest`,
        authorization: 'Bearer t',
        headers: { 'X-Tenant-Id': 'tenant-a' },
        flushIntervalMs: 60_000,
      });
      transport.write(record);
      await transport.flush();
      await transport.close();

      expect(seen).toHaveLength(1);
      const hit = seen[0]!;
      expect(hit.method).toBe('POST');
      expect(hit.url).toBe('/ingest');
      expect(hit.headers['content-type']).toBe('application/json');
      expect(hit.headers['authorization']).toBe('Bearer t');
      expect(hit.headers['x-tenant-id']).toBe('tenant-a');
      expect(JSON.parse(hit.body)).toEqual([
        expect.objectContaining({ message: 'hello', requestId: 'req-1' }),
      ]);
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  });
});
