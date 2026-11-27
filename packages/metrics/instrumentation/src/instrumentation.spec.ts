import { MetricsRuntime, ObserveMetrics } from '@aldok10/nestjs-observe-metrics';
import { MetricReader } from '@opentelemetry/sdk-metrics';
import { afterEach, describe, expect, it } from 'vitest';
import { DataMetricsCollector, HttpMetricsCollector, RuntimeMetricsCollector } from './index.js';

class TestReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

describe('Metrics instrumentation collectors', () => {
  let runtime: MetricsRuntime | undefined;
  let runtimeCollector: RuntimeMetricsCollector | undefined;

  afterEach(async () => {
    runtimeCollector?.stop();
    runtimeCollector = undefined;
    if (runtime !== undefined) {
      await runtime.shutdown();
      runtime = undefined;
    }
  });

  it('collects HTTP RED, runtime, and data metrics', async () => {
    const reader = new TestReader();
    runtime = new MetricsRuntime({ readers: [reader] });
    runtime.initialize();
    const metrics = new ObserveMetrics(runtime);

    const http = new HttpMetricsCollector(metrics);
    http.startRequest('GET', '/orders/:id');
    http.finishRequest({ method: 'GET', route: '/orders/:id', statusCode: 500, durationMs: 12 });

    const data = new DataMetricsCollector(metrics);
    data.recordDbOperation('postgresql', 'SELECT', 4);
    data.recordRedisOperation('GET', 1);
    data.adjustQueueDepth('emails', 2);
    data.recordQueueProcessing('emails', 15);
    data.recordWorkerJob('invoice', true);

    runtimeCollector = new RuntimeMetricsCollector(metrics);
    runtimeCollector.start();

    const { resourceMetrics } = await reader.collect();
    const names = (resourceMetrics.scopeMetrics[0]?.metrics ?? []).map((m) => m.descriptor.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'http.server.request.count',
        'http.server.request.duration',
        'http.server.error.count',
        'http.server.active_requests',
        'db.client.operation.duration',
        'redis.client.operation.duration',
        'queue.depth',
        'queue.processing.duration',
        'worker.job.count',
        'process.runtime.nodejs.memory.rss',
        'process.runtime.nodejs.eventloop.utilization',
      ]),
    );
  });
});
