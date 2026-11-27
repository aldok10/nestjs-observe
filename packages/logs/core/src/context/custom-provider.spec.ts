import { describe, expect, it } from 'vitest';
import type { LogContextProvider, LogRecord } from '../contracts/index.js';
import { UniversalLoggerImpl } from '../logger/universal-logger.js';
import { LogPipeline } from '../pipeline/log-pipeline.js';
import { InMemoryCaptureTransport } from '../test-capture.transport.js';
import { LogContextStore } from './log-context-store.js';

function setup(context?: LogContextProvider): {
  records: LogRecord[];
  logger: UniversalLoggerImpl;
  pipeline: LogPipeline;
} {
  const transport = new InMemoryCaptureTransport();
  const pipeline = new LogPipeline({ transports: [transport] });
  return {
    records: transport.records,
    pipeline,
    logger: new UniversalLoggerImpl({ context, pipeline }),
  };
}

describe('custom context providers', () => {
  it('merges provider context under explicit call context', async () => {
    const provider: LogContextProvider = {
      getContext: () => ({ requestId: 'ambient', metadata: { a: 1, shared: 'old' } }),
    };
    const { logger, records, pipeline } = setup(provider);

    logger.info('hello', { requestId: 'explicit', metadata: { b: 2, shared: 'new' } });
    await pipeline.flush();

    expect(records[0]?.requestId).toBe('explicit');
    expect(records[0]?.metadata).toEqual({ a: 1, b: 2, shared: 'new' });
  });

  it('keeps logging when a provider throws', async () => {
    const provider: LogContextProvider = {
      getContext: () => {
        throw new Error('provider unavailable');
      },
    };
    const { logger, records } = setup(provider);

    logger.info('still logged', { requestId: 'r1' });
    expect(records).toHaveLength(1);
    expect(records[0]?.requestId).toBe('r1');
  });

  it('makes the canonical store usable as a generic provider', async () => {
    const store = new LogContextStore();
    expect(store.getContext()).toEqual(store.get());
    const { logger, records } = setup(store);

    store.runWithContext({ requestId: 'scoped' }, () => logger.info('scoped'));
    expect(records[0]?.requestId).toBe('scoped');
    expect(store.getContext()).toEqual({});
  });
});
