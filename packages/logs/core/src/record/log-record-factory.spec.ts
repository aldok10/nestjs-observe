import { describe, expect, it } from 'vitest';
import { LOG_LEVELS, type LogLevel } from '../contracts/index.js';
import { LogRecordFactory, createLogRecord } from './index.js';

const METADATA_LIMIT_CASES: ReadonlyArray<{
  readonly label: string;
  readonly maxMetadataKeys: number | undefined;
  readonly expectedCount: number;
}> = [
  { label: 'default cap (64 keys)', maxMetadataKeys: undefined, expectedCount: 64 },
  { label: 'custom cap (8 keys)', maxMetadataKeys: 8, expectedCount: 8 },
];

describe('LogRecordFactory', () => {
  describe('create', () => {
    it.each(LOG_LEVELS.map((level) => ({ level })))(
      'preserves universal level "$level"',
      ({ level }: { level: LogLevel }) => {
        const record = new LogRecordFactory().create({ level, message: `msg-${level}` });
        expect(record.level).toBe(level);
        expect(record.message).toBe(`msg-${level}`);
      },
    );

    it('merges context, sanitizes metadata and caches process metadata', () => {
      const factory = new LogRecordFactory();
      const record = factory.create({
        level: 'info',
        message: 'ready',
        context: {
          context: 'API',
          traceId: 'trace-1',
          spanId: 'span-1',
          requestId: 'req-1',
          correlationId: 'corr-1',
          metadata: { password: 'hunter2', ok: 1 },
        },
      });

      expect(record.schemaVersion).toBe(1);
      expect(record.timestamp).toBeTypeOf('number');
      expect(record.context).toBe('API');
      expect(record.traceId).toBe('trace-1');
      expect(record.spanId).toBe('span-1');
      expect(record.requestId).toBe('req-1');
      expect(record.correlationId).toBe('corr-1');
      expect(record.metadata).toEqual({ password: '[REDACTED]', ok: 1 });
      expect(record.hostname).toBeTypeOf('string');
      expect(record.processId).toBe(process.pid);

      const second = factory.create({ level: 'log', message: 'again' });
      expect(second.hostname).toBe(record.hostname);
      expect(second.processId).toBe(record.processId);
    });

    it('serializes errors with a depth-limited cause chain and cycle guard', () => {
      type WithCause = Error & { code?: string; cause?: unknown };
      const root = new Error('root') as WithCause;
      root.name = 'Boom';
      root.code = 'E_ROOT';
      root.stack = 'stack-trace';
      const child = new Error('child') as WithCause;
      root.cause = child;
      child.cause = root;

      const record = createLogRecord({ level: 'error', message: 'failed', error: root });
      expect(record.error).toMatchObject({
        name: 'Boom',
        message: 'root',
        code: 'E_ROOT',
        stack: 'stack-trace',
      });
      expect(record.error?.cause).toMatchObject({ message: 'child' });
      expect(JSON.stringify(record.error)).toContain('[Circular cause]');
    });

    it.each(METADATA_LIMIT_CASES)(
      'caps metadata keys with $label',
      ({ maxMetadataKeys, expectedCount }) => {
        const metadata: Record<string, unknown> = {};
        for (let index = 0; index < 100; index += 1) metadata[`key${index}`] = index;

        const record = createLogRecord({
          level: 'info',
          message: 'x',
          context: { metadata },
          ...(maxMetadataKeys !== undefined ? { limits: { maxMetadataKeys } } : {}),
        });
        expect(Object.keys(record.metadata ?? {})).toHaveLength(expectedCount);
      },
    );

    it('never throws on hostile metadata', () => {
      const hostile = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('broken');
          },
        },
      );
      expect(() =>
        createLogRecord({ level: 'warn', message: 'x', context: { metadata: hostile } }),
      ).not.toThrow();
    });

    it('includes canonical channel and source fields when provided', () => {
      const record = createLogRecord({
        level: 'info',
        message: 'canonical',
        channel: 'app',
        source: { file: 'app.ts', line: 42, function: 'boot' },
      });

      expect(record.channel).toBe('app');
      expect(record.source).toEqual({ file: 'app.ts', line: 42, function: 'boot' });
    });
  });
});
