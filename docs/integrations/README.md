# Integrations

Status matrix of all implemented integrations across logging, error tracking, tracing, and metrics in `nestjs-observe`.

## Overview

| Area                                                                      | Integration Count | Packages                                                                     |
| ------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| [Logger Backends](./logger-backends.md)                                   | 4 (+ NestJS)      | `@aldok10/nestjs-observe-logger-adapter-*`, `@aldok10/nestjs-observe-logger` |
| [Log Transports](./log-transports.md)                                     | 7                 | `@aldok10/nestjs-observe-logger-transports`                                  |
| [HTTP Request Logging](./log-transports.md#http-request-logging)          | 3 frameworks      | `@aldok10/nestjs-observe-logger-http`                                        |
| [Error Tracking Providers](./error-tracking-providers.md)                 | 16                | `@aldok10/nestjs-observe-error-tracking-*`                                   |
| [OpenTelemetry Exporters & Instrumentation](./opentelemetry-exporters.md) | 7 packages        | `@aldok10/nestjs-observe-{tracing,metrics}-{exporter,instrumentation}*`      |

## Logger Backends

| Backend | Package                                                                                           | Peer Dependency                                      | Status      |
| ------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------- |
| Pino    | [`@aldok10/nestjs-observe-logger-adapter-pino`](../../packages/logs/adapter-pino/README.md)       | `pino` `^9.0.0 \|\| ^10.0.0`                         | Implemented |
| Winston | [`@aldok10/nestjs-observe-logger-adapter-winston`](../../packages/logs/adapter-winston/README.md) | `winston` `^3.0.0`                                   | Implemented |
| Bunyan  | [`@aldok10/nestjs-observe-logger-adapter-bunyan`](../../packages/logs/adapter-bunyan/README.md)   | `bunyan` `^1.8.0`                                    | Implemented |
| Log4js  | [`@aldok10/nestjs-observe-logger-adapter-log4js`](../../packages/logs/adapter-log4js/README.md)   | `log4js` `^6.0.0`                                    | Implemented |
| NestJS  | [`@aldok10/nestjs-observe-logger`](../../packages/logs/logger/README.md)                          | `@nestjs/common` `^10.0.0 \|\| ^11.0.0 \|\| ^12.0.0` | Implemented |

## Log Transports & HTTP Logging

| Integration                     | Package / Subpath                                                                       | Optional Peer Dependency                       | Delivery Model                          | Status      |
| ------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------- | ----------- |
| Console                         | `@aldok10/nestjs-observe-logger-transports/console`                                     | None                                           | Local (`stdout`/`stderr`)               | Implemented |
| File / Rotation                 | `@aldok10/nestjs-observe-logger-transports/file`                                        | `rotating-file-stream` `^4.0.0`                | Local (`fs` / stream)                   | Implemented |
| HTTP                            | `@aldok10/nestjs-observe-logger-transports/http`                                        | None (`fetch`)                                 | Buffered remote                         | Implemented |
| Elasticsearch                   | `@aldok10/nestjs-observe-logger-transports/elasticsearch`                               | None (`fetch`)                                 | Buffered remote (`/_bulk`)              | Implemented |
| OpenObserve                     | `@aldok10/nestjs-observe-logger-transports/openobserve`                                 | None (`fetch`)                                 | Buffered remote (`/_json`)              | Implemented |
| Grafana Loki                    | `@aldok10/nestjs-observe-logger-transports/loki`                                        | None (`fetch`)                                 | Buffered remote (gzip)                  | Implemented |
| OTLP/HTTP Logs                  | `@aldok10/nestjs-observe-logger-transports/otlp`                                        | None (`fetch`)                                 | Buffered remote (`/v1/logs`)            | Implemented |
| Express / Fastify / NestJS HTTP | [`@aldok10/nestjs-observe-logger-http`](../../packages/logs/integration-http/README.md) | `express`, `fastify`, `@nestjs/common`, `rxjs` | Request hook / middleware / interceptor | Implemented |

## Error Tracking Providers

| Group              | Providers                                                       | Adapters | Status      |
| ------------------ | --------------------------------------------------------------- | -------- | ----------- |
| Sentry-compatible  | Sentry, GlitchTip, Bugsink                                      | 3        | Implemented |
| Dedicated SaaS     | Bugsnag, Rollbar, Honeybadger, Highlight.io, Airbrake, Raygun   | 6        | Implemented |
| OpenTelemetry OTLP | OTLP (`/v1/logs` + span exception)                              | 1        | Implemented |
| APM Agents         | New Relic, Datadog, Dynatrace, Elastic APM, Splunk, AppDynamics | 6        | Implemented |

See [Error Tracking Providers](./error-tracking-providers.md) for exact peer dependencies, capabilities, and limitations.

## OpenTelemetry Exporters & Instrumentation

| Signal  | Integration                 | Package                                                                                                        | Status      |
| ------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------- |
| Traces  | OTLP/HTTP Exporter          | [`@aldok10/nestjs-observe-tracing-exporter-otlp`](../../packages/traces/exporter-otlp/README.md)               | Implemented |
| Traces  | Console Exporter            | [`@aldok10/nestjs-observe-tracing-exporter-console`](../../packages/traces/exporter-console/README.md)         | Implemented |
| Traces  | HTTP Auto-Instrumentation   | [`@aldok10/nestjs-observe-tracing-instrumentation-http`](../../packages/traces/instrumentation-http/README.md) | Implemented |
| Traces  | DB / Redis / Queue / Worker | [`@aldok10/nestjs-observe-tracing-instrumentation-data`](../../packages/traces/instrumentation-data/README.md) | Implemented |
| Metrics | Prometheus Reader & Text    | [`@aldok10/nestjs-observe-metrics-exporter-prometheus`](../../packages/metrics/exporter-prometheus/README.md)  | Implemented |
| Metrics | OTLP/HTTP Exporter          | [`@aldok10/nestjs-observe-metrics-exporter-otlp`](../../packages/metrics/exporter-otlp/README.md)              | Implemented |
| Metrics | Console Exporter            | [`@aldok10/nestjs-observe-metrics-exporter-console`](../../packages/metrics/exporter-console/README.md)        | Implemented |
| Metrics | HTTP / Runtime / Data       | [`@aldok10/nestjs-observe-metrics-instrumentation`](../../packages/metrics/instrumentation/README.md)          | Implemented |
