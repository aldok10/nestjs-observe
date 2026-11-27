import { describe, expect, it } from 'vitest';
import type {
  DeliveryResult,
  LifecycleManaged,
  LifecycleOwner,
  LogContextProvider,
  LogEvent,
  LogFilter,
  LogMetadata,
  LogPipelineError,
  LogRedactor,
  LogSerializer,
} from './index.js';
import { isLogLevel, LOG_LEVELS, normalizeLogLevel } from './index.js';

describe('core contracts', () => {
  it('exposes log levels and guards', () => {
    expect(LOG_LEVELS).toContain('info');
    expect(isLogLevel('debug')).toBe(true);
    expect(isLogLevel('nope')).toBe(false);
    expect(normalizeLogLevel('warn')).toBe('warn');
    expect(normalizeLogLevel('bad', 'info')).toBe('info');
  });

  it('supports stable contract shapes', () => {
    const metadata: LogMetadata = { requestId: 'r1' };
    const event: LogEvent = {
      schemaVersion: 1,
      timestamp: Date.now(),
      level: 'info',
      message: 'hello',
      metadata,
    };
    const filter: LogFilter = (record) => record.level !== 'debug';
    const serializer: LogSerializer = { serialize: (value) => JSON.stringify(value) };
    const redactor: LogRedactor = {
      redact: <T>(value: T) => value,
      redactRecord: (record) => record,
    };
    const provider: LogContextProvider = { getContext: () => ({ requestId: 'r1' }) };
    const delivery: DeliveryResult = { transport: 'console', ok: true, records: 1 };
    const error: LogPipelineError = { stage: 'write', error: new Error('x') };
    const managed: LifecycleManaged = {
      flush: async () => undefined,
      close: async () => undefined,
    };
    const owner: LifecycleOwner = {
      register: () => undefined,
      flush: async () => undefined,
      shutdown: async () => undefined,
    };

    expect(filter(event)).toBe(true);
    expect(serializer.serialize(event)).toContain('hello');
    expect(redactor.redactRecord(event).message).toBe('hello');
    expect(provider.getContext()?.requestId).toBe('r1');
    expect(delivery.ok).toBe(true);
    expect(error.stage).toBe('write');
    expect(managed).toBeDefined();
    expect(owner).toBeDefined();
  });
});
