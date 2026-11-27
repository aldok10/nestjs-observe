import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createAirbrakeAdapter, type AirbrakeClientLike } from './airbrake.adapter.js';

describe('AirbrakeErrorAdapter', () => {
  it('calls notify with error, context, params, and closes on shutdown', async () => {
    const notify = vi.fn(async () => ({ id: 'ab-1' }));
    const close = vi.fn(async () => undefined);
    const client: AirbrakeClientLike = { notify, close };

    const adapter = createAirbrakeAdapter({ client });
    adapter.initialize();
    await adapter.capture(
      normalizeError(new Error('airbrake boom'), {
        severity: 'error',
        trace: { traceId: 't-1' },
      }),
    );

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
        params: expect.objectContaining({ trace: { traceId: 't-1' } }),
      }),
    );
    await adapter.shutdown();
    expect(close).toHaveBeenCalledOnce();
  });
});
