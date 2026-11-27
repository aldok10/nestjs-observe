import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createElasticApmAdapter, type ElasticApmAgentLike } from './elastic-apm.adapter.js';

describe('ElasticApmErrorAdapter', () => {
  it('captures error with labels, user, custom context, and flushes', async () => {
    const captureError = vi.fn();
    const flush = vi.fn((cb?: () => void) => cb?.());
    const client: ElasticApmAgentLike = { captureError, flush };

    const adapter = createElasticApmAdapter({ client });
    adapter.initialize();
    adapter.capture(
      normalizeError(new Error('elastic boom'), {
        tags: { service: 'api' },
        user: { id: 'u1' },
      }),
    );

    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        handled: true,
        labels: expect.objectContaining({ service: 'api', severity: 'error' }),
        user: { id: 'u1' },
      }),
    );
    await adapter.flush();
    expect(flush).toHaveBeenCalledOnce();
  });
});
