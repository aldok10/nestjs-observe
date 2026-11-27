import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createBugsinkAdapter, type BugsinkClientLike } from './bugsink.adapter.js';

describe('BugsinkErrorAdapter', () => {
  it('initializes with error-only defaults (tracesSampleRate=0, autoSessionTracking=false)', async () => {
    const init = vi.fn();
    const captureException = vi.fn();
    const client: BugsinkClientLike = {
      init,
      captureException,
      flush: vi.fn(async () => true),
      close: vi.fn(async () => true),
    };

    const adapter = createBugsinkAdapter({ client, dsn: 'https://key@bugsink.local/1' });
    adapter.initialize();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        tracesSampleRate: 0,
        autoSessionTracking: false,
        sendDefaultPii: false,
      }),
    );
    expect(adapter.capabilities.transactions).toBe(false);

    adapter.capture(normalizeError(new Error('bugsink boom')));
    expect(captureException).toHaveBeenCalledOnce();
    await adapter.shutdown();
  });
});
