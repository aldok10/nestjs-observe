import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createRaygunAdapter, type RaygunClientLike } from './raygun.adapter.js';

describe('RaygunErrorAdapter', () => {
  it('sends exception with customData and tags', async () => {
    const send = vi.fn((_err, _data, cb) => cb?.(null));
    const stop = vi.fn();
    const client: RaygunClientLike = { send, stop };

    const adapter = createRaygunAdapter({ client });
    adapter.initialize();
    await adapter.capture(
      normalizeError(new Error('raygun boom'), {
        tags: { env: 'prod' },
        trace: { traceId: 't-1' },
      }),
    );

    expect(send).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ trace: { traceId: 't-1' } }),
      expect.any(Function),
      undefined,
      expect.arrayContaining(['severity:error', 'env:prod']),
    );
    await adapter.shutdown();
    expect(stop).toHaveBeenCalledOnce();
  });
});
