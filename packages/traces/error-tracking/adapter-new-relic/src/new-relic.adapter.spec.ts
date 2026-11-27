import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createNewRelicAdapter, type NewRelicAgentLike } from './new-relic.adapter.js';

describe('NewRelicErrorAdapter', () => {
  it('calls noticeError with flat primitive attributes and respects shutdownAgent', async () => {
    const noticeError = vi.fn();
    const shutdown = vi.fn((_opts, cb?: () => void) => cb?.());
    const client: NewRelicAgentLike = { noticeError, shutdown };

    const adapter = createNewRelicAdapter({ client, shutdownAgent: true });
    adapter.initialize();
    adapter.capture(
      normalizeError(new Error('nr boom'), {
        trace: { traceId: 't-1', spanId: 's-1' },
        tags: { region: 'us' },
      }),
    );

    expect(noticeError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ traceId: 't-1', spanId: 's-1', 'tag.region': 'us' }),
    );
    await adapter.shutdown(1000);
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
