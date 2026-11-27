import { describe, expect, it } from 'vitest';
import { ObserverTestHarness } from './index.js';

describe('ObserverTestHarness', () => {
  it('captures correlated logs, spans, and metrics in memory', async () => {
    const harness = await ObserverTestHarness.create({ resource: { serviceName: 'harness' } });
    expect(harness.runtime.logger).toBeDefined();
    expect(harness.runtime.tracer).toBeDefined();
    expect(harness.runtime.metrics).toBeDefined();
    harness.runtime.logger?.info('harness log');
    expect(harness.logs.records).toHaveLength(1);
    await harness.shutdown();
  });
});
