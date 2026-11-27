# Migration Guide

This guide covers migrating to `@aldok10/nestjs-observe-*` from NestJS's built-in `Logger`, `nestjs-pino`, `winston`, and legacy `@aldok10/nestjs-logger*` package names.

## From Legacy `@aldok10/nestjs-logger*` Names

The workspace packages were renamed under the `@aldok10/nestjs-observe-*` namespace:

| Legacy Package / Symbol                | Current Package / Symbol                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@aldok10/nestjs-logger`               | `@aldok10/nestjs-observe-logger`                                                                    |
| `@aldok10/nestjs-logger-core`          | `@aldok10/nestjs-observe-logger-core`                                                               |
| `@aldok10/nestjs-logger-transports`    | `@aldok10/nestjs-observe-logger-transports`                                                         |
| `DevLoggerModule` / `DevLoggerOptions` | `ObserveLoggerModule` (or `LoggerModule`) / `ObserveLoggerOptions` (legacy names remain as aliases) |
| `DEV_LOGGER`                           | `OBSERVE_LOGGER` (legacy token remains as alias)                                                    |
| `LogEvent`                             | `LogRecord` (`LogEvent` is deprecated alias for `LogRecord`)                                        |
| `NestjsAdapter`                        | `NestjsLoggerAdapter` (`NestjsAdapter` is deprecated alias)                                         |

Update `package.json` dependencies and TypeScript imports from `@aldok10/nestjs-logger*` to `@aldok10/nestjs-observe-logger*`.

## From NestJS Built-In `Logger`

1. Install `@aldok10/nestjs-observe-logger`.
2. Register `ObserveLoggerModule.forRoot({ level: 'info' })` in your root `AppModule`.
3. Inject `@Inject(OBSERVE_LOGGER) private readonly logger: UniversalLogger` (or `@InjectLogger('channel')` for multi-channel setups).
4. If you have an existing `LoggerService` implementation you want to keep temporarily, wrap it with `NestjsLoggerAdapter`:

```ts
import { Logger } from '@nestjs/common';
import { NestjsLoggerAdapter } from '@aldok10/nestjs-observe-logger';

const logger = new NestjsLoggerAdapter().create(new Logger('App'), {
  level: 'info',
});
```

Note that `NestjsLoggerAdapter` has `structuredMetadata: false` and `serialization: false` in `NESTJS_ADAPTER_CAPABILITIES` because NestJS `LoggerService` accepts message/context/stack arguments only.

## From `nestjs-pino`

1. Install `@aldok10/nestjs-observe-logger`, `@aldok10/nestjs-observe-logger-adapter-pino`, and `@aldok10/nestjs-observe-logger-http` (if you rely on HTTP request logging).
2. Wrap your existing `pino` instance with `PinoLoggerAdapter` and pass it into `ObserveLoggerModule.forRoot()`:

```ts
import pino from 'pino';
import { Module } from '@nestjs/common';
import { ObserveLoggerModule } from '@aldok10/nestjs-observe-logger';
import { PinoLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-pino';

const pinoInstance = pino({ level: 'info' });

@Module({
  imports: [
    ObserveLoggerModule.forRoot({
      level: 'info',
      backend: {
        type: 'pino',
        logger: pinoInstance,
        adapter: new PinoLoggerAdapter(),
      },
    }),
  ],
})
export class AppModule {}
```

3. Replace `pino-http` middleware with `NestHttpRequestLogger` from `@aldok10/nestjs-observe-logger-http/nestjs` (or `createExpressRequestLogger` / `createFastifyHooks` from `@aldok10/nestjs-observe-logger-http`).

## From `winston`

1. Install `@aldok10/nestjs-observe-logger` and `@aldok10/nestjs-observe-logger-adapter-winston`.
2. Wrap your existing `winston.Logger` instance with `WinstonLoggerAdapter`:

```ts
import winston from 'winston';
import { Module } from '@nestjs/common';
import { ObserveLoggerModule } from '@aldok10/nestjs-observe-logger';
import { WinstonLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-winston';

const winstonInstance = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

@Module({
  imports: [
    ObserveLoggerModule.forRoot({
      level: 'info',
      backend: {
        type: 'winston',
        logger: winstonInstance,
        adapter: new WinstonLoggerAdapter(),
      },
    }),
  ],
})
export class AppModule {}
```

When using `PinoLoggerAdapter` or `WinstonLoggerAdapter` with `ownership: 'backend'` (default when `sink` is omitted), flushing and closing the underlying backend streams remains your responsibility.
