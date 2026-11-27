import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createDynatraceAdapter } from './dynatrace.adapter.js';

describe('DynatraceErrorAdapter (real HTTP)', () => {
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

  it('posts OTLP error log to /api/v2/otlp/v1/logs with Bearer platform token', async () => {
    let path = '';
    let auth = '';

    const server = createServer((req, res) => {
      path = req.url ?? '';
      auth = String(req.headers['authorization'] ?? '');
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

    const adapter = createDynatraceAdapter({
      endpoint: `http://127.0.0.1:${addr.port}`,
      platformToken: 'dt0c1x.token',
      recordOnActiveSpan: false,
    });

    await adapter.capture(normalizeError(new Error('dt boom')));
    expect(path).toBe('/api/v2/otlp/v1/logs');
    expect(auth).toBe('Bearer dt0c1x.token');
  });
});
