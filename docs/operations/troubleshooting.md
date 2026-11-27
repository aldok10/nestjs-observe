# Troubleshooting

## `OptionalPeerMissingException` at Runtime

**Symptom**: `ObserverRuntime.initialize()` or an adapter loader throws `OptionalPeerMissingException`.

**Cause**: [`OptionalPeerLoader`](../../packages/core/src/peers/optional-peer.loader.ts) resolves optional domain packages (`@aldok10/nestjs-observe-tracing`, `@aldok10/nestjs-observe-metrics`, `@aldok10/nestjs-observe-logger`, `@aldok10/nestjs-observe-logger/transports`, `@aldok10/nestjs-observe-error-tracking`) and backend peers (`pino`, `winston`, `bunyan`, `log4js`) dynamically via `createRequire`.

**Fix**:

- Install the peer package for every enabled domain (for example, `pnpm add @aldok10/nestjs-observe-tracing` when `tracing: true` is set).
- If `logger` is enabled in `ObserverOptions` without custom `transports`, ensure `@aldok10/nestjs-observe-logger/transports` is resolvable so `ConsoleTransport` can load.

## OpenTelemetry Bootstrap Order & Missing Trace Correlation

**Symptom**: Logs or errors do not contain `traceId` / `spanId`, or HTTP/data auto-instrumentations miss early requests.

**Cause**:

- `TracingRuntime.initialize()` sets the global `AsyncLocalStorageContextManager` and `TracerProvider` (when `registerGlobal !== false`). If `ObserverRuntime` or `TracingRuntime` initializes after instrumentations or requests start, or if `registerGlobal: false` is set, active span context is unavailable.
- In `ObserverRuntime.initialize()`, tracing is initialized first, and its `ObserveTracer.getTraceContext()` is wired into `LogContextStore` and `createTraceContextEnricher`.

**Fix**:

- Initialize `TracingRuntime` / `ObserverModule` before registering routes or starting background workers.
- Keep `registerGlobal: true` (default) when using `@Trace()`, `TracingInterceptor`, or automatic log/error trace correlation.

## High-Cardinality Metric Attributes Stripped or Replaced

**Symptom**: Attributes like `userId`, `requestId`, `traceId`, `email`, or `ip` are missing from exported metrics, or values appear as `'__overflow__'`.

**Cause**: [`CardinalityGuard`](../../packages/metrics/metrics/src/cardinality-guard.ts) strips `DEFAULT_FORBIDDEN_KEYS` by default and caps each remaining key at `100` distinct values (`maxDistinctValuesPerKey`).

**Fix**:

- Keep high-cardinality identifiers in logs or trace spans rather than metric labels.
- Adjust `MetricsOptions.cardinality` (`maxDistinctValuesPerKey`, `forbiddenKeys`, `overflowValue`) only when a bounded label set genuinely exceeds `100` values.

## NestJS DI Tokens Resolve to `undefined` or Fail Injection

**Symptom**: `@Inject(OBSERVE_LOGGER)` (or `OBSERVE_TRACER`, `OBSERVE_METRICS`, `OBSERVE_ERROR_TRACKER`) injects `undefined`, or NestJS cannot resolve a token across modules.

**Cause & Fix**:

- In `ObserverModule`, domain tokens (`OBSERVE_LOGGER`, `OBSERVE_TRACER`, `OBSERVE_METRICS`, `OBSERVE_ERROR_TRACKER` in [`observer.module.ts`](../../packages/observer/observer/src/observer.module.ts)) resolve to `undefined` if that domain was not enabled in `ObserverOptions`.
- Note the distinct token namespaces:
  - `@aldok10/nestjs-observe`: `OBSERVER_OPTIONS`, `OBSERVER_RUNTIME`, `OBSERVER_CONTEXT`, `OBSERVE_LOGGER`, `OBSERVE_TRACER`, `OBSERVE_METRICS`, `OBSERVE_ERROR_TRACKER`
  - `@aldok10/nestjs-observe-logger`: `OBSERVE_LOGGER` (`Symbol.for('cisea.logger.OBSERVE_LOGGER')`), `LOGGER_OPTIONS`, `LOGGER_MANAGER` (`Symbol.for('cisea.channels.LOGGER_MANAGER')`)
  - `@aldok10/nestjs-observe-tracing`: `TRACING_OPTIONS`, `TRACING_RUNTIME`
  - `@aldok10/nestjs-observe-metrics`: `METRICS_OPTIONS`, `METRICS_RUNTIME`
  - `@aldok10/nestjs-observe-error-tracking`: `ERROR_TRACKING_OPTIONS`
- If `global: false` is passed to `forRoot()` / `forRootAsync()`, import the module in every feature module that injects its providers.

## Logger Adapter & Runtime Limitations

- **Pino, Winston, Bunyan, Log4js adapters**: `dynamicLogLevels`, `flush`, and `gracefulShutdown` are `false` in their adapter capabilities (`PINO_ADAPTER_CAPABILITIES`, `WINSTON_ADAPTER_CAPABILITIES`, `BUNYAN_ADAPTER_CAPABILITIES`, `LOG4JS_ADAPTER_CAPABILITIES`). See each adapter README (e.g., [Pino](../../packages/logs/adapter-pino/README.md), [Winston](../../packages/logs/adapter-winston/README.md), [Bunyan](../../packages/logs/adapter-bunyan/README.md), [Log4js](../../packages/logs/adapter-log4js/README.md)).
- **Log4js child loggers**: `childLoggers` is `false` in `LOG4JS_ADAPTER_CAPABILITIES`; child context is merged in the adapter bridge rather than via a native Log4js `child()` logger.
- **External backend `ownership` with `sink`**: When `sink` is configured on Pino, Winston, Bunyan, or Log4js adapters, `ownership` defaults to `'package'`. Set `ownership: 'both'` to forward logs to both `sink` and the underlying backend.
- **`ObserverRuntime.loggerManager`**: Declared as a getter on [`ObserverRuntime`](../../packages/observer/observer/src/observer.runtime.ts), but not populated during `initialize()` (returns `undefined`); use `runtime.logger` instead.
