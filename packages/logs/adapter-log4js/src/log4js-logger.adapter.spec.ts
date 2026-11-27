import { describe, expect, it } from 'vitest';
import type { AdapterLogger } from '@aldok10/nestjs-observe-logger-core';
import type { LogLevel, LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { InvalidLoggerConfigurationException } from '@aldok10/nestjs-observe-logger-core/exceptions';
import {
  LOG4JS_ADAPTER_CAPABILITIES,
  Log4jsLoggerAdapter,
  type Log4jsAdapterOptions,
  type Log4jsLike,
} from './index.js';

interface BackendCall {
  readonly method: string;
  readonly args: unknown[];
}

function createFakeBackend(calls: BackendCall[]): Log4jsLike {
  return {
    trace: (...args: unknown[]) => calls.push({ method: 'trace', args }),
    debug: (...args: unknown[]) => calls.push({ method: 'debug', args }),
    info: (...args: unknown[]) => calls.push({ method: 'info', args }),
    warn: (...args: unknown[]) => calls.push({ method: 'warn', args }),
    error: (...args: unknown[]) => calls.push({ method: 'error', args }),
    fatal: (...args: unknown[]) => calls.push({ method: 'fatal', args }),
    mark: (...args: unknown[]) => calls.push({ method: 'mark', args }),
  };
}

function createOptions(extra: Partial<Log4jsAdapterOptions> = {}): Log4jsAdapterOptions {
  return { level: 'trace', ...extra };
}

function recordOf(call: BackendCall | undefined): LogRecord {
  expect(call).toBeDefined();
  return call?.args[1] as LogRecord;
}

const LEVEL_MAPPING_CASES: ReadonlyArray<{ universal: LogLevel; expectedMethod: string }> = [
  { universal: 'trace', expectedMethod: 'trace' },
  { universal: 'debug', expectedMethod: 'debug' },
  { universal: 'verbose', expectedMethod: 'debug' },
  { universal: 'info', expectedMethod: 'info' },
  { universal: 'log', expectedMethod: 'info' },
  { universal: 'warn', expectedMethod: 'warn' },
  { universal: 'error', expectedMethod: 'error' },
  { universal: 'fatal', expectedMethod: 'fatal' },
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
    label: 'unsupported log4js level',
    levelMap: { trace: 'silly' },
    pattern: /unsupported log4js level "silly"/,
  },
];

describe('Log4jsLoggerAdapter', () => {
  it('exposes honest capabilities with childLoggers disabled', () => {
    expect(LOG4JS_ADAPTER_CAPABILITIES).toMatchObject({
      structuredMetadata: true,
      childLoggers: false,
      contextBinding: true,
      dynamicLogLevels: false,
      nativeTransports: true,
      redaction: true,
      serialization: true,
      flush: false,
      gracefulShutdown: false,
    });
  });

  describe('create', () => {
    it.each(LEVEL_MAPPING_CASES)(
      'maps universal "$universal" to Log4js "$expectedMethod" while keeping record.level',
      ({ universal, expectedMethod }) => {
        const calls: BackendCall[] = [];
        const logger = new Log4jsLoggerAdapter().create(
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

        new Log4jsLoggerAdapter().create(createFakeBackend(backendCalls), options).info?.('event');
        expect(sinkRecords).toHaveLength(expectedSinkCount);
        expect(backendCalls).toHaveLength(expectedBackendCount);
      },
    );

    it('merges and sanitizes structured metadata from base and call contexts', () => {
      const records: LogRecord[] = [];
      const logger = new Log4jsLoggerAdapter().create(
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
      const logger = new Log4jsLoggerAdapter().create(
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

    it('merges child context into records without native backend child', () => {
      const backendCalls: BackendCall[] = [];
      const records: LogRecord[] = [];
      const logger = new Log4jsLoggerAdapter().create(
        createFakeBackend(backendCalls),
        createOptions({
          sink: (record) => {
            records.push(record);
          },
          ownership: 'both',
          context: { context: 'parent' },
        }),
      ) as AdapterLogger;

      logger.child({ context: 'child', traceId: 'trace-2' }).info?.('from child');

      expect(backendCalls.map((call) => call.method)).toEqual(['info']);
      expect(recordOf(backendCalls[0])).toMatchObject({ context: 'child', traceId: 'trace-2' });
      expect(records[0]).toMatchObject({ context: 'child', traceId: 'trace-2' });
    });

    it.each(INVALID_LEVEL_MAP_CASES)('rejects $label at create time', ({ levelMap, pattern }) => {
      const backend = createFakeBackend([]);
      expect(() =>
        new Log4jsLoggerAdapter().create(backend, createOptions({ levelMap: levelMap as never })),
      ).toThrow(InvalidLoggerConfigurationException);
      expect(() =>
        new Log4jsLoggerAdapter().create(backend, createOptions({ levelMap: levelMap as never })),
      ).toThrow(pattern);
    });

    it('falls back to a callable method when the mapped method is absent', () => {
      const calls: BackendCall[] = [];
      const backend: Log4jsLike = {
        info: (...args: unknown[]) => calls.push({ method: 'info', args }),
      };

      (new Log4jsLoggerAdapter().create(backend, createOptions()) as AdapterLogger).fatal?.(
        'fatal',
      );
      expect(calls.map((call) => call.method)).toEqual(['info']);
      expect(recordOf(calls[0]).level).toBe('fatal');
    });
  });
});
