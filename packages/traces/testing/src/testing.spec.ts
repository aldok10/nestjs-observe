import { describe, expect, it } from 'vitest';
import { InMemoryTracingHarness } from './index.js';

describe('InMemoryTracingHarness', () => {
  it('captures spans in memory and resets/shuts down cleanly', async () => {
    const harness = new InMemoryTracingHarness({ resource: { serviceName: 'spec' } });
    await harness.tracer.withSpan('test.op', async () => 'ok');
    expect(harness.getSpans()).toHaveLength(1);
    harness.reset();
    expect(harness.getSpans()).toHaveLength(0);
    await harness.shutdown();
  });
});
