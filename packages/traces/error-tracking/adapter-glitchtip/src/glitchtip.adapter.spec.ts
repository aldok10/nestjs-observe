import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createGlitchTipAdapter, type GlitchTipClientLike } from './glitchtip.adapter.js';

describe('GlitchTipErrorAdapter', () => {
  it('initializes with autoSessionTracking=false and captures exceptions', async () => {
    const init = vi.fn();
    const captureException = vi.fn();
    const client: GlitchTipClientLike = {
      init,
      withScope(cb) {
        cb({ setLevel: vi.fn(), setTags: vi.fn() });
      },
      captureException,
      flush: vi.fn(async () => true),
      close: vi.fn(async () => true),
    };

    const adapter = createGlitchTipAdapter({ client, dsn: 'https://key@glitchtip.local/1' });
    adapter.initialize();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ autoSessionTracking: false, sendDefaultPii: false }),
    );
    expect(adapter.capabilities.sessions).toBe(false);
    expect(adapter.capabilities.profiling).toBe(false);

    adapter.capture(normalizeError(new Error('glitchtip boom')));
    expect(captureException).toHaveBeenCalledOnce();
    await adapter.shutdown();
  });
});
