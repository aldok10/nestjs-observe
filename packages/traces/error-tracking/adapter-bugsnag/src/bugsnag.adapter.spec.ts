import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import {
  createBugsnagAdapter,
  type BugsnagClientLike,
  type BugsnagEventLike,
} from './bugsnag.adapter.js';

describe('BugsnagErrorAdapter', () => {
  it('starts Bugsnag, maps severity/groupingHash/metadata, and notifies', async () => {
    const start = vi.fn();
    const addMetadata = vi.fn();
    const bsEvent: BugsnagEventLike = { addMetadata, setUser: vi.fn() };
    const notify = vi.fn((_err, onError, cb) => {
      onError?.(bsEvent);
      cb?.(null);
    });
    const client: BugsnagClientLike = { start, notify, leaveBreadcrumb: vi.fn() };

    const adapter = createBugsnagAdapter({ client, apiKey: 'bugsnag-key', releaseStage: 'prod' });
    adapter.initialize();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'bugsnag-key', releaseStage: 'prod' }),
    );

    await adapter.capture(
      normalizeError(new Error('bugsnag boom'), {
        severity: 'fatal',
        fingerprint: ['db', 'pool'],
        tags: { service: 'orders' },
      }),
    );

    expect(bsEvent.severity).toBe('error');
    expect(bsEvent.groupingHash).toBe('db:pool');
    expect(addMetadata).toHaveBeenCalledWith('tags', { service: 'orders' });
  });
});
