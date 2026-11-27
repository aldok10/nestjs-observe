import type { ResourceMetadata } from '@aldok10/nestjs-observe-core';
import { MetricsRuntime, ObserveMetrics } from '@aldok10/nestjs-observe-metrics';
import { MetricReader, type MetricData, type ResourceMetrics } from '@opentelemetry/sdk-metrics';

class InMemoryMetricReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {
    // No-op for pull-based in-memory reader.
  }

  protected async onShutdown(): Promise<void> {
    // No-op for pull-based in-memory reader.
  }
}

export class InMemoryMetricsHarness {
  readonly reader: MetricReader;
  readonly runtime: MetricsRuntime;
  readonly metrics: ObserveMetrics;

  constructor(
    options: { readonly resource?: ResourceMetadata; readonly registerGlobal?: boolean } = {},
  ) {
    this.reader = new InMemoryMetricReader();
    this.runtime = new MetricsRuntime({
      ...(options.resource !== undefined ? { resource: options.resource } : {}),
      registerGlobal: options.registerGlobal ?? true,
      readers: [this.reader],
    });
    this.runtime.initialize();
    this.metrics = new ObserveMetrics(this.runtime);
  }

  async collect(): Promise<ResourceMetrics> {
    const result = await this.reader.collect();
    return result.resourceMetrics;
  }

  async findMetric(name: string): Promise<MetricData | undefined> {
    const collected = await this.collect();
    for (const scope of collected.scopeMetrics) {
      const found = scope.metrics.find((m) => m.descriptor.name === name);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  async shutdown(): Promise<void> {
    await this.runtime.shutdown();
  }
}
