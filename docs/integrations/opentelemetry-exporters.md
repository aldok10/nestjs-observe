# OpenTelemetry Exporters and Instrumentation

Exporters and instrumentation helpers are split into standalone packages for Traces (`@aldok10/nestjs-observe-tracing-*`) and Metrics (`@aldok10/nestjs-observe-metrics-*`).

## Trace Exporters

### OTLP/HTTP (`@aldok10/nestjs-observe-tracing-exporter-otlp`)

Wraps `@opentelemetry/exporter-trace-otlp-http` and `@opentelemetry/sdk-trace`.

- `createOtlpTraceExporter(options?: OtlpTraceExporterOptions): OTLPTraceExporter`
- `createOtlpTraceSpanProcessor(options?: OtlpTraceExporterOptions & { batch?: Omit<BatchSpanProcessorOptions, 'exporter'> }): BatchSpanProcessor`

Options: `url`, `headers`, `timeoutMillis`, `concurrencyLimit`, and `batch`.

```ts
import { TracingModule } from '@aldok10/nestjs-observe-tracing';
import { createOtlpTraceSpanProcessor } from '@aldok10/nestjs-observe-tracing-exporter-otlp';

TracingModule.forRoot({
  resource: { serviceName: 'orders-api' },
  spanProcessors: [
    createOtlpTraceSpanProcessor({
      url: 'http://localhost:4318/v1/traces',
    }),
  ],
});
```

See [exporter-otlp README](../../packages/traces/exporter-otlp/README.md).

### Console (`@aldok10/nestjs-observe-tracing-exporter-console`)

Wraps `@opentelemetry/sdk-trace`'s `ConsoleSpanExporter` and `SimpleSpanProcessor` for local development.

- `createConsoleTraceExporter(): ConsoleSpanExporter`
- `createConsoleSpanProcessor(): SpanProcessor`

`SimpleSpanProcessor` exports each span synchronously as it ends; use `exporter-otlp` in production. See [exporter-console README](../../packages/traces/exporter-console/README.md).

## Trace Instrumentation

### HTTP Auto-Instrumentation (`@aldok10/nestjs-observe-tracing-instrumentation-http`)

Wraps `@opentelemetry/instrumentation` and `@opentelemetry/instrumentation-http` with URL ignore filters and a duplicate-registration guard.

- `createHttpTracingInstrumentation(options?: HttpTracingInstrumentationOptions): HttpInstrumentation`
- `registerHttpTracingInstrumentation(options?: HttpTracingInstrumentationOptions): () => void`

Options: `ignoreIncomingRequestUrls`, `ignoreOutgoingRequestUrls` (`(string | RegExp)[]`), and `headersToSpanAttributes`. Requires an active global `TracerProvider` (`registerGlobal: true`). See [instrumentation-http README](../../packages/traces/instrumentation-http/README.md).

### Data-Layer Span Helpers (`@aldok10/nestjs-observe-tracing-instrumentation-data`)

Typed wrappers around `ObserveTracer.withSpan()` that apply OpenTelemetry `SpanKind` values and semantic attributes without monkey-patching:

- `traceDbQuery(tracer, options, fn)` — `SpanKind.CLIENT`, span `db.<system>.<operation>`
- `traceRedisCommand(tracer, options, fn)` — `SpanKind.CLIENT`, span `redis.<command>`
- `traceQueueProducer(tracer, options, fn)` — `SpanKind.PRODUCER`, span `queue.publish <queueName>`
- `traceQueueConsumer(tracer, options, fn)` — `SpanKind.CONSUMER`, span `queue.process <queueName>`
- `traceWorkerJob(tracer, options, fn)` — `SpanKind.INTERNAL`, span `worker.<jobName>`

See [instrumentation-data README](../../packages/traces/instrumentation-data/README.md).

## Metric Exporters

### Prometheus (`@aldok10/nestjs-observe-metrics-exporter-prometheus`)

Wraps `@opentelemetry/exporter-prometheus` for pull-based scraping.

- `createPrometheusMetricReader(options?: PrometheusMetricReaderOptions): PrometheusExporter` — `preventServerStart` defaults to `true` so `/metrics` can be served from your NestJS HTTP server without opening a second port.
- `getPrometheusMetricsText(exporter: PrometheusExporter): Promise<string>` — collects and serializes metrics in Prometheus text exposition format.

```ts
import { Controller, Get, Header } from '@nestjs/common';
import type { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { getPrometheusMetricsText } from '@aldok10/nestjs-observe-metrics-exporter-prometheus';

@Controller()
export class MetricsController {
  constructor(private readonly prometheusReader: PrometheusExporter) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    return getPrometheusMetricsText(this.prometheusReader);
  }
}
```

See [exporter-prometheus README](../../packages/metrics/exporter-prometheus/README.md).

### OTLP/HTTP (`@aldok10/nestjs-observe-metrics-exporter-otlp`)

Wraps `@opentelemetry/exporter-metrics-otlp-http` and `@opentelemetry/sdk-metrics` for push-based export.

- `createOtlpMetricExporter(options?: OTLPMetricExporterOptions): OTLPMetricExporter`
- `createOtlpMetricReader(options?: OtlpMetricReaderOptions): PeriodicExportingMetricReader`

Options: `exportIntervalMillis`, `exportTimeoutMillis`, plus `OTLPMetricExporterOptions` (`url`, `headers`, `concurrencyLimit`, `temporalityPreference`). Always await `MetricsRuntime.shutdown()` (or `reader.shutdown()`) so the periodic timer is cleared. See [exporter-otlp README](../../packages/metrics/exporter-otlp/README.md).

### Console (`@aldok10/nestjs-observe-metrics-exporter-console`)

Wraps `ConsoleMetricExporter` and `PeriodicExportingMetricReader` for local debugging.

- `createConsoleMetricExporter(): ConsoleMetricExporter`
- `createConsoleMetricReader(options?: ConsoleMetricReaderOptions): PeriodicExportingMetricReader`

See [exporter-console README](../../packages/metrics/exporter-console/README.md).

## Metric Collectors

### HTTP, Runtime, and Data Collectors (`@aldok10/nestjs-observe-metrics-instrumentation`)

Three collector classes built on `ObserveMetrics` (automatically applying `CardinalityGuard`):

- `HttpMetricsCollector(metrics)` — `startRequest(method, route)` and `finishRequest({ method, route, statusCode, durationMs })`. Records `http.server.request.count`, `http.server.request.duration`, `http.server.error.count` (`statusCode >= 500`), and `http.server.active_requests`.
- `RuntimeMetricsCollector(metrics)` — `start()` / `stop()`. Records `process.runtime.nodejs.memory.rss`, `process.runtime.nodejs.memory.heap_used`, `process.runtime.nodejs.cpu.usage_us`, `process.runtime.nodejs.eventloop.utilization`, and `process.runtime.nodejs.eventloop.delay_p99_ms`. Always call `stop()` on teardown.
- `DataMetricsCollector(metrics)` — `recordDbOperation`, `recordRedisOperation`, `adjustQueueDepth`, `recordQueueProcessing`, and `recordWorkerJob`. Records `db.client.operation.duration`, `redis.client.operation.duration`, `queue.depth`, `queue.processing.duration`, and `worker.job.count`.

See [metrics instrumentation README](../../packages/metrics/instrumentation/README.md).
