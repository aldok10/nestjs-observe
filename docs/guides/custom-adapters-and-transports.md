# Custom Adapters and Transports

`nestjs-observe` exposes typed contracts so you can integrate custom logging backends, log transports, buffered HTTP endpoints, and error tracking providers without modifying core packages.

## Implementing `LoggerAdapter`

[`@aldok10/nestjs-observe-logger-core`](../../packages/logs/core/README.md) defines `LoggerAdapter<TLogger>`:

```ts
import type {
  AdapterCapabilities,
  LogContext,
  LoggerAdapter,
  LoggerAdapterOptions,
  UniversalLogger,
} from '@aldok10/nestjs-observe-logger-core';

export interface MyBackendLike {
  emit(level: string, message: string, meta?: Record<string, unknown>): void;
}

export class MyLoggerAdapter implements LoggerAdapter<MyBackendLike> {
  readonly name = 'my-backend';
  readonly capabilities: Partial<AdapterCapabilities> = {
    structuredMetadata: true,
    childLoggers: false,
    contextBinding: true,
    dynamicLogLevels: false,
    nativeTransports: true,
    redaction: false,
    serialization: false,
    flush: false,
    gracefulShutdown: false,
  };

  create(logger: MyBackendLike, options: LoggerAdapterOptions): UniversalLogger {
    const emit = (level: string, message: string, context?: LogContext) => {
      logger.emit(level, message, { ...options.context, ...context });
    };

    return {
      trace: (msg, ctx) => emit('trace', msg, ctx),
      debug: (msg, ctx) => emit('debug', msg, ctx),
      verbose: (msg, ctx) => emit('verbose', msg, ctx),
      info: (msg, ctx) => emit('info', msg, ctx),
      log: (msg, ctx) => emit('info', msg, ctx),
      warn: (msg, ctx) => emit('warn', msg, ctx),
      error: (msg, ctx) => emit('error', msg, ctx),
      fatal: (msg, ctx) => emit('fatal', msg, ctx),
    };
  }
}
```

Register custom adapters in `ObserveLoggerModule.forRoot({ adapters: [new MyLoggerAdapter()], backend: { type: 'my-backend', logger: myBackendInstance } })`.

## Implementing `LogTransport`

`LogTransport` requires `name` and `write(record)`, with optional `flush(timeoutMs?)`, `health()`, and `close()`:

```ts
import type { LogRecord, LogTransport, TransportHealth } from '@aldok10/nestjs-observe-logger-core';

export class WebhookTransport implements LogTransport {
  readonly name = 'webhook';
  private sent = 0;
  private failed = 0;

  constructor(private readonly send: (record: LogRecord) => Promise<void>) {}

  async write(record: LogRecord): Promise<void> {
    try {
      await this.send(record);
      this.sent += 1;
    } catch {
      this.failed += 1;
    }
  }

  health(): TransportHealth {
    return {
      name: this.name,
      status: this.failed > 0 ? 'degraded' : 'healthy',
      healthy: this.failed === 0,
      queued: 0,
      capacity: 0,
      dropped: 0,
      sent: this.sent,
      failed: this.failed,
    };
  }

  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}
```

See also the working example in [`examples/custom-transport`](../../examples/custom-transport/README.md).

## Subclassing `BufferedRemoteTransport`

For HTTP-based remote log destinations, extend `BufferedRemoteTransport` from [`@aldok10/nestjs-observe-logger-delivery`](../../packages/logs/delivery/README.md). It provides bounded queuing (`queueCapacity`, `overflow`), batching (`batchSize`, `flushIntervalMs`), timeouts (`timeoutMs`), jittered exponential retries (`maxRetries`, `baseDelayMs`), a circuit breaker, `health()`, `flush()`, and `close()`.

Subclasses only implement `buildPayload(batch: readonly string[]): RemotePayload`:

```ts
import {
  BufferedRemoteTransport,
  joinEndpoint,
  parseRecordFields,
  type RemotePayload,
} from '@aldok10/nestjs-observe-logger-delivery';

export class CustomJsonTransport extends BufferedRemoteTransport {
  constructor(baseUrl: string) {
    super({
      name: 'custom-json',
      endpoint: joinEndpoint(baseUrl, '/ingest'),
      batchSize: 50,
      flushIntervalMs: 1000,
      queueCapacity: 1000,
      overflow: 'drop-oldest',
    });
  }

  protected buildPayload(batch: readonly string[]): RemotePayload {
    return {
      body: JSON.stringify(batch.map((line) => parseRecordFields(line))),
      headers: { 'Content-Type': 'application/json' },
    };
  }
}
```

`parseRecordFields(line)` parses JSON lines and applies `RedactionEngine` sanitization before serialization.

## Implementing `ErrorTrackingAdapter`

[`@aldok10/nestjs-observe-error-tracking`](../../packages/traces/error-tracking/error-tracking/README.md) defines `ErrorTrackingAdapter`:

```ts
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export class CustomErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'custom-error-sink';
  readonly capabilities: ErrorAdapterCapabilities = {
    exceptions: true,
    messages: true,
    breadcrumbs: false,
    fingerprinting: false,
    tags: true,
    userContext: false,
    traceCorrelation: true,
    transactions: false,
    sessions: false,
    profiling: false,
    deliveryMode: 'core-managed',
  };

  async capture(event: ObserveErrorEvent, signal?: AbortSignal): Promise<void> {
    await fetch('https://errors.example.com/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal,
    });
  }
}
```

Set `deliveryMode: 'core-managed'` to let `ErrorTrackingRuntime` manage bounded queuing, concurrency, timeouts, and retries, or `'sdk-managed'` when delegating buffering and retries to a vendor SDK.
