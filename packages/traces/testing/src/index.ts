import type { ResourceMetadata } from '@aldok10/nestjs-observe-core';
import { ObserveTracer, TracingRuntime } from '@aldok10/nestjs-observe-tracing';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace';

export class InMemoryTracingHarness {
  readonly exporter: InMemorySpanExporter;
  readonly runtime: TracingRuntime;
  readonly tracer: ObserveTracer;

  constructor(
    options: { readonly resource?: ResourceMetadata; readonly registerGlobal?: boolean } = {},
  ) {
    this.exporter = new InMemorySpanExporter();
    this.runtime = new TracingRuntime({
      ...(options.resource !== undefined ? { resource: options.resource } : {}),
      registerGlobal: options.registerGlobal ?? true,
      spanProcessors: [new SimpleSpanProcessor({ exporter: this.exporter })],
    });
    this.runtime.initialize();
    this.tracer = new ObserveTracer(this.runtime);
  }

  getSpans(): readonly ReadableSpan[] {
    return this.exporter.getFinishedSpans();
  }

  reset(): void {
    this.exporter.reset();
  }

  async shutdown(): Promise<void> {
    await this.runtime.shutdown();
  }
}
