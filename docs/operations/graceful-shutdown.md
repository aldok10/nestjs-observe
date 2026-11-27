# Graceful Shutdown

`nestjs-observe` coordinates initialization, flushing, and teardown across logging, tracing, metrics, and error tracking so telemetry buffers drain before process exit without hanging indefinitely.

## `LifecycleCoordinator`

[`LifecycleCoordinator`](../../packages/core/src/lifecycle/lifecycle-coordinator.ts) in `@aldok10/nestjs-observe-core` manages an ordered list of `LifecycleParticipant` instances:

- **Ordered initialization (`initializeAll()`)**: Participants initialize sequentially in registration order. In [`ObserverRuntime`](../../packages/observer/observer/src/observer.runtime.ts), domains are registered in this order:
  1. `tracing` (`TracingRuntime`)
  2. `metrics` (`MetricsRuntime`)
  3. `logger` (wrapping `LogPipeline.flush` and `LogPipeline.close`)
  4. `errorTracking` (`ErrorTrackingRuntime`)
- **Rollback on init failure**: If any participant throws during `initialize()`, `LifecycleCoordinator` shuts down already-initialized participants in reverse order before rethrowing.
- **Idempotent shutdown (`shutdown(timeoutMs?)`)**: Repeated calls to `shutdown()` return the same in-flight `Promise` (`shutdownInFlight`).
- **Flush before shutdown**: `teardown()` calls `flush(timeoutMs)` across all participants first, then calls `shutdown(timeoutMs)` in reverse registration order.
- **Failure aggregation**: If any participant rejects during `shutdownParticipants()`, `LifecycleCoordinator` throws `ShutdownException` listing each failed participant name and error message.

## Bounded Timeouts

[`BoundedExecution`](../../packages/core/src/lifecycle/bounded-execution.ts) wraps `Promise` work with `Promise.race` against an `AbortController`-backed timer (`unref()`ed so it does not keep the Node.js event loop alive):

- `LifecycleCoordinator.flush(timeoutMs)` catches timeout rejections so a stalled exporter does not block subsequent shutdown steps.
- `LifecycleCoordinator.shutdownParticipants()` bounds `Promise.allSettled(jobs)` with `timeoutMs` so teardown cannot hang past the configured budget.
- [`BufferedRemoteTransport`](../../packages/logs/delivery/src/buffered-remote.transport.ts) defaults `flush(timeoutMs)` to `5000` ms (`DEFAULT_FLUSH_TIMEOUT_MS`), clears its interval timer, aborts in-flight retry delays, and sets `forceDrain = true` on `close()`.

Configure the default timeout at the observer or runtime level via `shutdownTimeoutMs`:

```ts
import { ObserverModule } from '@aldok10/nestjs-observe';

ObserverModule.forRoot({
  shutdownTimeoutMs: 5000,
  tracing: { enabled: true },
  metrics: { enabled: true },
  logger: { enabled: true },
});
```

## NestJS Lifecycle Hooks & Signal Handling

Each NestJS module (`ObserverModule`, `LoggerModule`, `TracingModule`, `MetricsModule`, `ErrorTrackingModule`) registers a lifecycle service (`ObserverLifecycleService`, `LifecycleService`, `TracingLifecycleService`, `MetricsLifecycleService`, `ErrorTrackingLifecycleService`) implementing `OnModuleDestroy` and `OnApplicationShutdown`.

- Calling `app.enableShutdownHooks()` in your NestJS bootstrap allows NestJS to intercept `SIGTERM` / `SIGINT` and invoke `onModuleDestroy` and `onApplicationShutdown`.
- Each lifecycle service deduplicates `onModuleDestroy` and `onApplicationShutdown` using a shared `shutdownPromise` so `shutdown()` runs once.
- For standalone (non-NestJS) scripts or workers, call `await runtime.shutdown()` explicitly before exiting, or wire `SIGTERM` / `SIGINT` handlers to `runtime.shutdown()`.

## Resource Cleanup Summary

| Component                                 | Cleanup Action on `shutdown()`                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `TracingRuntime`                          | Flushes `TracerProvider` span processors and disables `AsyncLocalStorageContextManager`.                 |
| `MetricsRuntime`                          | Flushes `MeterProvider` metric readers and shuts down the provider.                                      |
| `LogPipeline` / `BufferedRemoteTransport` | Clears flush interval, aborts pending retry backoff timers, drains queued batches up to `flush` timeout. |
| `ErrorTrackingRuntime`                    | Flushes pending error events and closes the configured adapter.                                          |
