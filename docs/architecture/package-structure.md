# Package Structure

The monorepo is managed with `pnpm` workspaces (`pnpm-workspace.yaml`) and contains **47 publishable packages** across 6 workspace groups.

## Workspace Layout

```text
packages/
├── core/                           # 1 package: domain-neutral primitives
├── logs/                           # 14 packages: logging runtime, adapters, transports, NestJS integration
├── traces/                         # 6 packages: OpenTelemetry tracing, exporters, instrumentation
│   └── error-tracking/             # 18 packages: vendor-neutral error tracking + 16 provider adapters
├── metrics/                        # 6 packages: OpenTelemetry metrics, exporters, collectors
└── observer/                       # 2 packages: unified NestJS composition layer + test harness
```

All packages target **Node.js `>=22`**, emit **ESM + CJS + TypeScript declarations (`.d.ts`)** via `tsup`, and NestJS integration packages support `@nestjs/common` and `@nestjs/core` `^10.0.0 || ^11.0.0 || ^12.0.0`.

## Package Inventory (47 Packages)

### Shared Core (1 Package)

| Package                        | Directory       | Purpose                                                                                                                                            |
| ------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@aldok10/nestjs-observe-core` | `packages/core` | `ResourceMetadata`, `LifecycleCoordinator`, `BoundedExecution`, `ObserveContextStore`, `OptionalPeerLoader`, `DiagnosticsSink`, `ObserveException` |

### Logs (14 Packages)

| Package                                          | Directory                        | Purpose                                                                                                       |
| ------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@aldok10/nestjs-observe-logger`                 | `packages/logs/logger`           | NestJS integration (`ObserveLoggerModule`, `ChannelModule`, `@InjectLogger`, `NestjsLoggerAdapter`)           |
| `@aldok10/nestjs-observe-logger-core`            | `packages/logs/core`             | Framework-independent runtime (`createLoggerManager`, `LogPipeline`, `ChannelRouter`, `LogContextStore`)      |
| `@aldok10/nestjs-observe-logger-adapter-pino`    | `packages/logs/adapter-pino`     | `PinoLoggerAdapter` wrapping an existing `pino` instance                                                      |
| `@aldok10/nestjs-observe-logger-adapter-winston` | `packages/logs/adapter-winston`  | `WinstonLoggerAdapter` wrapping an existing `winston` logger                                                  |
| `@aldok10/nestjs-observe-logger-adapter-bunyan`  | `packages/logs/adapter-bunyan`   | `BunyanLoggerAdapter` wrapping an existing `bunyan` logger                                                    |
| `@aldok10/nestjs-observe-logger-adapter-log4js`  | `packages/logs/adapter-log4js`   | `Log4jsLoggerAdapter` wrapping an existing `log4js` logger                                                    |
| `@aldok10/nestjs-observe-logger-context`         | `packages/logs/context`          | `createContextProvider`, `composeContextProviders`, lazy OTel span reader                                     |
| `@aldok10/nestjs-observe-logger-filtering`       | `packages/logs/filtering`        | Composable filters (`levelAtLeast`, `excludeLevels`, `sample`, `channelFilter`, `byContext`)                  |
| `@aldok10/nestjs-observe-logger-redaction`       | `packages/logs/redaction`        | Matchers (`fieldRedactor`, `headerRedactor`, `queryRedactor`, `regexRedactor`)                                |
| `@aldok10/nestjs-observe-logger-formatters`      | `packages/logs/formatters`       | Built-in formatters (`./json`, `./pretty`, `./text`)                                                          |
| `@aldok10/nestjs-observe-logger-delivery`        | `packages/logs/delivery`         | `BufferedRemoteTransport` with bounded queue, batching, retries, and circuit breaker                          |
| `@aldok10/nestjs-observe-logger-transports`      | `packages/logs/transports`       | Built-in transports (`./console`, `./file`, `./http`, `./elasticsearch`, `./openobserve`, `./loki`, `./otlp`) |
| `@aldok10/nestjs-observe-logger-http`            | `packages/logs/integration-http` | HTTP request logging for Express, Fastify, and NestJS                                                         |
| `@aldok10/nestjs-observe-logger-testing`         | `packages/logs/testing`          | `CaptureTransport` in-memory log capture for tests                                                            |

