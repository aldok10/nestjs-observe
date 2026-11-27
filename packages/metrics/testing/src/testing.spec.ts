import { describe, expect, it } from 'vitest';
import { InMemoryMetricsHarness } from './index.js';

describe('InMemoryMetricsHarness', () => {
  it('collects and queries recorded metrics in memory', async () => {
    const harness = new InMemoryMetricsHarness({ resource: { serviceName: 'spec' } });
    harness.metrics.counter('jobs.completed').add(4, { queue: 'default' });
    const metric = await harness.findMetric('jobs.completed');
    expect(metric).toBeDefined();
    expect(metric?.dataPoints[0]?.value).toBe(4);
    await harness.shutdown();
  });
});
