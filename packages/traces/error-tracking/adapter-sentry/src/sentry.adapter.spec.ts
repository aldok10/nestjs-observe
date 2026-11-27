import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createSentryAdapter, type SentryClientLike } from './sentry.adapter.js';

describe('SentryErrorAdapter', () => {
  it('initializes client, populates scope, captures exception, flushes, and shuts down', async () => {
    const setLevel = vi.fn();
    const setTags = vi.fn();
    const setFingerprint = vi.fn();
    const setContext = vi.fn();
    const captureException = vi.fn();
    const init = vi.fn();
    const flush = vi.fn(async () => true);
    const close = vi.fn(async () => true);

    const client: SentryClientLike = {
      init,
      withScope(cb) {
        cb({ setLevel, setTags, setFingerprint, setContext });
      },
      captureException,
      flush,
      close,
    };

    const adapter = createSentryAdapter({
      client,
      dsn: 'https://key@sentry.io/1',
      environment: 'prod',
    });
    adapter.initialize();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://key@sentry.io/1', environment: 'prod' }),
    );

    const event = normalizeError(new Error('checkout failed'), {
      severity: 'error',
      tags: { region: 'id' },
      fingerprint: ['checkout', 'timeout'],
      trace: { traceId: 't1', spanId: 's1' },
    });
    adapter.capture(event);

    expect(setLevel).toHaveBeenCalledWith('error');
    expect(setTags).toHaveBeenCalledWith({ region: 'id' });
    expect(setFingerprint).toHaveBeenCalledWith(['checkout', 'timeout']);
    expect(setContext).toHaveBeenCalledWith('trace', { trace_id: 't1', span_id: 's1' });
    expect(captureException).toHaveBeenCalledOnce();

    await adapter.shutdown(1000);
    expect(flush).toHaveBeenCalledWith(1000);
    expect(close).toHaveBeenCalledWith(1000);
  });
});
