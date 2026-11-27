# NestJS Observe Documentation

`nestjs-observe` is a modular observability monorepo for NestJS and Node.js. It provides standalone packages for logs, traces, metrics, and error tracking, plus an optional observer package that composes enabled pillars.

## Capabilities

- **Logs**: structured logging, context, filtering, redaction, formatters, delivery, transports, backend adapters, and HTTP logging.
- **Traces**: OpenTelemetry-based tracing, exporters, and instrumentation.
- **Error tracking**: vendor-neutral capture, normalization, redaction, deduplication, and provider adapters.
- **Metrics**: OpenTelemetry metrics, exporters, instrumentation, and cardinality controls.
- **Observer**: optional composition layer with shared resource metadata, correlation, and coordinated lifecycle.

## Package Organization

| Group          | Path                               | Purpose                                                                       |
| -------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| Core           | `packages/core`                    | Shared lifecycle, context, diagnostics, resource, and peer-loading primitives |
| Logs           | `packages/logs/*`                  | Logger runtime, adapters, transports, and NestJS integration                  |
| Traces         | `packages/traces/*`                | Tracing runtime, exporters, and instrumentation                               |
| Error tracking | `packages/traces/error-tracking/*` | Error tracking runtime, adapters, and testing                                 |
| Metrics        | `packages/metrics/*`               | Metrics runtime, exporters, instrumentation, and testing                      |
| Observer       | `packages/observer/*`              | Unified composition and observer testing                                      |

## Documentation

- [Architecture](./architecture/README.md) - monorepo design, package boundaries, dependencies, and lifecycle.
- [Packages](./packages/README.md) - cross-package documentation and links to package READMEs.
- [Integrations](./integrations/README.md) - implemented provider/exporter/transport integrations.
- [Guides](./guides/README.md) - practical setup and extension guides.
- [Development](./development/README.md) - local workflow, quality gates, and publishing.
- [Operations](./operations/README.md) - shutdown, performance, security, and troubleshooting.

## Repository References

- [Root README](../README.md)
- [Contributing](../CONTRIBUTING.md)
- [Code Standards](../CODE_STANDARDS.md)
