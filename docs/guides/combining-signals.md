# Combining Signals

You can combine **Logs**, **Traces**, **Metrics**, and **Error Tracking** either through [`@aldok10/nestjs-observe`](../../packages/observer/observer/README.md) (`ObserverModule` / `ObserverRuntime`) or by wiring standalone signals with [`@aldok10/nestjs-observe-error-tracking/bridges`](../../packages/traces/error-tracking/error-tracking/README.md).

## Unified Composition via `ObserverModule`

`ObserverModule` composes enabled pillars using optional peer dependencies:

1. Disabled pillars are never loaded or initialized.
2. Shared `resource`, `shutdownTimeoutMs`, and `diagnostics` are forwarded to each enabled domain.
3. `ObserverRuntime` initializes domains in order: **Tracing** -> **Metrics** -> **Logger** -> **Error Tracking**.
4. When `tracing` is enabled alongside `logger` or `errorTracking`, active span `traceId` and `spanId` are automatically injected into log records and captured error events.
5. `ObserverLifecycleService` coordinates flush and shutdown on NestJS `OnModuleDestroy` / `OnApplicationShutdown`.

```ts
import { Injectable, Module } from '@nestjs/common';
import { ObserverModule, ObserverService } from '@aldok10/nestjs-observe';
import { createOtlpTraceSpanProcessor } from '@aldok10/nestjs-observe-tracing-exporter-otlp';
import { createOtlpMetricReader } from '@aldok10/nestjs-observe-metrics-exporter-otlp';
import { OtlpLogTransport } from '@aldok10/nestjs-observe-logger-transports/otlp';
import { createOtlpErrorAdapter } from '@aldok10/nestjs-observe-error-tracking-otlp';

@Injectable()
export class OrdersService {
  constructor(private readonly observer: ObserverService) {}

  async createOrder(orderId: string): Promise<void> {
    await this.observer.tracer?.withSpan('orders.create', async () => {
      // Log record automatically includes active traceId and spanId
      this.observer.logger?.info('Creating order', { metadata: { orderId } });
      this.observer.metrics?.counter('orders.created').add(1);

      try {
        // ...
      } catch (error) {
        // Error event automatically enriched with active trace context
        await this.observer.errorTracker?.captureException(error, {
          tags: { orderId },
        });
        throw error;
      }
    });
  }
}

@Module({
  imports: [
    ObserverModule.forRoot({
      resource: { serviceName: 'orders-api', environment: 'production' },
      logger: {
        enabled: true,
        transports: [new OtlpLogTransport({ endpoint: 'http://localhost:4318' })],
      },
      tracing: {
        enabled: true,
        spanProcessors: [createOtlpTraceSpanProcessor({ url: 'http://localhost:4318/v1/traces' })],
      },
      metrics: {
        enabled: true,
        readers: [createOtlpMetricReader({ url: 'http://localhost:4318/v1/metrics' })],
      },
      errorTracking: {
        enabled: true,
        destinations: [
          {
            name: 'otlp',
            adapter: createOtlpErrorAdapter({ endpoint: 'http://localhost:4318' }),
          },
        ],
      },
    }),
  ],
  providers: [OrdersService],
})
export class AppModule {}
```

You can also inject individual signal tokens directly (`OBSERVE_LOGGER`, `OBSERVE_TRACER`, `OBSERVE_METRICS`, `OBSERVE_ERROR_TRACKER`, `OBSERVER_CONTEXT`) instead of `ObserverService`.

## Standalone Bridges (`@aldok10/nestjs-observe-error-tracking/bridges`)

When using standalone packages without `ObserverModule`, `@aldok10/nestjs-observe-error-tracking/bridges` provides two bridges:

### Log-to-Error-Tracking Bridge (`createErrorTrackingLogTransport`)

Creates a `LogTransport`-compatible object (`name: 'error-tracking-bridge'`) that forwards log records meeting `minSeverity` (default `'error'`) to `ObserveErrorTracker`. Supports `channels` and `excludeChannels` filters, reconstructs `Error` instances when `record.error` is present, and preserves `traceId`, `spanId`, `requestId`, `correlationId`, and `tenantId`.

```ts
import { createLoggerManager } from '@aldok10/nestjs-observe-logger-core';
import { ConsoleTransport } from '@aldok10/nestjs-observe-logger-transports/console';
import { ErrorTrackingRuntime, ObserveErrorTracker } from '@aldok10/nestjs-observe-error-tracking';
import { createErrorTrackingLogTransport } from '@aldok10/nestjs-observe-error-tracking/bridges';

const errorRuntime = new ErrorTrackingRuntime({ destinations: [/* ... */] });
await errorRuntime.initialize();
const tracker = new ObserveErrorTracker(errorRuntime);

const manager = createLoggerManager({
  channels: [
    {
      name: 'app',
      level: 'info',
      transports: [
        new ConsoleTransport(),
        createErrorTrackingLogTransport(tracker, {
          minSeverity: 'error',
          excludeChannels: ['health'],
        }),
      ],
    },
  ],
  defaultChannel: 'app',
});
```

### Tracing-to-Error-Tracking Bridge (`createTracingErrorBridge`)

Records an exception on an OpenTelemetry span (`recordException`, `setStatus({ code: 2, message })`) and forwards the error plus `span.spanContext()` (`traceId`, `spanId`, `traceFlags`) to `ObserveErrorTracker.captureException()`:

```ts
import { createTracingErrorBridge } from '@aldok10/nestjs-observe-error-tracking/bridges';

const bridge = createTracingErrorBridge(tracker);

await tracer.withSpan('billing.charge', async (span) => {
  try {
    // ...
  } catch (error) {
    await bridge.recordAndCaptureException(span, error, {
      source: { component: 'BillingService', operation: 'charge' },
    });
    throw error;
  }
});
```
