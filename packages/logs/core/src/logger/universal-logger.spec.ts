import { describe, expect, it } from 'vitest';
import { LogContextStore } from '../context/index.js';
import type { LogLevel, LogRecord } from '../contracts/index.js';
import { LogPipeline } from '../pipeline/index.js';
import { InMemoryCaptureTransport as CaptureTransport } from '../test-capture.transport.js';
import { UniversalLoggerImpl, type LogSink } from './index.js';

function createSetup(level?: LogLevel, sink?: LogSink) {
  const capture = new CaptureTransport();
  const pipeline = new LogPipeline({ transports: [capture] });
  const logger = new UniversalLoggerImpl({
    pipeline,
    ...(level === undefined ? {} : { level }),
    ...(sink === undefined ? {} : { sink }),
  });
  return { capture, pipeline, logger };
}

const LEVEL_THRESHOLD_CASES: ReadonlyArray<{
  readonly threshold: LogLevel;
  readonly expectedMessages: readonly string[];
}> = [
  { threshold: 'trace', expectedMessages: ['d', 'i', 'w', 'e', 'f'] },
  { threshold: 'warn', expectedMessages: ['w', 'e', 'f'] },
  { threshold: 'fatal', expectedMessages: ['f'] },
];

const NESTJS_ARG_PARSING_CASES: ReadonlyArray<{
  readonly label: string;
  readonly invoke: (logger: UniversalLoggerImpl) => void;
  readonly expectedMessage: string;
  readonly expectedContext?: string;
  readonly expectedStackFragment?: string;
}> = [
  {
    label: 'string context on log()',
    invoke: (logger) => logger.log('app started', 'InstanceLoader'),
    expectedMessage: 'app started',
    expectedContext: 'InstanceLoader',
  },
  {
    label: '(message, stack, context) on error()',
    invoke: (logger) =>
      logger.error('boom', 'Error: boom\n    at run (a.ts:1:1)', 'PaymentService'),
    expectedMessage: 'boom',
    expectedContext: 'PaymentService',
    expectedStackFragment: 'at run',
  },
  {
    label: 'context-only string on error()',
    invoke: (logger) => logger.error('denied', 'AuthGuard'),
    expectedMessage: 'denied',
    expectedContext: 'AuthGuard',
  },
];

describe('UniversalLoggerImpl', () => {
  describe('severity filtering & setLogLevels', () => {
    it.each(LEVEL_THRESHOLD_CASES)(
      'filters records below threshold="$threshold"',
      async ({ threshold, expectedMessages }) => {
        const { capture, pipeline, logger } = createSetup(threshold);
        logger.debug('d');
        logger.info('i');
        logger.warn('w');
        logger.error('e');
        logger.fatal('f');
        await pipeline.flush();

        expect(capture.records.map((record) => record.message)).toEqual(expectedMessages);
      },
    );

    it('supports dynamic setLogLevels and falls back to log for unsupported levels', async () => {
      const { capture, pipeline, logger } = createSetup('warn');
      logger.setLogLevels(['notice', 'error']);
      logger.log('fallback');
      logger.warn('hidden');
      logger.error('shown');
      await pipeline.flush();

      expect(capture.records.map((record) => record.message)).toEqual(['fallback', 'shown']);
    });
  });

  describe('NestJS LoggerService compatibility', () => {
    it.each(NESTJS_ARG_PARSING_CASES)(
      'parses $label',
      async ({ invoke, expectedMessage, expectedContext, expectedStackFragment }) => {
        const { capture, pipeline, logger } = createSetup('trace');
        invoke(logger);
        await pipeline.flush();

        expect(capture.records[0]?.message).toBe(expectedMessage);
        if (expectedContext !== undefined)
          expect(capture.records[0]?.context).toBe(expectedContext);
        if (expectedStackFragment !== undefined) {
          expect(capture.records[0]?.error?.stack).toContain(expectedStackFragment);
        }
      },
    );

    it('merges ambient, child and explicit contexts without overwriting explicit args', async () => {
      const { capture, pipeline } = createSetup('trace');
      const store = new LogContextStore();
      let record: LogRecord | undefined;
      store.run({ requestId: 'ambient', metadata: { a: 1 } }, () => {
        const logger = new UniversalLoggerImpl({ pipeline, context: store, level: 'trace' });
        const child = logger.child({ requestId: 'child', metadata: { b: 2 } });
        expect(child).not.toBe(logger);
        child.log('hello', { traceId: 'explicit', metadata: { a: 99 } });
        record = capture.records[0];
      });
      await pipeline.flush();

      expect(record?.requestId).toBe('child');
      expect(record?.traceId).toBe('explicit');
      expect(record?.metadata).toEqual({ a: 99, b: 2 });
    });

    it('forwards records to observer sink and pipeline', async () => {
      const sinks: LogRecord[] = [];
      const { capture, pipeline, logger } = createSetup(undefined, (record) => {
        sinks.push(record);
      });
      logger.log('one');
      logger.error('two', 'stack');
      await pipeline.flush();

      expect(sinks.map((record) => record.message)).toEqual(['one', 'two']);
      expect(capture.records.map((record) => record.message)).toEqual(['one', 'two']);
    });
  });
});
