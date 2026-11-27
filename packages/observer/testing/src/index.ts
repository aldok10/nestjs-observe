import { ObserverRuntime, type ObserverOptions } from '@aldok10/nestjs-observe';
import type { ResourceMetadata } from '@aldok10/nestjs-observe-core';
import { CaptureTransport } from '@aldok10/nestjs-observe-logger-testing';
import { MetricReader, type MetricData, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace';

class HarnessMetricReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

export class ObserverTestHarness {
  readonly logs: CaptureTransport;
  readonly spanExporter: InMemorySpanExporter;
  readonly metricReader: MetricReader;
  readonly runtime: ObserverRuntime;

  private constructor(
    logs: CaptureTransport,
    spanExporter: InMemorySpanExporter,
    metricReader: MetricReader,
    runtime: ObserverRuntime,
  ) {
    this.logs = logs;
    this.spanExporter = spanExporter;
    this.metricReader = metricReader;
    this.runtime = runtime;
  }

  static async create(
    options: { readonly resource?: ResourceMetadata } = {},
  ): Promise<ObserverTestHarness> {
    const logs = new CaptureTransport();
    const spanExporter = new InMemorySpanExporter();
    const metricReader = new HarnessMetricReader();

    const runtimeOptions: ObserverOptions = {
      ...(options.resource !== undefined ? { resource: options.resource } : {}),
      logger: { enabled: true, transports: [logs] },
      tracing: {
        enabled: true,
        spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })],
      },
      metrics: { enabled: true, readers: [metricReader] },
    };

    const runtime = new ObserverRuntime(runtimeOptions);
    await runtime.initialize();
    return new ObserverTestHarness(logs, spanExporter, metricReader, runtime);
  }

  getSpans(): readonly ReadableSpan[] {
    return this.spanExporter.getFinishedSpans();
  }

  async collectMetrics(): Promise<ResourceMetrics> {
    const result = await this.metricReader.collect();
    return result.resourceMetrics;
  }

  async findMetric(name: string): Promise<MetricData | undefined> {
    const collected = await this.collectMetrics();
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
