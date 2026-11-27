import { Writable } from 'node:stream';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogRecord, UniversalLogger } from '@aldok10/nestjs-observe-logger-core/contracts';
import {
  BufferedRemoteTransport,
  type RemotePayload,
} from '@aldok10/nestjs-observe-logger-delivery';
import { levelAtLeast } from '@aldok10/nestjs-observe-logger-filtering';
import { jsonFormatter } from '@aldok10/nestjs-observe-logger-formatters/json';
import { createAdvancedRedactor } from '@aldok10/nestjs-observe-logger-redaction';
import {
  DEV_LOGGER,
  LOGGER_MANAGER,
  LoggerModule,
  NestjsLoggerAdapter,
  type LoggerManager,
  type LoggerServiceLike,
} from '@aldok10/nestjs-observe-logger';
import { ConsoleTransport } from '@aldok10/nestjs-observe-logger-transports/console';

function collector(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { stream, lines };
}

class E2EBufferedTransport extends BufferedRemoteTransport {
  protected buildPayload(batch: readonly string[]): RemotePayload {
    return { body: JSON.stringify(batch) };
  }
}

interface WireHit {
  readonly url: string;
  readonly body: string;
}

const redaction = {
  matchers: createAdvancedRedactor({ fields: { fields: ['token'] } }),
};

afterEach(() => {
  vi.useRealTimers();
});

describe('composite end-to-end regression', () => {
  it(
    'routes a NestJS module record through an adapter, filtered channels and two ' +
      'transports, then flushes and shuts down without post-close writes or leaked timers',
    async () => {
      vi.useFakeTimers();
      const baselineTimers = vi.getTimerCount();

      const stdout = collector();
      const stderr = collector();
      const adapterHits: string[] = [];
      const hits: WireHit[] = [];
      const nestBackend: LoggerServiceLike = {
        log: (message: unknown) => adapterHits.push(`log:${String(message)}`),
        error: (message: unknown) => adapterHits.push(`error:${String(message)}`),
        warn: (message: unknown) => adapterHits.push(`warn:${String(message)}`),
        debug: (message: unknown) => adapterHits.push(`debug:${String(message)}`),
        verbose: (message: unknown) => adapterHits.push(`verbose:${String(message)}`),
        fatal: (message: unknown) => adapterHits.push(`fatal:${String(message)}`),
      };
      const adapter = new NestjsLoggerAdapter();
      const buffered = new E2EBufferedTransport({
        endpoint: 'http://example.com/ingest',
        name: 'e2e-delivery',
        formatter: jsonFormatter,
        flushIntervalMs: 60_000,
        fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
          hits.push({
            url:
              typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.toString()
                  : input.url,
            body: typeof init?.body === 'string' ? init.body : '',
          });
          return { ok: true, status: 200 } as unknown as Response;
        }) as typeof fetch,
      });

      const moduleRef = await Test.createTestingModule({
        imports: [
          LoggerModule.forRoot({
            adapters: [adapter],
            channels: {
              ingress: {
                default: true,
                backend: { type: 'nestjs', adapter, logger: nestBackend },
                filters: [levelAtLeast('info')],
                redaction,
                routes: [
                  { to: 'console' },
                  { to: 'delivery', when: (record) => record.level === 'error' },
                ],
              },
              console: {
                transports: [
                  new ConsoleTransport({
                    formatter: jsonFormatter,
                    stdout: stdout.stream,
                    stderr: stderr.stream,
                  }),
                ],
                filters: [(record) => !record.message.includes('skip-me')],
                redaction,
              },
              delivery: { transports: [buffered], redaction },
            },
          }),
        ],
      }).compile();

      expect(vi.getTimerCount()).toBe(baselineTimers + 1);

      const logger = moduleRef.get<UniversalLogger>(DEV_LOGGER);
      const manager = moduleRef.get<LoggerManager>(LOGGER_MANAGER);

      logger.info?.('composite info', {
        requestId: 'req-info',
        metadata: { token: 'secret-info', keep: 'shown' },
      });
      logger.error('composite error', {
        requestId: 'req-error',
        metadata: { token: 'secret-error' },
      });
      logger.debug('composite debug', { requestId: 'req-debug' });
      logger.info?.('skip-me', { requestId: 'req-skip' });

      await manager.flush();

      const consoleRecords = [...stdout.lines, ...stderr.lines].map(
        (line) => JSON.parse(line) as LogRecord,
      );
      expect(consoleRecords.map((record) => record.message)).toEqual([
        'composite info',
        'composite error',
      ]);
      expect(consoleRecords[0]?.metadata).toMatchObject({ token: '[REDACTED]', keep: 'shown' });
      expect(adapterHits).toEqual(['log:composite info', 'error:composite error', 'log:skip-me']);

      expect(hits).toHaveLength(1);
      expect(new URL(hits[0]!.url).pathname).toBe('/ingest');
      const delivered = (JSON.parse(hits[0]!.body) as string[]).map(
        (line) => JSON.parse(line) as LogRecord,
      );
      expect(delivered.map((record) => record.message)).toEqual(['composite error']);
      expect(delivered[0]?.metadata).toMatchObject({ token: '[REDACTED]' });
      expect(JSON.stringify([...consoleRecords, ...delivered])).not.toContain('secret-');

      const lineCount = stdout.lines.length + stderr.lines.length;
      await moduleRef.close();

      logger.info?.('after close info', { requestId: 'req-after-info' });
      logger.error('after close error', { requestId: 'req-after-error' });
      await manager.flush();

      expect(stdout.lines.length + stderr.lines.length).toBe(lineCount);
      expect(hits).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(baselineTimers);
    },
  );
});
