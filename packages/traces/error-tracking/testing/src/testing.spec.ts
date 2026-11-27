import { describe, expect, it } from 'vitest';
import { createTestErrorTracker } from './index.js';

describe('createTestErrorTracker', () => {
  it('captures events into MemoryErrorTrackingAdapter', async () => {
    const { adapter, runtime, tracker } = createTestErrorTracker();
    await runtime.initialize();
    await tracker.captureException(new Error('test failure'));
    expect(adapter.events).toHaveLength(1);
    expect(adapter.events[0]?.message).toBe('test failure');
    adapter.clear();
    expect(adapter.events).toHaveLength(0);
    await runtime.shutdown();
  });
});
