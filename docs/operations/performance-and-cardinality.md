# Performance & Cardinality

## Metric Cardinality Protection (`CardinalityGuard`)

Unbounded metric attribute values (such as user IDs, request IDs, or IP addresses) cause time-series explosion in metric backends. [`CardinalityGuard`](../../packages/metrics/metrics/src/cardinality-guard.ts) in `@aldok10/nestjs-observe-metrics` sanitizes metric attributes before recording:

- **Default forbidden keys** (`DEFAULT_FORBIDDEN_KEYS` — stripped completely):
  `userId`, `user_id`, `requestId`, `request_id`, `correlationId`, `correlation_id`, `traceId`, `trace_id`, `spanId`, `span_id`, `sessionId`, `session_id`, `email`, `ip`, `clientIp`, `client_ip`.
- **Distinct value cap**: Tracks up to `maxDistinctValuesPerKey` distinct serialized values per attribute key (default: `100`).
- **Overflow replacement**: Once a key reaches `maxDistinctValuesPerKey`, new unseen values are replaced with `overflowValue` (default: `'__overflow__'`).

Configure `CardinalityGuardOptions` via `MetricsOptions.cardinality` or `ObserverMetricsConfig.cardinality`:

```ts
MetricsModule.forRoot({
  cardinality: {
    maxDistinctValuesPerKey: 50,
    overflowValue: '__other__',
    forbiddenKeys: ['userId', 'sessionId', 'tenantSlug'],
  },
});
```

## Log & Trace Sampling

### Log Filtering & Sampling

`@aldok10/nestjs-observe-logger-filtering` ([`packages/logs/filtering/src/index.ts`](../../packages/logs/filtering/src/index.ts)) provides composable filters:

- `levelAtLeast(minimum)` and `excludeLevels(levels)` to drop noisy debug/trace logs in production.
- `sample(rate)` for probabilistic sampling (`rate <= 0` drops all, `rate >= 1` keeps all, otherwise `Math.random() < rate`).
- `channelFilter({ include, exclude })`, `byContext(predicate)`, and `composeFilters(...filters)`.

### Trace Sampling

`TracingRuntime` ([`packages/traces/tracing/src/tracing.runtime.ts`](../../packages/traces/tracing/src/tracing.runtime.ts)) defaults to `ParentBasedSampler({ root: new AlwaysOnSampler() })`. For high-throughput services, configure ratio-based sampling:

```ts
TracingModule.forRoot({
  sampler: { strategy: 'ratio', ratio: 0.1, parentBased: true },
});
```

## Buffered Delivery Queues & Circuit Breaker

Remote log transports extend [`BufferedRemoteTransport`](../../packages/logs/delivery/src/buffered-remote.transport.ts) in `@aldok10/nestjs-observe-logger-delivery`.

### Default Queue & Retry Settings

| Option            | Default         | Description                                                                            |
| ----------------- | --------------- | -------------------------------------------------------------------------------------- |
| `batchSize`       | `100`           | Maximum log lines per HTTP `POST` batch.                                               |
| `flushIntervalMs` | `1000`          | Periodic drain interval (timer is `.unref()`ed).                                       |
| `queueCapacity`   | `1000`          | Maximum queued log lines before overflow policy triggers.                              |
| `overflow`        | `'drop-oldest'` | Policy when queue reaches `queueCapacity`.                                             |
| `maxRetries`      | `3`             | Retry attempts for network errors, HTTP `408`, HTTP `429`, and `>= 500` responses.     |
| `baseDelayMs`     | `100`           | Exponential backoff base (`baseDelayMs * 2^attempt * jitter`, jitter in `[0.5, 1.0)`). |
| `timeoutMs`       | `5000`          | Per-request `AbortSignal.timeout` duration.                                            |

### Overflow Policies

- `'drop-oldest'` (default): Evicts the oldest queued entry, increments `dropped`, invokes `onError`, and enqueues the new line.
- `'drop-newest'`: Drops the incoming line, increments `dropped`, and invokes `onError`.
- `'block'`: Defers enqueueing by `50` ms (`DEFER_ENQUEUE_DELAY_MS`) via an `.unref()`ed timer; drops if still full or shutting down.
- `'fail'`: Increments `dropped`, invokes `onError`, and throws the overflow `Error` synchronously from `write()`.

### Circuit Breaker & Dead-Letter Hook

- **Circuit breaker**: After `5` consecutive permanent batch failures (`CIRCUIT_FAILURE_THRESHOLD`), the transport enters a `30_000` ms cooldown (`CIRCUIT_COOLDOWN_MS`), during which `health().status` reports `'down'` and scheduled drains pause (unless `close()` sets `forceDrain = true`).
- **Dead-letter callback**: Supply `onDeadLetter(batch, error)` to persist or inspect permanently failed batches.

## Benchmarking

Run the in-process throughput microbenchmark after building:

```sh
pnpm run build
pnpm run bench
```

[`benchmarks/log-throughput.mjs`](../../benchmarks/log-throughput.mjs) measures `LogPipeline` (including `RedactionEngine` sanitization) into an in-memory `JsonLogFormatter` transport across `3` rounds of `100_000` iterations (after `10_000` warmup emits). Use `--iterations=<n>` to adjust iteration count or `--json` for machine-readable output. Note that this is an in-process microbenchmark with no network or remote transport I/O.
