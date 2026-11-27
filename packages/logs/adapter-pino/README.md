# `@aldok10/nestjs-observe-logger-adapter-pino`

Independent Pino backend adapter that bridges a `pino` logger instance to the `@aldok10/nestjs-observe-logger-core` universal logger contract.

## Overview

`@aldok10/nestjs-observe-logger-adapter-pino` adapts any Pino-compatible logger (`PinoLike`) into a `UniversalLogger` with structured metadata merging, recursive redaction, error serialization, child logger derivation, configurable level mapping, and dual-ownership routing between your Pino instance and a package-level sink.

## Why This Package?

- **Decoupled peer dependency**: Keeps `pino` as a peer dependency (`^9.0.0 || ^10.0.0`) and never imports `pino` at module load time, using the structural `PinoLike` interface instead.
- **Universal contract**: Exposes all 8 universal log levels (`trace`, `debug`, `verbose`, `info`, `log`, `warn`, `error`, `fatal`) and maps them onto Pino's 6 native levels.
- **Built-in safety**: Sanitizes context, metadata, and `child()` bindings via `RedactionEngine` and serializes `Error` instances before forwarding to Pino or a sink.

## Features

- Maps universal log levels to Pino methods (`verbose` -> `debug`, `log` -> `info`) while preserving `record.level`.
- Supports custom `levelMap` overrides validated at `create()` time (throws `InvalidLoggerConfigurationException` on invalid keys or unsupported Pino levels).
- Falls back to `info` (or any callable supported method) if a mapped method is missing on the `PinoLike` instance.
- Derives native Pino child loggers via `backend.child()` with redacted bindings.
- Supports `ownership` modes (`'backend'`, `'package'`, `'both'`) to route records to Pino, a custom `sink`, or both without duplicate delivery.
- Passes `{ ...record, err: record.error }` and `record.message` to Pino, matching Pino's `(obj, msg)` signature.

## Architecture and Responsibilities

```mermaid
flowchart LR
  Caller["UniversalLogger Caller"] --> Bridge["AdapterLogBridge (core)"]
  Bridge --> Redact["RedactionEngine & LogRecordFactory"]
  Redact -->|ownership: package / both| Sink["options.sink(record)"]
  Redact -->|ownership: backend / both| Write["PinoLoggerAdapter.writeRecord"]
  Write -->|"fn(record + err, message)"| Pino["PinoLike / pino"]
  Bridge -->|"child(context)"| Child["deriveChild -> backend.child(sanitized)"]
```

- `PinoLoggerAdapter` (aliased as `PinoAdapter`) implements `LoggerAdapter<PinoLike>`.
- `LevelMappingResolver` validates `levelMap` against `['trace', 'debug', 'info', 'warn', 'error', 'fatal']`.
- `AdapterLogBridge` handles argument parsing, context merging, redaction, error serialization, ownership routing, and child logger creation.

## Installation

```bash
pnpm add @aldok10/nestjs-observe-logger-adapter-pino @aldok10/nestjs-observe-logger-core pino
```

```bash
npm install @aldok10/nestjs-observe-logger-adapter-pino @aldok10/nestjs-observe-logger-core pino
```

```bash
yarn add @aldok10/nestjs-observe-logger-adapter-pino @aldok10/nestjs-observe-logger-core pino
```

## Requirements

- **Node.js**: `>=22`
- **Peer dependencies**: `pino` (`^9.0.0 || ^10.0.0`)
- **Module formats**: ESM (`import`), CJS (`require`), and TypeScript type definitions (`.d.ts`)

## Quick Start

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

## Configuration

`PinoAdapterOptions` (aliased as `AdapterOptions`) extends `LoggerAdapterOptions`:

| Property    | Type                                           | Required | Default                                                                                                                         | Description                                                                      |
| ----------- | ---------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `level`     | `LogLevel`                                     | Yes      | —                                                                                                                               | Minimum universal log level configured on the adapter options.                   |
| `context`   | `LogContext`                                   | No       | `undefined`                                                                                                                     | Base context merged into every emitted `LogRecord`.                              |
| `redaction` | `RedactionOptions`                             | No       | Core defaults                                                                                                                   | Redaction rules applied to records and `child()` bindings via `RedactionEngine`. |
| `format`    | `FormatterType \| LogFormatter`                | No       | `undefined`                                                                                                                     | Formatter option inherited from `LoggerAdapterOptions`.                          |
| `sink`      | `(record: LogRecord) => void \| Promise<void>` | No       | `undefined`                                                                                                                     | Optional package-level sink callback receiving normalized `LogRecord`s.          |
| `ownership` | `'backend' \| 'package' \| 'both'`             | No       | `'package'` if `sink` is set, else `'backend'`                                                                                  | Controls whether records go to `sink`, the Pino backend, or both.                |
| `levelMap`  | `Partial<Record<LogLevel, string>>`            | No       | `{ trace: 'trace', debug: 'debug', verbose: 'debug', info: 'info', log: 'info', warn: 'warn', error: 'error', fatal: 'fatal' }` | Custom mapping from universal `LogLevel` to Pino method names.                   |

