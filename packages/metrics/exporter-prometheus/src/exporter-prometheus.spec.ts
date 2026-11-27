import { MetricsRuntime, ObserveMetrics } from '@aldok10/nestjs-observe-metrics';
import { afterEach, describe, expect, it } from 'vitest';
import { createPrometheusMetricReader, getPrometheusMetricsText } from './index.js';

describe('Prometheus metric exporter', () => {
  let runtime: MetricsRuntime | undefined;

  afterEach(async () => {
    if (runtime !== undefined) {
      await runtime.shutdown();
      runtime = undefined;
    }
  });

  it('serializes collected metrics in Prometheus text exposition format', async () => {
    const reader = createPrometheusMetricReader({ preventServerStart: true });
    runtime = new MetricsRuntime({ readers: [reader] });
    runtime.initialize();
    const metrics = new ObserveMetrics(runtime);
    metrics.counter('http_requests_total').add(3, { method: 'GET' });

    const text = await getPrometheusMetricsText(reader);
    expect(text).toContain('http_requests_total');
    expect(text).toContain('3');
  });
});
