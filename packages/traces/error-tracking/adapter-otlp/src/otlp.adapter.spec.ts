import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createOtlpErrorAdapter } from './otlp.adapter.js';

describe('OtlpErrorAdapter (real HTTP collector)', () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (srv) =>
          new Promise<void>((resolve) => {
            srv.close(() => resolve());
          }),
      ),
    );
    servers.length = 0;
  });

  it('posts OTLP/HTTP JSON log record with exception semantics and auth headers', async () => {
    let receivedPath = '';
    let receivedAuth = '';
    let receivedBody: Record<string, unknown> = {};

    const server = createServer((req, res) => {
      receivedPath = req.url ?? '';
      receivedAuth = String(req.headers['authorization'] ?? '');
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
          string,
          unknown
        >;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (typeof addr !== 'object' || addr === null) throw new Error('no address');

    const adapter = createOtlpErrorAdapter({
      endpoint: `http://127.0.0.1:${addr.port}`,
      headers: { authorization: 'Bearer otlp-token' },
      recordOnActiveSpan: false,
    });

    await adapter.capture(
      normalizeError(new Error('otlp boom'), {
        severity: 'fatal',
        trace: { traceId: '0123456789abcdef0123456789abcdef', spanId: '0123456789abcdef' },
      }),
    );

    expect(receivedPath).toBe('/v1/logs');
    expect(receivedAuth).toBe('Bearer otlp-token');
    const resourceLogs = receivedBody['resourceLogs'] as Array<{
      scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }>;
    }>;
    const record = resourceLogs[0]?.scopeLogs[0]?.logRecords[0];
    expect(record?.['severityText']).toBe('FATAL');
    expect(record?.['traceId']).toBe('0123456789abcdef0123456789abcdef');
  });

  it('throws on non-2xx OTLP response', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(503);
      res.end('unavailable');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (typeof addr !== 'object' || addr === null) throw new Error('no address');

    const adapter = createOtlpErrorAdapter({
      endpoint: `http://127.0.0.1:${addr.port}`,
      recordOnActiveSpan: false,
    });

    await expect(adapter.capture(normalizeError(new Error('fail')))).rejects.toThrow(/HTTP 503/);
  });
});
