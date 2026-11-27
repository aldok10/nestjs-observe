# Architecture Overview

`nestjs-observe` is a pnpm workspace monorepo with standalone observability pillars and an optional composition layer.

## Design Principles

- **Standalone by default**: logs, traces, metrics, and error tracking can be used independently. Pillars do not depend on each other at runtime.
- **Integrated by composition**: `@aldok10/nestjs-observe` composes enabled pillars through optional peers and shared core contracts.
- **Bounded boundaries**: package dependencies and naming rules are enforced by `scripts/check-architecture.mjs`.

## Layers

| Layer          | Location                           | Responsibility                                                                                                        |
| -------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Core           | `packages/core`                    | Resource metadata, lifecycle coordination, bounded execution, context, diagnostics, exceptions, optional peer loading |
| Logs           | `packages/logs/*`                  | Logging runtime, adapters, transports, formatters, filtering, redaction, delivery, HTTP integration, testing          |
| Traces         | `packages/traces/*`                | Tracing runtime, OTLP/console exporters, HTTP/data instrumentation, testing                                           |
| Error tracking | `packages/traces/error-tracking/*` | Error capture/runtime, provider adapters, bridges, testing                                                            |
| Metrics        | `packages/metrics/*`               | Metrics runtime, exporters, instrumentation, testing                                                                  |
| Observer       | `packages/observer/*`              | NestJS composition, DI tokens, correlation, coordinated lifecycle, testing                                            |

## Cross-Pillar Composition

When `ObserverModule`/`ObserverRuntime` composes enabled pillars:

- Tracing can provide active span context for log and error correlation.
- Shared resource metadata is propagated to enabled pillars.
- Lifecycle coordination initializes and shuts down enabled runtimes in a deterministic, bounded way.

## Related

- [Package Structure](./package-structure.md)
- [Dependency Graph](./dependency-graph.md)
- [Lifecycle](./lifecycle.md)
