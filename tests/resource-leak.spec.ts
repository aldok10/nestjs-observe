import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import {
  BufferedRemoteTransport,
  type RemotePayload,
} from '@aldok10/nestjs-observe-logger-delivery';
import { ConsoleTransport } from '@aldok10/nestjs-observe-logger-transports/console';
import { StreamTransport } from '@aldok10/nestjs-observe-logger-transports/file';

const record: LogRecord = {
  schemaVersion: 1,
  timestamp: 1_700_000_000_000,
  level: 'info',
  message: 'leak-check',
};

class StubRemoteTransport extends BufferedRemoteTransport {
  protected buildPayload(batch: readonly string[]): RemotePayload {
    return { body: JSON.stringify(batch) };
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('systematic transport resource-leak checks', () => {
  it('BufferedRemoteTransport clears its timer, aborts, and stops fetching after close', async () => {
    vi.useFakeTimers();
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response);
    const transport = new StubRemoteTransport({
      endpoint: 'http://example.com',
      fetchImpl,
      flushIntervalMs: 60_000,
    });

    expect(vi.getTimerCount()).toBe(1);
    await transport.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(abort).toHaveBeenCalledTimes(1);

    transport.write(record);
    await transport.flush();
    expect(transport.health().queued).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    await transport.close();
  });

  it('ConsoleTransport removes owned and per-write stream listeners', async () => {
    const held = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, _callback) {
        // Hold the write so backpressure listeners stay attached until drain is emitted.
      },
    });
    const err = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const transport = new ConsoleTransport({ formatter: 'text', stdout: held, stderr: err });
    const owned = held.listenerCount('error');

    const pending = transport.write(record);
    expect(held.listenerCount('drain')).toBe(1);
    expect(held.listenerCount('error')).toBe(owned + 1);
    held.emit('drain');
    await pending;
    expect(held.listenerCount('drain')).toBe(0);
    expect(held.listenerCount('error')).toBe(owned);

    await transport.close();
    expect(held.listenerCount('error')).toBe(owned - 1);
    expect(err.listenerCount('error')).toBe(0);
  });

  it('StreamTransport detaches from an injected stream without ending it', async () => {
    const stream = new PassThrough();
    const transport = new StreamTransport({ stream, formatter: 'json' });
    expect(stream.listenerCount('error')).toBe(1);

    await transport.write(record);
    await transport.close();
    await transport.close();

    expect(stream.listenerCount('error')).toBe(0);
    expect(stream.writableEnded).toBe(false);
  });

  it('StreamTransport ends an owned stream and detaches after a fake-timer advance', async () => {
    vi.useFakeTimers();
    const stream = new PassThrough();
    const transport = new StreamTransport({ stream, closeStream: true, formatter: 'json' });

    await transport.write(record);
    const closing = transport.close();
    await vi.advanceTimersByTimeAsync(5000);
    await closing;

    expect(stream.listenerCount('error')).toBe(0);
    expect(stream.writableEnded).toBe(true);
    await transport.close();
  });
});
