# `@aldok10/nestjs-observe-logger-adapter-bunyan`

Independent Bunyan backend adapter that bridges a `bunyan` logger instance to the `@aldok10/nestjs-observe-logger-core` universal logger contract.

## Overview

`@aldok10/nestjs-observe-logger-adapter-bunyan` adapts any Bunyan-compatible logger (`BunyanLike`) into a `UniversalLogger` with structured metadata merging, recursive redaction, error serialization, child logger derivation, configurable level mapping, and dual-ownership routing between your Bunyan instance and a package-level sink.

## Why This Package?

- **Decoupled peer dependency**: Keeps `bunyan` (`^1.8.0`) as a peer dependency and never imports `bunyan` at module load time, using the structural `BunyanLike` interface instead.
- **Universal contract**: Exposes all 8 universal log levels (`trace`, `debug`, `verbose`, `info`, `log`, `warn`, `error`, `fatal`) and maps them onto Bunyan's 6 native levels.
- **Built-in safety**: Sanitizes context, metadata, and `child()` bindings via `RedactionEngine` and serializes `Error` instances into Bunyan's `err` field.

## Features

- Maps universal log levels to Bunyan methods (`verbose` -> `debug`, `log` -> `info`) while preserving `record.level`.
- Supports custom `levelMap` overrides validated at `create()` time (throws `InvalidLoggerConfigurationException` on invalid keys or unsupported Bunyan levels).
- Falls back to `info` (or any callable supported method) if a mapped method is missing on the `BunyanLike` instance.
- Derives native Bunyan child loggers via `backend.child()` with redacted bindings.
- Supports `ownership` modes (`'backend'`, `'package'`, `'both'`) to route records to Bunyan, a custom `sink`, or both without duplicate delivery.
- Passes `{ ...record, err: record.error }` and `record.message` to Bunyan, matching Bunyan's `(fields, msg)` signature.

## Architecture and Responsibilities

```mermaid
flowchart LR
  Caller["UniversalLogger Caller"] --> Bridge["AdapterLogBridge (core)"]
  Bridge --> Redact["RedactionEngine & LogRecordFactory"]
  Redact -->|ownership: package / both| Sink["options.sink(record)"]
  Redact -->|ownership: backend / both| Write["BunyanLoggerAdapter.writeRecord"]
  Write -->|"fn(record + err, message)"| Bunyan["BunyanLike / bunyan"]
  Bridge -->|"child(context)"| Child["deriveChild -> backend.child(sanitized)"]
```

- `BunyanLoggerAdapter` (aliased as `BunyanAdapter`) implements `LoggerAdapter<BunyanLike>`.
- `LevelMappingResolver` validates `levelMap` against `['trace', 'debug', 'info', 'warn', 'error', 'fatal']`.
- `AdapterLogBridge` handles argument parsing, context merging, redaction, error serialization, ownership routing, and child logger creation.

## Installation

```bash
pnpm add @aldok10/nestjs-observe-logger-adapter-bunyan @aldok10/nestjs-observe-logger-core bunyan
```

```bash
npm install @aldok10/nestjs-observe-logger-adapter-bunyan @aldok10/nestjs-observe-logger-core bunyan
```

```bash
yarn add @aldok10/nestjs-observe-logger-adapter-bunyan @aldok10/nestjs-observe-logger-core bunyan
```

## Requirements

- **Node.js**: `>=22`
- **Peer dependencies**: `bunyan` (`^1.8.0`)
- **Module formats**: ESM (`import`), CJS (`require`), and TypeScript type definitions (`.d.ts`)

## Quick Start

```ts
import bunyan from 'bunyan';
import { BunyanLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-bunyan';

const bunyanInstance = bunyan.createLogger({ name: 'api', level: 'trace' });
const logger = new BunyanLoggerAdapter().create(bunyanInstance, {
  level: 'trace',
});

logger.info('Application started', {
  context: 'Bootstrap',
  metadata: { port: 3000 },
});
```

## Configuration

`BunyanAdapterOptions` (aliased as `AdapterOptions`) extends `LoggerAdapterOptions`:

| Property    | Type                                           | Required | Default                                                                                                                         | Description                                                                      |
| ----------- | ---------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `level`     | `LogLevel`                                     | Yes      | —                                                                                                                               | Minimum universal log level configured on the adapter options.                   |
| `context`   | `LogContext`                                   | No       | `undefined`                                                                                                                     | Base context merged into every emitted `LogRecord`.                              |
| `redaction` | `RedactionOptions`                             | No       | Core defaults                                                                                                                   | Redaction rules applied to records and `child()` bindings via `RedactionEngine`. |
| `format`    | `FormatterType \| LogFormatter`                | No       | `undefined`                                                                                                                     | Formatter option inherited from `LoggerAdapterOptions`.                          |
| `sink`      | `(record: LogRecord) => void \| Promise<void>` | No       | `undefined`                                                                                                                     | Optional package-level sink callback receiving normalized `LogRecord`s.          |
| `ownership` | `'backend' \| 'package' \| 'both'`             | No       | `'package'` if `sink` is set, else `'backend'`                                                                                  | Controls whether records go to `sink`, the Bunyan backend, or both.              |
| `levelMap`  | `Partial<Record<LogLevel, string>>`            | No       | `{ trace: 'trace', debug: 'debug', verbose: 'debug', info: 'info', log: 'info', warn: 'warn', error: 'error', fatal: 'fatal' }` | Custom mapping from universal `LogLevel` to Bunyan method names.                 |