## Usage

### Child Loggers and Error Serialization

```ts
import pino from 'pino';
import { PinoLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-pino';

const logger = new PinoLoggerAdapter().create(pino({ level: 'info' }), {
  level: 'info',
  context: { context: 'App' },
});

const ordersLogger = logger.child?.({ context: 'Orders', traceId: 'tr-123' });
ordersLogger?.error(new Error('Order lookup failed'));
```

When `record.error` is present, `PinoLoggerAdapter` attaches `err: record.error` alongside `record` so Pino's standard `err` field is populated.

## Advanced Usage

### Custom Level Mapping and Dual Ownership

```ts
import pino from 'pino';
import { PinoLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-pino';

const logger = new PinoLoggerAdapter().create(pino({ level: 'trace' }), {
  level: 'trace',
  ownership: 'both',
  levelMap: { verbose: 'trace', log: 'info' },
  sink: async (record) => {
    // Forward normalized LogRecord to an external pipeline or transport
  },
});
```

## API Reference

- `PinoLoggerAdapter` / `PinoAdapter` — Class implementing `LoggerAdapter<PinoLike>` with `name = 'pino'` and `create(logger: PinoLike, options: PinoAdapterOptions): UniversalLogger`.
- `PINO_ADAPTER_CAPABILITIES` — `AdapterCapabilities` constant (`structuredMetadata: true`, `childLoggers: true`, `contextBinding: true`, `dynamicLogLevels: false`, `nativeTransports: true`, `redaction: true`, `serialization: true`, `flush: false`, `gracefulShutdown: false`).
- `PinoAdapterOptions` / `AdapterOptions` — Options interface extending `LoggerAdapterOptions`.
- `PinoLike` — Structural interface describing the required Pino logger methods (`trace`, `debug`, `info`, `warn`, `error`, `fatal`, `child`, `level`).

## Integration with Other Packages

- Uses `@aldok10/nestjs-observe-logger-core` (`AdapterLogBridge`, `LevelMappingResolver`, `RedactionEngine`, and core contracts).
- Works with `@aldok10/nestjs-observe-logger` when registering a Pino backend adapter, or standalone in any Node.js/NestJS service.

## Dependencies and Optional Integrations

- **Runtime dependency**: `@aldok10/nestjs-observe-logger-core` (`^0.1.0`)
- **Peer dependency**: `pino` (`^9.0.0 || ^10.0.0`)

## Lifecycle and Resource Management

`PINO_ADAPTER_CAPABILITIES.flush` and `PINO_ADAPTER_CAPABILITIES.gracefulShutdown` are `false`. Flushing or closing the underlying Pino destination/stream remains the responsibility of the caller managing the `pino` instance.

## Error Handling

- Passing an unknown universal level or unsupported Pino level in `levelMap` throws `InvalidLoggerConfigurationException` synchronously during `create()`.
- Async errors returned by `options.sink` are caught internally by `AdapterLogBridge` so logging calls do not throw unhandled rejections.
- If a mapped level method is absent on `PinoLike`, `AdapterLogBridge.resolveMethod` falls back to `'info'` and then any supported method present on the backend.

## Performance Considerations

- `pino` is not imported by the adapter, avoiding startup overhead if you supply a custom or pre-configured `PinoLike` instance.
- `RedactionEngine` sanitizes `context` bindings on `child()` calls and metadata on each log call.

## Security Considerations

- Default core redaction masks sensitive fields (such as `password` and `secret`) with `'[REDACTED]'` in both log records and `child()` bindings before they reach Pino.
- Error instances in the first argument or in `metadata` are serialized into plain objects so non-enumerable or unsafe properties are not leaked.

## Testing

```bash
pnpm test
pnpm exec vitest run packages/logs/adapter-pino
```

## Troubleshooting

- **`InvalidLoggerConfigurationException` on `create()`**: Verify `levelMap` keys are valid universal `LogLevel`s and values are one of `'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'`.
- **Logs not appearing in Pino when `sink` is set**: When `sink` is provided, `ownership` defaults to `'package'`. Set `ownership: 'both'` to emit to both `sink` and Pino.

## Limitations

- `dynamicLogLevels`, `flush`, and `gracefulShutdown` are not supported (`false` in `PINO_ADAPTER_CAPABILITIES`).

## Related Packages

- [`@aldok10/nestjs-observe-logger-core`](../core/README.md)
- [`@aldok10/nestjs-observe-logger`](../logger/README.md)
- [`@aldok10/nestjs-observe-logger-adapter-winston`](../adapter-winston/README.md)
- [`@aldok10/nestjs-observe-logger-adapter-bunyan`](../adapter-bunyan/README.md)
- [`@aldok10/nestjs-observe-logger-adapter-log4js`](../adapter-log4js/README.md)

## Documentation

- [Logs Ecosystem Overview](../../../docs/packages/logger/README.md)

## Contributing

See [CONTRIBUTING.md](../../../CONTRIBUTING.md).

## License

MIT — see [LICENSE](../../../LICENSE).
