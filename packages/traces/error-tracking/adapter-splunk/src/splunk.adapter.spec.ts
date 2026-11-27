import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createSplunkAdapter } from './splunk.adapter.js';

describe('SplunkErrorAdapter (real HTTP)', () => {
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

  it('posts OTLP error log to /v1/logs with X-SF-Token header', async () => {
    let path = '';
    let token = '';

    const server = createServer((req, res) => {
      path = req.url ?? '';
      token = String(req.headers['x-sf-token'] ?? '');
      req.resume();
      req.on('end', () => {
        res.writeHead(200);
        res.end('{}');
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (typeof addr !== 'object' || addr === null) throw new Error('no address');

    const adapter = createSplunkAdapter({
      endpoint: `http://127.0.0.1:${addr.port}`,
      accessToken: 'sf-token-123',
      recordOnActiveSpan: false,
    });

    await adapter.capture(normalizeError(new Error('splunk boom')));
    expect(path).toBe('/v1/logs');
    expect(token).toBe('sf-token-123');
  });
});
