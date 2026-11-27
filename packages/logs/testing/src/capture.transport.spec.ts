import { describe, expect, it } from 'vitest';
import { createLogRecord } from '@aldok10/nestjs-observe-logger-core';
import { CaptureTransport } from './index.js';

describe('CaptureTransport', () => {
  it('captures records and reports health', async () => {
    const transport = new CaptureTransport('capture-test');
    const record = createLogRecord({ level: 'info', message: 'captured' });
    transport.write(record);
    await expect(transport.flush()).resolves.toBeUndefined();
    expect(transport.records).toEqual([record]);
    expect(transport.health()).toMatchObject({
      name: 'capture-test',
      healthy: true,
      sent: 1,
      failed: 0,
    });
    await expect(transport.close()).resolves.toBeUndefined();
  });
});
