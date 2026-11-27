import { ConsoleLogger } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AdapterLogger } from '@aldok10/nestjs-observe-logger-core';
import type { LogLevel, LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { InvalidLoggerConfigurationException } from '@aldok10/nestjs-observe-logger-core/exceptions';
import {
  NestjsLoggerAdapter,
  type LoggerServiceLike,
  type NestjsAdapterOptions,
} from './nestjs-logger.adapter.js';

interface BackendCall {
  readonly method: string;
  readonly args: unknown[];
}

function createFakeBackend(
  calls: BackendCall[],
  bindings: unknown[] = [],
  childCalls: BackendCall[] = calls,
  levelSets: string[][] = [],
): LoggerServiceLike {
  const make = (target: BackendCall[]): LoggerServiceLike => ({
    log: (...args: unknown[]) => target.push({ method: 'log', args }),
    error: (...args: unknown[]) => target.push({ method: 'error', args }),
    warn: (...args: unknown[]) => target.push({ method: 'warn', args }),
    debug: (...args: unknown[]) => target.push({ method: 'debug', args }),
    verbose: (...args: unknown[]) => target.push({ method: 'verbose', args }),
    fatal: (...args: unknown[]) => target.push({ method: 'fatal', args }),
    child: (context: string) => {
      bindings.push(context);
      return make(childCalls);
    },
    setLogLevels: (levels: readonly string[]) => levelSets.push([...levels]),
  });
  return make(calls);
}

function createOptions(extra: Partial<NestjsAdapterOptions> = {}): NestjsAdapterOptions {
  return { level: 'trace', ...extra };
}

const LEVEL_MAPPING_CASES: ReadonlyArray<{ universal: LogLevel; expectedMethod: string }> = [
  { universal: 'trace', expectedMethod: 'verbose' },
  { universal: 'debug', expectedMethod: 'debug' },
  { universal: 'verbose', expectedMethod: 'verbose' },
  { universal: 'info', expectedMethod: 'log' },
  { universal: 'log', expectedMethod: 'log' },
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
    levelMap: { bogus: 'log' },
    pattern: /unknown universal level "bogus"/,
  },
  {
    label: 'unsupported nestjs level',
    levelMap: { fatal: 'silly' },
    pattern: /unsupported nestjs level "silly"/,
  },
];

describe('NestjsLoggerAdapter', () => {
  describe('create', () => {
    it.each(LEVEL_MAPPING_CASES)(
      'maps universal "$universal" to NestJS "$expectedMethod"',
      ({ universal, expectedMethod }) => {
        const calls: BackendCall[] = [];
        const logger = new NestjsLoggerAdapter().create(
          createFakeBackend(calls),
          createOptions(),
        ) as AdapterLogger;
        logger[universal]?.(`msg-${universal}`);
        expect(calls.map((call) => call.method)).toEqual([expectedMethod]);
        expect(calls[0]?.args[0]).toBe(`msg-${universal}`);
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

        new NestjsLoggerAdapter().create(createFakeBackend(backendCalls), options).info?.('event');
        expect(sinkRecords).toHaveLength(expectedSinkCount);
        expect(backendCalls).toHaveLength(expectedBackendCount);
      },
    );

    it('merges and sanitizes structured metadata from base and call contexts', () => {
      const records: LogRecord[] = [];
      const logger = new NestjsLoggerAdapter().create(
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

    it('binds child context as a string and forwards mapped setLogLevels', () => {
      const parentCalls: BackendCall[] = [];
      const childCalls: BackendCall[] = [];
      const bindings: unknown[] = [];
      const levelSets: string[][] = [];
      const records: LogRecord[] = [];
      const logger = new NestjsLoggerAdapter().create(
        createFakeBackend(parentCalls, bindings, childCalls, levelSets),
        createOptions({
          sink: (record) => {
            records.push(record);
          },
          ownership: 'both',
          context: { context: 'parent' },
        }),
      ) as AdapterLogger;

      logger
        .child({ context: 'child', traceId: 'trace-2', metadata: { password: 'x' } })
        .info?.('from child');
      logger.setLogLevels?.(['trace', 'info', 'fatal', 'info']);

      expect(bindings).toEqual(['child']);
      expect(parentCalls).toHaveLength(0);
      expect(childCalls.map((call) => call.method)).toEqual(['log']);
      expect(records[0]).toMatchObject({ context: 'child', traceId: 'trace-2' });
      expect(levelSets).toEqual([['verbose', 'log', 'fatal']]);
    });

    it.each(INVALID_LEVEL_MAP_CASES)('rejects $label at create time', ({ levelMap, pattern }) => {
      const backend = createFakeBackend([]);
      expect(() =>
        new NestjsLoggerAdapter().create(backend, createOptions({ levelMap: levelMap as never })),
      ).toThrow(InvalidLoggerConfigurationException);
      expect(() =>
        new NestjsLoggerAdapter().create(backend, createOptions({ levelMap: levelMap as never })),
      ).toThrow(pattern);
    });

    it('integrates with real NestJS ConsoleLogger', () => {
      const consoleLogger = new ConsoleLogger('TestRoot');
      const captured: Array<{ args: unknown[] }> = [];
      const originalLog = consoleLogger.log.bind(consoleLogger);
      consoleLogger.log = (...args: unknown[]) => {
        captured.push({ args });
        return originalLog(...(args as [unknown, ...unknown[]]));
      };

      const adapted = new NestjsLoggerAdapter().create(consoleLogger, { level: 'trace' });
      adapted.info?.('hello console', { context: 'UsersService' });

      expect(captured[0]?.args[0]).toBe('hello console');
      expect(captured[0]?.args[1]).toBe('UsersService');
    });
  });
});