## Usage

### Child Loggers and Error Serialization

```ts
import bunyan from 'bunyan';
import { BunyanLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-bunyan';

const logger = new BunyanLoggerAdapter().create(bunyan.createLogger({ name: 'orders' }), {
  level: 'info',
  context: { context: 'Orders' },
});

const child = logger.child?.({ traceId: 'trace-42' });
child?.error(new Error('Payment timeout'));
```

When `record.error` is present, `BunyanLoggerAdapter` attaches `err: record.error` alongside `record` and passes `record.message` as the second argument.

## Advanced Usage

### Custom Level Mapping and Dual Ownership

```ts
import bunyan from 'bunyan';
import { BunyanLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-bunyan';

const logger = new BunyanLoggerAdapter().create(bunyan.createLogger({ name: 'api' }), {
  level: 'trace',
  ownership: 'both',
  levelMap: { verbose: 'trace', log: 'info' },
  sink: async (record) => {
    // Forward normalized LogRecord to an external pipeline or transport
  },
});
```

## API Reference

- `BunyanLoggerAdapter` / `BunyanAdapter` — Class implementing `LoggerAdapter<BunyanLike>` with `name = 'bunyan'` and `create(logger: BunyanLike, options: BunyanAdapterOptions): UniversalLogger`.
- `BUNYAN_ADAPTER_CAPABILITIES` — `AdapterCapabilities` constant (`structuredMetadata: true`, `childLoggers: true`, `contextBinding: true`, `dynamicLogLevels: false`, `nativeTransports: true`, `redaction: true`, `serialization: true`, `flush: false`, `gracefulShutdown: false`).
- `BunyanAdapterOptions` / `AdapterOptions` — Options interface extending `LoggerAdapterOptions`.
- `BunyanLike` — Structural interface describing the required Bunyan logger methods (`trace`, `debug`, `info`, `warn`, `error`, `fatal`, `child`, `level`).

## Integration with Other Packages

- Uses `@aldok10/nestjs-observe-logger-core` (`AdapterLogBridge`, `LevelMappingResolver`, `RedactionEngine`, and core contracts).
- Works with `@aldok10/nestjs-observe-logger` when registering a Bunyan backend adapter, or standalone in any Node.js/NestJS service.

## Dependencies and Optional Integrations

- **Runtime dependency**: `@aldok10/nestjs-observe-logger-core` (`^0.1.0`)
- **Peer dependency**: `bunyan` (`^1.8.0`)

## Lifecycle and Resource Management

`BUNYAN_ADAPTER_CAPABILITIES.flush` and `BUNYAN_ADAPTER_CAPABILITIES.gracefulShutdown` are `false`. Stream flushing and shutdown are managed by the caller's `bunyan` instance.

## Error Handling

- Passing an unknown universal level or unsupported Bunyan level in `levelMap` throws `InvalidLoggerConfigurationException` synchronously during `create()`.
- Async errors returned by `options.sink` are caught internally by `AdapterLogBridge`.
- If a mapped level method is absent on `BunyanLike`, `AdapterLogBridge.resolveMethod` falls back to `'info'` and then any supported method present on the backend.

## Performance Considerations

- `bunyan` is not imported by the adapter, avoiding startup overhead if you supply a custom or pre-configured `BunyanLike` instance.
- `RedactionEngine` sanitizes `context` bindings on `child()` calls and metadata on each log call.

## Security Considerations

- Default core redaction masks sensitive fields (such as `password` and `secret`) with `'[REDACTED]'` in both log records and `child()` bindings before they reach Bunyan.
- Error instances in the first argument or in `metadata` are serialized into plain objects.

## Testing

```bash
pnpm test
pnpm exec vitest run packages/logs/adapter-bunyan
```

## Troubleshooting

- **`InvalidLoggerConfigurationException` on `create()`**: Verify `levelMap` keys are valid universal `LogLevel`s and values are one of `'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'`.
- **Logs not appearing in Bunyan when `sink` is set**: When `sink` is provided, `ownership` defaults to `'package'`. Set `ownership: 'both'` to emit to both `sink` and Bunyan.

## Limitations

- `dynamicLogLevels`, `flush`, and `gracefulShutdown` are not supported (`false` in `BUNYAN_ADAPTER_CAPABILITIES`).

## Related Packages

- [`@aldok10/nestjs-observe-logger-core`](../core/README.md)
- [`@aldok10/nestjs-observe-logger`](../logger/README.md)
- [`@aldok10/nestjs-observe-logger-adapter-pino`](../adapter-pino/README.md)
- [`@aldok10/nestjs-observe-logger-adapter-winston`](../adapter-winston/README.md)
- [`@aldok10/nestjs-observe-logger-adapter-log4js`](../adapter-log4js/README.md)

## Documentation

- [Logs Ecosystem Overview](../../../docs/packages/logger/README.md)

## Contributing

See [CONTRIBUTING.md](../../../CONTRIBUTING.md).

## License

MIT — see [LICENSE](../../../LICENSE).