### Traces (6 Packages)

| Package                                                | Directory                              | Purpose                                                                                                          |
| ------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@aldok10/nestjs-observe-tracing`                      | `packages/traces/tracing`              | `TracingRuntime`, `bootstrapTracing`, `ObserveTracer`, `@Trace()`, `TracingInterceptor`, `TracingModule`         |
| `@aldok10/nestjs-observe-tracing-exporter-otlp`        | `packages/traces/exporter-otlp`        | `createOtlpTraceExporter`, `createOtlpTraceSpanProcessor`                                                        |
| `@aldok10/nestjs-observe-tracing-exporter-console`     | `packages/traces/exporter-console`     | `createConsoleTraceExporter`, `createConsoleSpanProcessor`                                                       |
| `@aldok10/nestjs-observe-tracing-instrumentation-http` | `packages/traces/instrumentation-http` | `createHttpTracingInstrumentation`, `registerHttpTracingInstrumentation`                                         |
| `@aldok10/nestjs-observe-tracing-instrumentation-data` | `packages/traces/instrumentation-data` | Span helpers (`traceDbQuery`, `traceRedisCommand`, `traceQueueProducer`, `traceQueueConsumer`, `traceWorkerJob`) |
| `@aldok10/nestjs-observe-tracing-testing`              | `packages/traces/testing`              | `InMemoryTracingHarness` wrapping `InMemorySpanExporter`                                                         |

### Error Tracking (18 Packages)

| Package                                              | Directory                                            | Purpose                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@aldok10/nestjs-observe-error-tracking`             | `packages/traces/error-tracking/error-tracking`      | `ErrorTrackingRuntime`, `ErrorTrackingModule`, `ObserveErrorTracker`, `ObserveExceptionFilter`, `./bridges` |
| `@aldok10/nestjs-observe-error-tracking-testing`     | `packages/traces/error-tracking/testing`             | `MemoryErrorTrackingAdapter` and `createTestErrorTracker`                                                   |
| `@aldok10/nestjs-observe-error-tracking-sentry`      | `packages/traces/error-tracking/adapter-sentry`      | Sentry adapter (`@sentry/node`)                                                                             |
| `@aldok10/nestjs-observe-error-tracking-glitchtip`   | `packages/traces/error-tracking/adapter-glitchtip`   | GlitchTip adapter (Sentry DSN compatible)                                                                   |
| `@aldok10/nestjs-observe-error-tracking-bugsink`     | `packages/traces/error-tracking/adapter-bugsink`     | Bugsink adapter (Sentry DSN compatible)                                                                     |
| `@aldok10/nestjs-observe-error-tracking-highlight`   | `packages/traces/error-tracking/adapter-highlight`   | Highlight.io adapter (`@highlight-run/node`)                                                                |
| `@aldok10/nestjs-observe-error-tracking-bugsnag`     | `packages/traces/error-tracking/adapter-bugsnag`     | Bugsnag adapter (`@bugsnag/js`)                                                                             |
| `@aldok10/nestjs-observe-error-tracking-rollbar`     | `packages/traces/error-tracking/adapter-rollbar`     | Rollbar adapter (`rollbar`)                                                                                 |
| `@aldok10/nestjs-observe-error-tracking-honeybadger` | `packages/traces/error-tracking/adapter-honeybadger` | Honeybadger adapter (`@honeybadger-io/js`)                                                                  |
| `@aldok10/nestjs-observe-error-tracking-otlp`        | `packages/traces/error-tracking/adapter-otlp`        | OpenTelemetry OTLP/HTTP `/v1/logs` + active-span exception adapter                                          |
| `@aldok10/nestjs-observe-error-tracking-new-relic`   | `packages/traces/error-tracking/adapter-new-relic`   | New Relic Node.js agent adapter                                                                             |
| `@aldok10/nestjs-observe-error-tracking-datadog`     | `packages/traces/error-tracking/adapter-datadog`     | Datadog `dd-trace` span error tagging adapter                                                               |
| `@aldok10/nestjs-observe-error-tracking-dynatrace`   | `packages/traces/error-tracking/adapter-dynatrace`   | Dynatrace OTLP + OneAgent Span Sensor adapter                                                               |
| `@aldok10/nestjs-observe-error-tracking-elastic-apm` | `packages/traces/error-tracking/adapter-elastic-apm` | Elastic APM (`elastic-apm-node`) adapter                                                                    |
| `@aldok10/nestjs-observe-error-tracking-splunk`      | `packages/traces/error-tracking/adapter-splunk`      | Splunk Observability Cloud OTLP adapter                                                                     |
| `@aldok10/nestjs-observe-error-tracking-appdynamics` | `packages/traces/error-tracking/adapter-appdynamics` | Cisco AppDynamics adapter                                                                                   |
| `@aldok10/nestjs-observe-error-tracking-airbrake`    | `packages/traces/error-tracking/adapter-airbrake`    | Airbrake (`@airbrake/node`) adapter                                                                         |
| `@aldok10/nestjs-observe-error-tracking-raygun`      | `packages/traces/error-tracking/adapter-raygun`      | Raygun (`raygun`) adapter                                                                                   |

