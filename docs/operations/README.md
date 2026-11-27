# Operations Documentation

This section covers runtime lifecycle management, performance tuning, security controls, and troubleshooting for `nestjs-observe` packages in production.

## Guides

| Document                                                    | Description                                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Graceful Shutdown](graceful-shutdown.md)                   | `LifecycleCoordinator`, bounded flush and shutdown timeouts, NestJS lifecycle hooks, and resource cleanup.                               |
| [Performance & Cardinality](performance-and-cardinality.md) | `CardinalityGuard`, log sampling, `BufferedRemoteTransport` queues, overflow policies, circuit breaker, and benchmarking.                |
| [Security & Redaction](security-and-redaction.md)           | `RedactionEngine`, `redactErrorEvent`, secret handling, header/URL sanitization, TLS endpoints, and CI production audits.                |
| [Troubleshooting](troubleshooting.md)                       | Diagnosing missing optional peers, OpenTelemetry bootstrap order, stripped metric attributes, NestJS DI tokens, and adapter limitations. |

## Related Package Documentation

- [`@aldok10/nestjs-observe`](../../packages/observer/observer/README.md)
- [`@aldok10/nestjs-observe-core`](../../packages/core/README.md)
- [`@aldok10/nestjs-observe-logger-delivery`](../../packages/logs/delivery/README.md)
- [`@aldok10/nestjs-observe-metrics`](../../packages/metrics/metrics/README.md)
- [`@aldok10/nestjs-observe-tracing`](../../packages/traces/tracing/README.md)
- [`@aldok10/nestjs-observe-error-tracking`](../../packages/traces/error-tracking/error-tracking/README.md)
