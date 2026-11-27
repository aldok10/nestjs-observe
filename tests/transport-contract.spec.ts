import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import {
  BufferedRemoteTransport,
  type RemotePayload,
} from '@aldok10/nestjs-observe-logger-delivery';
import { ConsoleTransport } from '@aldok10/nestjs-observe-logger-transports/console';
import { StreamTransport } from '@aldok10/nestjs-observe-logger-transports/file';
import { HttpTransport } from '@aldok10/nestjs-observe-logger-transports/http';
import { createCaptureTransport } from './helpers/capture-transport.js';
import { runTransportContract } from './helpers/transport-contract.js';

const record: LogRecord = {
  schemaVersion: 1,
  timestamp: 1_700_000_000_000,
  level: 'info',
  message: 'contract',
  requestId: 'req-1',
};

function collector(chunks: string[] = []): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
}

class StubRemoteTransport extends BufferedRemoteTransport {
  protected buildPayload(batch: readonly string[]): RemotePayload {
    return { body: JSON.stringify(batch) };
  }
}

const stubFetch: typeof fetch = (async () =>
  ({ ok: true, status: 200 }) as unknown as Response) as typeof fetch;

runTransportContract({
  name: 'capture helper',
  transport: createCaptureTransport('contract-capture'),
  record,
});

runTransportContract({
  name: 'console (injected streams)',
  transport: new ConsoleTransport({
    formatter: 'text',
    stdout: collector(),
    stderr: collector(),
  }),
  record,
});

runTransportContract({
  name: 'file (injected stream)',
  transport: new StreamTransport({ stream: new PassThrough(), formatter: 'json' }),
  record,
});

runTransportContract({
  name: 'delivery buffered (stub fetch)',
  transport: new StubRemoteTransport({
    endpoint: 'http://example.com',
    fetchImpl: stubFetch,
    flushIntervalMs: 60_000,
  }),
  record,
});

runTransportContract({
  name: 'http remote (stub fetch)',
  transport: new HttpTransport({
    endpoint: 'http://example.com/ingest',
    fetchImpl: stubFetch,
    flushIntervalMs: 60_000,
  }),
  record,
});

describe('capture helper reuse', () => {
  it('captures records and reports healthy delivery', async () => {
    const transport = createCaptureTransport('reuse');
    transport.write(record);
    await transport.flush();
    expect(transport.records).toEqual([record]);
    expect(transport.health()).toMatchObject({ name: 'reuse', healthy: true, sent: 1 });
    await transport.close();
  });
});