### Metrics (6 Packages)

| Package                                               | Directory                              | Purpose                                                                                     |
| ----------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `@aldok10/nestjs-observe-metrics`                     | `packages/metrics/metrics`             | `MetricsRuntime`, `bootstrapMetrics`, `ObserveMetrics`, `CardinalityGuard`, `MetricsModule` |
| `@aldok10/nestjs-observe-metrics-exporter-prometheus` | `packages/metrics/exporter-prometheus` | `createPrometheusMetricReader`, `getPrometheusMetricsText`                                  |
| `@aldok10/nestjs-observe-metrics-exporter-otlp`       | `packages/metrics/exporter-otlp`       | `createOtlpMetricExporter`, `createOtlpMetricReader`                                        |
| `@aldok10/nestjs-observe-metrics-exporter-console`    | `packages/metrics/exporter-console`    | `createConsoleMetricExporter`, `createConsoleMetricReader`                                  |
| `@aldok10/nestjs-observe-metrics-instrumentation`     | `packages/metrics/instrumentation`     | `HttpMetricsCollector`, `RuntimeMetricsCollector`, `DataMetricsCollector`                   |
| `@aldok10/nestjs-observe-metrics-testing`             | `packages/metrics/testing`             | `InMemoryMetricsHarness` for testing metrics in memory                                      |

### Observer (2 Packages)

| Package                           | Directory                    | Purpose                                                                         |
| --------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| `@aldok10/nestjs-observe`         | `packages/observer/observer` | `ObserverModule`, `ObserverRuntime`, `ObserverService`, DI tokens (`OBSERVE_*`) |
| `@aldok10/nestjs-observe-testing` | `packages/observer/testing`  | `ObserverTestHarness` capturing correlated logs, spans, and metrics in memory   |

## Naming and Manifest Rules

The architecture checker ([scripts/check-architecture.mjs](../../scripts/check-architecture.mjs)) enforces the following invariants on every package:

- **Directory Naming**: Package directories and all subdirectories under `src/` must use `kebab-case`.
- **Type Naming**: Exported `class`, `interface`, `type`, and `enum` declarations in non-test `.ts` files must use `PascalCase`, and `interface` names must not start with an `I` prefix.
- **Publishability**:
  - `private` must not be `true`.
  - `publishConfig.access` must be `"public"`.
  - `exports["."]` must be defined.
  - `files` must be `["dist"]` or `["LICENSE", "dist"]`.
  - `workspace:*` version ranges are forbidden in `dependencies`, `peerDependencies`, `optionalDependencies`, and `devDependencies` of workspace packages.
