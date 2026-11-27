# Logger Backends

Backend adapters wrap existing Node.js logging libraries behind the `UniversalLogger` and `LoggerAdapter` contracts from `@aldok10/nestjs-observe-logger-core`. Each adapter keeps its target library as a peer dependency and uses a structural `*Like` interface so the backend is never imported at module load time.

## Supported Backends

| Backend | Package                                                                                           | Peer Dependency                | Native `child()`                     |
| ------- | ------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------ |
| Pino    | [`@aldok10/nestjs-observe-logger-adapter-pino`](../../packages/logs/adapter-pino/README.md)       | `pino` (`^9.0.0 \|\| ^10.0.0`) | Yes (`PinoLike.child`)               |
| Winston | [`@aldok10/nestjs-observe-logger-adapter-winston`](../../packages/logs/adapter-winston/README.md) | `winston` (`^3.0.0`)           | Yes (`WinstonLike.child`)            |
| Bunyan  | [`@aldok10/nestjs-observe-logger-adapter-bunyan`](../../packages/logs/adapter-bunyan/README.md)   | `bunyan` (`^1.8.0`)            | Yes (`BunyanLike.child`)             |
| Log4js  | [`@aldok10/nestjs-observe-logger-adapter-log4js`](../../packages/logs/adapter-log4js/README.md)   | `log4js` (`^6.0.0`)            | No (emulated via `AdapterLogBridge`) |

In addition, [`@aldok10/nestjs-observe-logger`](../../packages/logs/logger/README.md) includes `NestjsLoggerAdapter` (`NESTJS_ADAPTER_CAPABILITIES`) for wrapping any NestJS `LoggerServiceLike` instance.

## Capabilities Matrix

All four external backend adapters share these capabilities:

- `structuredMetadata: true`
- `contextBinding: true`
- `dynamicLogLevels: false`
- `nativeTransports: true`
- `redaction: true`
- `serialization: true`
- `flush: false`
- `gracefulShutdown: false`

Difference:

- `childLoggers` is `true` on `PINO_ADAPTER_CAPABILITIES`, `WINSTON_ADAPTER_CAPABILITIES`, and `BUNYAN_ADAPTER_CAPABILITIES`.
- `childLoggers` is `false` on `LOG4JS_ADAPTER_CAPABILITIES` (`AdapterLogBridge` still provides `.child(context)` by merging inherited context into emitted `LogRecord`s).

Because `flush` and `gracefulShutdown` are `false` on all four adapters, flushing or closing the underlying backend streams remains the responsibility of the caller managing the logger instance.

## Shared Adapter Options

All four adapter option types (`PinoAdapterOptions`, `WinstonAdapterOptions`, `BunyanAdapterOptions`, `Log4jsAdapterOptions`) extend `LoggerAdapterOptions` with:

- `level`: Minimum universal `LogLevel` (`trace`, `debug`, `verbose`, `info`, `log`, `warn`, `error`, `fatal`).
- `context`: Base `LogContext` merged into every emitted `LogRecord`.
- `redaction`: `RedactionOptions` applied to records and `child()` bindings via `RedactionEngine`.
- `ownership`: `'backend' | 'package' | 'both'` (defaults to `'package'` if `sink` is set, otherwise `'backend'`).
- `sink`: Optional `(record: LogRecord) => void | Promise<void>` callback receiving normalized `LogRecord`s.
- `levelMap`: Optional `Partial<Record<LogLevel, string>>` validated at `create()` time (throws `InvalidLoggerConfigurationException` on invalid keys or unsupported backend levels).

## Pino

- **Package**: `@aldok10/nestjs-observe-logger-adapter-pino`
- **Exports**: `PinoLoggerAdapter` (`PinoAdapter`), `PINO_ADAPTER_CAPABILITIES`, `PinoAdapterOptions` (`AdapterOptions`), `PinoLike`
- **Default `levelMap`**: `verbose` -> `debug`, `log` -> `info`; `trace`, `debug`, `info`, `warn`, `error`, `fatal` map 1:1.
- **Record format**: Passes `{ ...record, err: record.error }` and `record.message` to Pino.

```ts
import pino from 'pino';
import { PinoLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-pino';

const pinoInstance = pino({ level: 'trace' });
const logger = new PinoLoggerAdapter().create(pinoInstance, {
  level: 'trace',
});

logger.info('Application started', {
  context: 'Bootstrap',
  metadata: { port: 3000 },
});
```

## Winston

- **Package**: `@aldok10/nestjs-observe-logger-adapter-winston`
- **Exports**: `WinstonLoggerAdapter` (`WinstonAdapter`), `WINSTON_ADAPTER_CAPABILITIES`, `WinstonAdapterOptions` (`AdapterOptions`), `WinstonLike`
- **Supported backend levels**: `['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']`.
- **Default `levelMap`**: `trace` -> `debug`, `debug` -> `debug`, `verbose` -> `verbose`, `info` -> `info`, `log` -> `info`, `warn` -> `warn`, `error` -> `error`, `fatal` -> `error`.
- **Record format**: Passes `(message, meta)` where `meta` is the normalized `LogRecord` without `message`.

```ts
import winston from 'winston';
import { WinstonLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-winston';

const winstonInstance = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

const logger = new WinstonLoggerAdapter().create(winstonInstance, {
  level: 'trace',
});
```

## Bunyan

- **Package**: `@aldok10/nestjs-observe-logger-adapter-bunyan`
- **Exports**: `BunyanLoggerAdapter` (`BunyanAdapter`), `BUNYAN_ADAPTER_CAPABILITIES`, `BunyanAdapterOptions` (`AdapterOptions`), `BunyanLike`
- **Supported backend levels**: `['trace', 'debug', 'info', 'warn', 'error', 'fatal']`.
- **Default `levelMap`**: `verbose` -> `debug`, `log` -> `info`; remaining levels map 1:1.
- **Record format**: Passes `{ ...record, err: record.error }` and `record.message` to Bunyan.

```ts
import bunyan from 'bunyan';
import { BunyanLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-bunyan';

const bunyanInstance = bunyan.createLogger({ name: 'api', level: 'trace' });
const logger = new BunyanLoggerAdapter().create(bunyanInstance, {
  level: 'trace',
});
```

## Log4js

- **Package**: `@aldok10/nestjs-observe-logger-adapter-log4js`
- **Exports**: `Log4jsLoggerAdapter` (`Log4jsAdapter`), `LOG4JS_ADAPTER_CAPABILITIES`, `Log4jsAdapterOptions` (`AdapterOptions`), `Log4jsLike`
- **Supported backend levels**: `['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'mark']`.
- **Default `levelMap`**: `verbose` -> `debug`, `log` -> `info`; remaining levels map 1:1 (`mark` can be targeted via `levelMap`).
- **Record format**: Passes `(message, meta)` where `meta` is the normalized `LogRecord` without `message`.

```ts
import log4js from 'log4js';
import { Log4jsLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-log4js';

const log4jsInstance = log4js.getLogger('app');
log4jsInstance.level = 'trace';

const logger = new Log4jsLoggerAdapter().create(log4jsInstance, {
  level: 'trace',
});
```
