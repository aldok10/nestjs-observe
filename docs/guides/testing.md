# Testing

All five domains ship dedicated in-memory `*-testing` packages so unit and integration tests run with zero disk or network I/O in Vitest or Jest.

| Package                                                                                                    | Primary Export                                         | Purpose                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [`@aldok10/nestjs-observe-logger-testing`](../../packages/logs/testing/README.md)                          | `CaptureTransport`                                     | Captures emitted `LogRecord`s in `records: LogRecord[]`.                                               |
| [`@aldok10/nestjs-observe-tracing-testing`](../../packages/traces/testing/README.md)                       | `InMemoryTracingHarness`                               | Wires `TracingRuntime` + `ObserveTracer` to `InMemorySpanExporter` and `SimpleSpanProcessor`.          |
| [`@aldok10/nestjs-observe-metrics-testing`](../../packages/metrics/testing/README.md)                      | `InMemoryMetricsHarness`                               | Wires `MetricsRuntime` + `ObserveMetrics` to an in-memory pull `MetricReader`.                         |
| [`@aldok10/nestjs-observe-error-tracking-testing`](../../packages/traces/error-tracking/testing/README.md) | `MemoryErrorTrackingAdapter`, `createTestErrorTracker` | Captures `ObserveErrorEvent`s in `adapter.events` and simulates failures via `setFailOnCapture(true)`. |
| [`@aldok10/nestjs-observe-testing`](../../packages/observer/testing/README.md)                             | `ObserverTestHarness`                                  | Composes `ObserverRuntime` with in-memory log, span, and metric capture.                               |

## 1. Testing Logs (`@aldok10/nestjs-observe-logger-testing`)

Pass `CaptureTransport` into `LogPipeline` or `ObserveLoggerModule.forRoot({ transports: [capture] })`:

```ts
import { describe, expect, it } from 'vitest';
import { LogPipeline, createLogRecord } from '@aldok10/nestjs-observe-logger-core';
import { CaptureTransport } from '@aldok10/nestjs-observe-logger-testing';

describe('LogPipeline', () => {
  it('captures structured log records', async () => {
    const capture = new CaptureTransport('test');
    const pipeline = new LogPipeline({ transports: [capture] });

    await pipeline.emit(createLogRecord({ level: 'info', message: 'order created' }));

    expect(capture.records).toHaveLength(1);
    expect(capture.records[0]?.message).toBe('order created');
  });
});
```

## 2. Testing Traces (`@aldok10/nestjs-observe-tracing-testing`)

Always call `await harness.shutdown()` in `afterEach` (or pass `{ registerGlobal: false }`) to reset global OpenTelemetry providers between tests:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryTracingHarness } from '@aldok10/nestjs-observe-tracing-testing';

describe('Orders tracing', () => {
  let harness: InMemoryTracingHarness | undefined;

  afterEach(async () => {
    await harness?.shutdown();
    harness = undefined;
  });

  it('records order.create span', async () => {
    harness = new InMemoryTracingHarness({ resource: { serviceName: 'orders-test' } });
    await harness.tracer.withSpan('order.create', async () => 'ok');

    expect(harness.getSpans().map((s) => s.name)).toEqual(['order.create']);
  });
});
```

## 3. Testing Metrics (`@aldok10/nestjs-observe-metrics-testing`)

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryMetricsHarness } from '@aldok10/nestjs-observe-metrics-testing';

describe('Jobs metrics', () => {
  let harness: InMemoryMetricsHarness | undefined;

  afterEach(async () => {
    await harness?.shutdown();
    harness = undefined;
  });

  it('records jobs.completed counter', async () => {
    harness = new InMemoryMetricsHarness({ resource: { serviceName: 'jobs-test' } });
    harness.metrics.counter('jobs.completed').add(4, { queue: 'default' });

    const metric = await harness.findMetric('jobs.completed');
    expect(metric?.dataPoints[0]?.value).toBe(4);
  });
});
```

## 4. Testing Error Tracking (`@aldok10/nestjs-observe-error-tracking-testing`)

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createTestErrorTracker } from '@aldok10/nestjs-observe-error-tracking-testing';

describe('Error tracking', () => {
  it('captures exceptions and simulates failures', async () => {
    const { adapter, runtime, tracker } = createTestErrorTracker({
      delivery: { maxRetries: 0 },
    });

    await runtime.initialize();
    await tracker.captureException(new Error('test failure'));
    expect(adapter.events).toHaveLength(1);

    adapter.clear();
    adapter.setFailOnCapture(true);
    await tracker.captureException(new Error('boom'));

    const diagnostics = await tracker.getDiagnostics();
    expect(diagnostics.status).toBe('unhealthy');

    await runtime.shutdown();
  });
});
```

## 5. Testing Combined Signals (`@aldok10/nestjs-observe-testing`)

`ObserverTestHarness.create()` enables `logger`, `tracing`, and `metrics` on `ObserverRuntime`, so `@aldok10/nestjs-observe-logger`, `@aldok10/nestjs-observe-tracing`, and `@aldok10/nestjs-observe-metrics` must be installed in the test environment.

```ts
import { describe, expect, it } from 'vitest';
import { ObserverTestHarness } from '@aldok10/nestjs-observe-testing';

describe('checkout observability', () => {
  it('captures correlated logs, spans, and metrics in memory', async () => {
    const harness = await ObserverTestHarness.create({
      resource: { serviceName: 'checkout-test' },
    });

    await harness.runtime.tracer?.withSpan('checkout.run', async (span) => {
      harness.runtime.logger?.info('started');
      const expected = span.spanContext();
      expect(harness.logs.records).toHaveLength(1);
      expect(harness.logs.records[0]?.traceId).toBe(expected.traceId);
    });

    expect(harness.getSpans()).toHaveLength(1);
    await harness.shutdown();
  });
});
```
