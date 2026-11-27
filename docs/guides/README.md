# Guides

Practical guides for adopting, extending, combining, testing, and migrating to `nestjs-observe`.

| Guide                                                                 | Summary                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [Getting Started](./getting-started.md)                               | Choosing between standalone pillar packages and `ObserverModule`, plus minimal NestJS and Node.js bootstraps.                        |
| [Custom Adapters and Transports](./custom-adapters-and-transports.md) | Implementing `LoggerAdapter`, `LogTransport`, `BufferedRemoteTransport`, and `ErrorTrackingAdapter`.                                 |
| [Combining Signals](./combining-signals.md)                           | Wiring Logs, Traces, Metrics, and Error Tracking together via `ObserverModule` and `@aldok10/nestjs-observe-error-tracking/bridges`. |
| [Testing](./testing.md)                                               | Zero-I/O unit and integration testing using all five `*-testing` packages in Vitest or Jest.                                         |
| [Migration](./migration.md)                                           | Migrating from NestJS built-in `Logger`, `nestjs-pino`, `winston`, and legacy `@aldok10/nestjs-logger*` names.                       |
