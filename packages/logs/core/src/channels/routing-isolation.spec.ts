import { describe, expect, it } from 'vitest';
import { createLoggerManager } from './logger-manager.js';
import { InMemoryCaptureTransport } from '../test-capture.transport.js';
import type { LogRecord, LogTransport } from '../contracts/index.js';

class FailingTransport implements LogTransport {
  readonly name = 'failing';
  write(_record: LogRecord): void {
    throw new Error('boom');
  }
}

describe('routing isolation', () => {
  it('isolates transport failures and prevents duplicate delivery', async () => {
    const capture = new InMemoryCaptureTransport('ok');
    const manager = createLoggerManager({
      channels: [{ name: 'app', transports: [new FailingTransport(), capture] }],
    });

    manager.getLogger('app').info('hello');
    await manager.flush();

    expect(capture.records).toHaveLength(1);
    expect(capture.records[0]?.message).toBe('hello');
  });
});
