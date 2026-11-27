import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createHighlightAdapter, type HighlightClientLike } from './highlight.adapter.js';

describe('HighlightErrorAdapter', () => {
  it('initializes H.init, calls consumeError with session/request/metadata, and flushes', async () => {
    const init = vi.fn();
    const consumeError = vi.fn();
    const flush = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const client: HighlightClientLike = { init, consumeError, flush, stop };

    const adapter = createHighlightAdapter({ client, projectID: 'proj-1', serviceName: 'api' });
    adapter.initialize();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ projectID: 'proj-1', serviceName: 'api' }),
    );

    adapter.capture(
      normalizeError(new Error('highlight err'), {
        context: { requestId: 'req-9' },
        trace: { traceId: 't-1' },
        vendorContext: { secureSessionId: 'sess-1' },
      }),
    );

    expect(consumeError).toHaveBeenCalledWith(
      expect.any(Error),
      'sess-1',
      'req-9',
      expect.objectContaining({ traceId: 't-1', severity: 'error' }),
    );
    await adapter.shutdown();
    expect(flush).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });
});
