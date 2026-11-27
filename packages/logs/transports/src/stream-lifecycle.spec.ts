import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { StreamTransport } from './stream.transport.js';

const record: LogRecord = {
  schemaVersion: 1,
  timestamp: 1_700_000_000_000,
  level: 'info',
  message: 'lifecycle',
};

describe('StreamTransport lifecycle', () => {
  it('removes its error listener from an injected stream and closes idempotently', async () => {
    const stream = new PassThrough();
    const transport = new StreamTransport({ stream });
    expect(stream.listenerCount('error')).toBe(1);

    await transport.write(record);
    const closing = transport.close();
    expect(transport.close()).toBe(closing);
    await closing;

    expect(stream.listenerCount('error')).toBe(0);
    expect(stream.writableEnded).toBe(false);
  });
});
