import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import winston from 'winston';
import type { AdapterLogger } from '@aldok10/nestjs-observe-logger-core';
import type {
  LogLevel,
  LogRecord,
  UniversalLogger,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import { InvalidLoggerConfigurationException } from '@aldok10/nestjs-observe-logger-core/exceptions';
import { WinstonLoggerAdapter, type WinstonAdapterOptions, type WinstonLike } from './index.js';

interface BackendCall {
  readonly method: string;
  readonly args: unknown[];
}

function createFakeBackend(
  calls: BackendCall[],
  bindings: unknown[] = [],
  childCalls: BackendCall[] = calls,
): WinstonLike {
  const make = (target: BackendCall[]): WinstonLike => ({
    error: (...args: unknown[]) => target.push({ method: 'error', args }),
    warn: (...args: unknown[]) => target.push({ method: 'warn', args }),
    info: (...args: unknown[]) => target.push({ method: 'info', args }),
    verbose: (...args: unknown[]) => target.push({ method: 'verbose', args }),
    debug: (...args: unknown[]) => target.push({ method: 'debug', args }),
    child: (values: Record<string, unknown>) => {
      bindings.push(values);
      return make(childCalls);
    },
  });
  return make(calls);
}

function createOptions(extra: Partial<WinstonAdapterOptions> = {}): WinstonAdapterOptions {
  return { level: 'trace', ...extra };
}

function recordOf(call: BackendCall | undefined): LogRecord {
  expect(call).toBeDefined();
  return call?.args[1] as LogRecord;
}

const LEVEL_MAPPING_CASES: ReadonlyArray<{ universal: LogLevel; expectedMethod: string }> = [
  { universal: 'trace', expectedMethod: 'debug' },
  { universal: 'debug', expectedMethod: 'debug' },
  { universal: 'verbose', expectedMethod: 'verbose' },
  { universal: 'info', expectedMethod: 'info' },
  { universal: 'log', expectedMethod: 'info' },
  { universal: 'warn', expectedMethod: 'warn' },
  { universal: 'error', expectedMethod: 'error' },
  { universal: 'fatal', expectedMethod: 'error' },
];

const OWNERSHIP_CASES: ReadonlyArray<{
  readonly mode: 'package' | 'both' | 'backend';
  readonly useSink: boolean;
  readonly expectedSinkCount: number;
  readonly expectedBackendCount: number;
}> = [
  { mode: 'package', useSink: true, expectedSinkCount: 1, expectedBackendCount: 0 },
  { mode: 'both', useSink: true, expectedSinkCount: 1, expectedBackendCount: 1 },
  { mode: 'backend', useSink: false, expectedSinkCount: 0, expectedBackendCount: 1 },
];

const INVALID_LEVEL_MAP_CASES: ReadonlyArray<{
  readonly label: string;
  readonly levelMap: Record<string, string>;
  readonly pattern: RegExp;
}> = [
  {
    label: 'unknown universal level',
    levelMap: { bogus: 'info' },
    pattern: /unknown universal level "bogus"/,
  },
  {
    label: 'unsupported winston level',
    levelMap: { fatal: 'fatal' },
    pattern: /unsupported winston level "fatal"/,
  },
];

describe('WinstonLoggerAdapter', () => {
  describe('create', () => {
    it.each(LEVEL_MAPPING_CASES)(
      'maps universal "$universal" to Winston "$expectedMethod" while keeping record.level',
      ({ universal, expectedMethod }) => {
        const calls: BackendCall[] = [];
        const logger = new WinstonLoggerAdapter().create(
          createFakeBackend(calls),
          createOptions(),
        ) as AdapterLogger;
        logger[universal]?.(`msg-${universal}`);
        expect(calls.map((call) => call.method)).toEqual([expectedMethod]);
        expect(recordOf(calls[0]).level).toBe(universal);
      },
    );

    it.each(OWNERSHIP_CASES)(
      'enforces ownership="$mode" without duplicate delivery',
      ({ mode, useSink, expectedSinkCount, expectedBackendCount }) => {
        const sinkRecords: LogRecord[] = [];
        const backendCalls: BackendCall[] = [];
        const options = useSink
          ? createOptions({
              sink: (record) => {
                sinkRecords.push(record);
              },
              ownership: mode,
            })
          : createOptions({ ownership: mode });

        new WinstonLoggerAdapter().create(createFakeBackend(backendCalls), options).info?.('event');
        expect(sinkRecords).toHaveLength(expectedSinkCount);
        expect(backendCalls).toHaveLength(expectedBackendCount);
      },
    );

    it('merges and sanitizes structured metadata from base and call contexts', () => {
      const records: LogRecord[] = [];
      const logger = new WinstonLoggerAdapter().create(
        createFakeBackend([]),
        createOptions({
          sink: (record) => {
            records.push(record);
          },
          context: { context: 'Base', metadata: { base: 1 } },
        }),
      ) as AdapterLogger;

      logger.info?.('hello', {
        context: 'API',
        traceId: 'trace-1',
        metadata: { password: 'hunter2', userId: 'u1', nested: { secret: 's', keep: 1 } },
      });

      expect(records[0]).toMatchObject({
        level: 'info',
        message: 'hello',
        context: 'API',
        traceId: 'trace-1',
        metadata: {
          base: 1,
          password: '[REDACTED]',
          userId: 'u1',
          nested: { secret: '[REDACTED]', keep: 1 },
        },
      });
    });

    it('serializes errors from the first argument and from metadata safely', () => {
      const records: LogRecord[] = [];
      const logger = new WinstonLoggerAdapter().create(
        createFakeBackend([]),
        createOptions({
          sink: (record) => {
            records.push(record);
          },
        }),
      ) as AdapterLogger;
      const first = new Error('boom');
      const nested = new Error('meta boom');

      logger.error?.(first as unknown as string);
      logger.warn?.('warn', { metadata: { err: nested } });

      expect(records[0]?.error).toMatchObject({ name: 'Error', message: 'boom' });
      expect(records[1]?.error).toMatchObject({ name: 'Error', message: 'meta boom' });
      expect(records[1]?.metadata?.['err']).toMatchObject({ name: 'Error', message: 'meta boom' });
      expect(records[1]?.metadata?.['err']).not.toBeInstanceOf(Error);
    });

    it('binds child context through backend.child and keeps it on records', () => {
      const parentCalls: BackendCall[] = [];
      const childCalls: BackendCall[] = [];
      const bindings: unknown[] = [];
      const records: LogRecord[] = [];
      const logger = new WinstonLoggerAdapter().create(
        createFakeBackend(parentCalls, bindings, childCalls),
        createOptions({
          sink: (record) => {
            records.push(record);
          },
          ownership: 'both',
          context: { context: 'parent' },
        }),
      ) as AdapterLogger;

      logger.child({ context: 'child', traceId: 'trace-2' }).info?.('from child');

      expect(bindings).toEqual([{ context: 'child', traceId: 'trace-2' }]);
      expect(parentCalls).toHaveLength(0);
      expect(childCalls.map((call) => call.method)).toEqual(['info']);
      expect(records[0]).toMatchObject({ context: 'child', traceId: 'trace-2' });
    });

    it.each(INVALID_LEVEL_MAP_CASES)('rejects $label at create time', ({ levelMap, pattern }) => {
      const backend = createFakeBackend([]);
      expect(() =>
        new WinstonLoggerAdapter().create(backend, createOptions({ levelMap: levelMap as never })),
      ).toThrow(InvalidLoggerConfigurationException);
      expect(() =>
        new WinstonLoggerAdapter().create(backend, createOptions({ levelMap: levelMap as never })),
      ).toThrow(pattern);
    });

    it('falls back to a callable method when the mapped method is absent', () => {
      const calls: BackendCall[] = [];
      const backend: WinstonLike = {
        info: (...args: unknown[]) => calls.push({ method: 'info', args }),
      };

      (new WinstonLoggerAdapter().create(backend, createOptions()) as AdapterLogger).fatal?.(
        'fatal',
      );
      expect(calls.map((call) => call.method)).toEqual(['info']);
      expect(recordOf(calls[0]).level).toBe('fatal');
    });

    it('integrates with real winston 3 instance, child loggers, and redaction', () => {
      const stream = new PassThrough();
      const chunks: string[] = [];
      stream.on('data', (chunk: Buffer | string) => chunks.push(chunk.toString('utf8')));
      const instance = winston.createLogger({
        level: 'debug',
        format: winston.format.json(),
        transports: [new winston.transports.Stream({ stream })],
      });

      const adapted = new WinstonLoggerAdapter().create(instance, {
        level: 'trace',
      }) as UniversalLogger & {
        child(context: { context?: string }): UniversalLogger;
      };
      adapted.trace?.('mapped trace');
      adapted.fatal?.('mapped fatal', { metadata: { apiKey: 'k-123', keep: 1 } });
      adapted.child({ context: 'Billing' }).warn('from child');

      const lines = chunks
        .join('')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines).toHaveLength(3);
      expect(lines[0]).toMatchObject({ level: 'debug', message: 'mapped trace' });
      expect(lines[1]).toMatchObject({
        level: 'error',
        message: 'mapped fatal',
        metadata: { apiKey: '[REDACTED]', keep: 1 },
      });
      expect(lines[2]).toMatchObject({ level: 'warn', message: 'from child', context: 'Billing' });
    });
  });
});
