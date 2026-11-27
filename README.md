# nestjs-observe

Modular observability packages for NestJS and Node.js. The monorepo provides standalone logs, traces, metrics, and error tracking packages, plus an optional observer package for unified composition.

## Requirements

- Node.js `>=22`
- pnpm `10.11.0` for workspace development
- NestJS `^10.0.0 || ^11.0.0 || ^12.0.0` for NestJS integration packages

## Install Separately (No Cross-Pillar Dependency)

Each pillar can be installed and used independently. Logs, traces, metrics, and error tracking do not depend on each other at runtime. Install only the packages you need.

| Need | Install | Main package |
|---|---|---|
| Logs only | `@aldok10/nestjs-observe-logger` (NestJS) or `@aldok10/nestjs-observe-logger-core` (Node.js) | [Logger](packages/logs/logger/README.md) |
| Traces only | `@aldok10/nestjs-observe-tracing` | [Tracing](packages/traces/tracing/README.md) |
| Error tracking only | `@aldok10/nestjs-observe-error-tracking` + provider adapter | [Error Tracking](packages/traces/error-tracking/error-tracking/README.md) |
| Metrics only | `@aldok10/nestjs-observe-metrics` | [Metrics](packages/metrics/metrics/README.md) |
| Unified composition | `@aldok10/nestjs-observe` + enabled pillar packages | [Observer](packages/observer/observer/README.md) |

```bash
# Logger only
pnpm add @aldok10/nestjs-observe-logger @nestjs/common @nestjs/core reflect-metadata

# Trace only
pnpm add @aldok10/nestjs-observe-tracing @opentelemetry/api @nestjs/common @nestjs/core reflect-metadata

# Error tracking only (Sentry example)
pnpm add @aldok10/nestjs-observe-error-tracking @aldok10/nestjs-observe-error-tracking-sentry @sentry/node

# Metrics only
pnpm add @aldok10/nestjs-observe-metrics @opentelemetry/api @nestjs/common @nestjs/core reflect-metadata
```

## Quick Start

### Logger Only (NestJS)

```ts
import { Inject, Injectable, Module } from '@nestjs/common';
import { OBSERVE_LOGGER, ObserveLoggerModule, type UniversalLogger } from '@aldok10/nestjs-observe-logger';

@Injectable()
class AppService {
  constructor(@Inject(OBSERVE_LOGGER) private readonly logger: UniversalLogger) {}

  run(): void {
    this.logger.info('Logger ready');
  }
}

@Module({
  imports: [ObserveLoggerModule.forRoot({ level: 'info' })],
  providers: [AppService],
})
export class AppModule {}
```

### Error Tracking Only (Sentry)

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

### Observer with Selected Pillars

`@aldok10/nestjs-observe` composes enabled pillars through optional peer dependencies. Disabled pillars are not loaded. You can enable only logger, only tracing + error tracking (e.g. Sentry), or any combination.

```bash
# Example: Observer + Logger only
pnpm add @aldok10/nestjs-observe @aldok10/nestjs-observe-logger @nestjs/common @nestjs/core reflect-metadata

# Example: Observer + Tracing + Sentry error tracking
pnpm add @aldok10/nestjs-observe @aldok10/nestjs-observe-tracing @aldok10/nestjs-observe-error-tracking @aldok10/nestjs-observe-error-tracking-sentry @opentelemetry/api @sentry/node @nestjs/common @nestjs/core reflect-metadata
```

```ts
import { Injectable, Module } from '@nestjs/common';
import { ObserverModule, ObserverService } from '@aldok10/nestjs-observe';
import { createSentryAdapter } from '@aldok10/nestjs-observe-error-tracking-sentry';

@Injectable()
class CheckoutService {
  constructor(private readonly observer: ObserverService) {}

  async process(): Promise<void> {
    await this.observer.tracer?.withSpan('checkout.process', async () => {
      this.observer.logger?.info('Checkout started'); // undefined when logger is not enabled
      this.observer.metrics?.counter('checkout.total').add(1); // undefined when metrics is not enabled
    });
  }
}

@Module({
  imports: [
    ObserverModule.forRoot({
      resource: { serviceName: 'checkout', environment: 'production' },
      tracing: { enabled: true },
      errorTracking: {
        enabled: true,
        destinations: [
          {
            name: 'sentry',
            adapter: createSentryAdapter({ dsn: process.env.SENTRY_DSN ?? '' }),
          },
        ],
      },
      // logger and metrics omitted: not installed, not loaded
    }),
  ],
  providers: [CheckoutService],
})
export class AppModule {}
```

## Package Map

| Area | Main package | Path |
|---|---|---|
| Core | `@aldok10/nestjs-observe-core` | `packages/core` |
| Logs | `@aldok10/nestjs-observe-logger` | `packages/logs/logger` |
| Traces | `@aldok10/nestjs-observe-tracing` | `packages/traces/tracing` |
| Error tracking | `@aldok10/nestjs-observe-error-tracking` | `packages/traces/error-tracking/error-tracking` |
| Metrics | `@aldok10/nestjs-observe-metrics` | `packages/metrics/metrics` |
| Observer | `@aldok10/nestjs-observe` | `packages/observer/observer` |

See [docs/packages/README.md](docs/packages/README.md) for all 47 packages.

## Documentation

- [Docs index](docs/README.md)
- [Getting Started](docs/guides/getting-started.md)
- [Architecture](docs/architecture/README.md)
- [Packages](docs/packages/README.md)
- [Integrations](docs/integrations/README.md)
- [Development](docs/development/README.md)
- [Operations](docs/operations/README.md)

## Development

```bash
pnpm install
pnpm run lint
pnpm run format:check
pnpm run typecheck
pnpm test
pnpm run build
pnpm run arch:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_STANDARDS.md](CODE_STANDARDS.md).

## License

[MIT](LICENSE)
