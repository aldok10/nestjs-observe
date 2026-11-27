import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createHoneybadgerAdapter, type HoneybadgerClientLike } from './honeybadger.adapter.js';

describe('HoneybadgerErrorAdapter', () => {
  it('configures client and sends notice with component, action, fingerprint, and context', async () => {
    const configure = vi.fn();
    const notifyAsync = vi.fn(async () => ({ id: 'hb-1' }));
    const client: HoneybadgerClientLike = {
      configure,
      notify: vi.fn(),
      notifyAsync,
      addBreadcrumb: vi.fn(),
    };

    const adapter = createHoneybadgerAdapter({ client, apiKey: 'hb-key', environment: 'prod' });
    adapter.initialize();
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'hb-key', environment: 'prod' }),
    );

    await adapter.capture(
      normalizeError(new Error('job failed'), {
        source: { module: 'billing', operation: 'charge' },
        fingerprint: ['billing', 'charge'],
        tags: { env: 'prod' },
      }),
    );

    expect(notifyAsync).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        component: 'billing',
        action: 'charge',
        fingerprint: 'billing:charge',
      }),
    );
  });
});
