# Getting Started

`nestjs-observe` targets Node.js `>=22`. NestJS integration packages support NestJS `^10.0.0 || ^11.0.0 || ^12.0.0`.

## Choose an Installation Model

| Model                | Use when                                               | Dependency behavior                                                                 |
| -------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Standalone pillar    | You need only logs, traces, metrics, or error tracking | Pillars are independent; install only the selected pillar packages                  |
| Observer composition | You want one NestJS entrypoint for multiple pillars    | `@aldok10/nestjs-observe` loads only enabled pillars via optional peer dependencies |

Disabled pillars are not loaded by `ObserverModule`.

## Standalone: Logger Only

```bash
pnpm add @aldok10/nestjs-observe-logger @nestjs/common @nestjs/core reflect-metadata
```

```ts
import { Inject, Injectable, Module } from '@nestjs/common';
import {
  OBSERVE_LOGGER,
  ObserveLoggerModule,
  type UniversalLogger,
} from '@aldok10/nestjs-observe-logger';

@Injectable()
class OrdersService {
  constructor(@Inject(OBSERVE_LOGGER) private readonly logger: UniversalLogger) {}

  createOrder(id: string): void {
    this.logger.info('Order created', { metadata: { id } });
  }
}

@Module({
  imports: [ObserveLoggerModule.forRoot({ level: 'info' })],
  providers: [OrdersService],
})
export class AppModule {}
```

For framework-independent Node.js logging, use `@aldok10/nestjs-observe-logger-core` and `@aldok10/nestjs-observe-logger-transports`.

## Standalone: Tracing Only

```bash
pnpm add @aldok10/nestjs-observe-tracing @opentelemetry/api @nestjs/common @nestjs/core reflect-metadata
```

Use `TracingModule.forRoot(...)` / `bootstrapTracing(...)` from `@aldok10/nestjs-observe-tracing`. See [Tracing package](../../packages/traces/tracing/README.md).

## Standalone: Error Tracking Only (Sentry)

```bash
pnpm add @aldok10/nestjs-observe-error-tracking @aldok10/nestjs-observe-error-tracking-sentry @sentry/node
```

```ts
import { Module } from '@nestjs/common';
import { ErrorTrackingModule } from '@aldok10/nestjs-observe-error-tracking';
import { createSentryAdapter } from '@aldok10/nestjs-observe-error-tracking-sentry';

@Module({
  imports: [
    ErrorTrackingModule.forRoot({
      resource: { serviceName: 'billing-api', environment: 'production' },
      destinations: [
        {
          name: 'sentry',
          adapter: createSentryAdapter({ dsn: process.env.SENTRY_DSN ?? '' }),
        },
      ],
    }),
  ],
})
export class AppModule {}
```

## Observer: Selected Pillars Only

Install `@aldok10/nestjs-observe` and only the enabled pillar packages. Example: tracing + Sentry error tracking, without logger or metrics.

```bash
pnpm add @aldok10/nestjs-observe @aldok10/nestjs-observe-tracing @aldok10/nestjs-observe-error-tracking @aldok10/nestjs-observe-error-tracking-sentry @opentelemetry/api @sentry/node @nestjs/common @nestjs/core reflect-metadata
```

```ts
import { Module } from '@nestjs/common';
import { ObserverModule } from '@aldok10/nestjs-observe';
import { createSentryAdapter } from '@aldok10/nestjs-observe-error-tracking-sentry';

@Module({
  imports: [
    ObserverModule.forRoot({
      resource: { serviceName: 'checkout', environment: 'production' },
      tracing: { enabled: true },
      errorTracking: {
        enabled: true,
        destinations: [
          { name: 'sentry', adapter: createSentryAdapter({ dsn: process.env.SENTRY_DSN ?? '' }) },
        ],
      },
    }),
  ],
})
export class AppModule {}
```

You can also enable only `logger: { enabled: true }` (with `@aldok10/nestjs-observe-logger` installed) or any other combination. Access enabled signals through `ObserverService` or `OBSERVE_*` tokens; unenabled signals are `undefined`.

## Next Steps

- [Combining Signals](./combining-signals.md)
- [Custom Adapters and Transports](./custom-adapters-and-transports.md)
- [Integrations](../integrations/README.md)
- [Testing](./testing.md)
