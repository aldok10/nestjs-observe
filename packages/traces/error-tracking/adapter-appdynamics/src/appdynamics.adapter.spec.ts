import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import {
  createAppDynamicsAdapter,
  type AppDynamicsAgentLike,
  type AppDynamicsTransactionLike,
} from './appdynamics.adapter.js';

describe('AppDynamicsErrorAdapter', () => {
  it('marks error and adds snapshot data on active Business Transaction', () => {
    const markError = vi.fn();
    const addSnapshotData = vi.fn();
    const txn: AppDynamicsTransactionLike = { markError, addSnapshotData };
    const client: AppDynamicsAgentLike = { getTransaction: vi.fn(() => txn) };

    const adapter = createAppDynamicsAdapter({ client });
    adapter.initialize();
    adapter.capture(
      normalizeError(new Error('appd boom'), {
        request: { statusCode: 503 },
        trace: { traceId: 't-1' },
        vendorContext: { request: { url: '/pay' } },
      }),
    );

    expect(addSnapshotData).toHaveBeenCalledWith('traceId', 't-1');
    expect(markError).toHaveBeenCalledWith(expect.any(Error), 503);
  });
});
