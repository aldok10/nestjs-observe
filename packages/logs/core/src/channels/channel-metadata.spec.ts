import { describe, expect, it } from 'vitest';
import { createLoggerManager } from './logger-manager.js';
import { InMemoryCaptureTransport } from '../test-capture.transport.js';

describe('channel metadata enrichment', () => {
  it('adds configured channel metadata to records', async () => {
    const capture = new InMemoryCaptureTransport('app');
    const manager = createLoggerManager({
      channels: [
        {
          name: 'app',
          metadata: { service: 'billing', tenant: 't1' },
          transports: [capture],
        },
      ],
    });

    manager.getLogger('app').info('hello');
    await manager.flush();

    expect(capture.records[0]?.metadata).toMatchObject({ service: 'billing', tenant: 't1' });
  });
});
