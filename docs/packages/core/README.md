# Core Package (1 Package)

Back to [Packages Overview](../README.md).

`@aldok10/nestjs-observe-core` is the domain-neutral foundation shared across the `nestjs-observe` ecosystem. It has zero external runtime dependencies and uses only Node.js built-in modules (`node:async_hooks`, `node:module`, `node:timers/promises`).

## Package

| Package                        | Directory       | Responsibility                                                                                                                                    | README                                     |
| ------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `@aldok10/nestjs-observe-core` | `packages/core` | Resource metadata, lifecycle coordination, bounded execution, async context store, diagnostics sinks, typed exceptions, and optional peer loading | [README](../../../packages/core/README.md) |

## Cross-Package Role

- **Direct dependents**: `@aldok10/nestjs-observe-tracing`, `@aldok10/nestjs-observe-metrics`, `@aldok10/nestjs-observe-error-tracking` (and its 16 adapters), `@aldok10/nestjs-observe`, and the tracing/metrics testing and instrumentation packages.
- **Note on logging**: `@aldok10/nestjs-observe-logger-core` is independently zero-dependency and does not depend on `@aldok10/nestjs-observe-core`. `@aldok10/nestjs-observe` bridges the two when composing the logger pillar.

## Subpath Entry Points

| Subpath         | Responsibility                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `.`             | Full public API                                                                                          |
| `./resource`    | `ResourceMetadata`, `createResourceMetadata`, `mergeResourceMetadata`, `toSemanticResourceAttributes`    |
| `./lifecycle`   | `LifecycleCoordinator`, `LifecycleParticipant`, `ComponentHealth`, `BoundedExecution`, `withTimeout`     |
| `./context`     | `ObserveContextStore` (`AsyncLocalStorage`-backed context merging)                                       |
| `./diagnostics` | `DiagnosticsSink`, `NoopDiagnosticsSink`, `StderrDiagnosticsSink`                                        |
| `./exceptions`  | `ObserveException`, `InvalidConfigurationException`, `OptionalPeerMissingException`, `ShutdownException` |
| `./peers`       | `OptionalPeerLoader`, `loadOptionalPeer`, `tryLoadOptionalPeer`                                          |
