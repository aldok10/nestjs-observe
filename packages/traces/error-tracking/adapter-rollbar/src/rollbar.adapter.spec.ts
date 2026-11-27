import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createRollbarAdapter, type RollbarClientLike } from './rollbar.adapter.js';

describe('RollbarErrorAdapter', () => {
  it('maps fatal -> critical, attaches custom payload, and waits on flush', async () => {
    const critical = vi.fn((_obj, _custom, cb) => cb?.(null));
    const wait = vi.fn((cb: () => void) => cb());
    const client: RollbarClientLike = {
      error: vi.fn((_obj, _custom, cb) => cb?.(null)),
      critical,
      wait,
    };

    const adapter = createRollbarAdapter({ client });
    adapter.initialize();

    await adapter.capture(
      normalizeError(new Error('rollbar fatal'), {
        severity: 'fatal',
        fingerprint: ['pay', 'gateway'],
      }),
    );

    expect(critical).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ fingerprint: 'pay:gateway' }),
      expect.any(Function),
    );
    await adapter.flush();
    expect(wait).toHaveBeenCalledOnce();
  });
});
