# `@aldok10/nestjs-observe-error-tracking-dynatrace`

Dynatrace OTLP/HTTP logs and OpenTelemetry active-span adapter for `@aldok10/nestjs-observe-error-tracking`.

## Overview

`@aldok10/nestjs-observe-error-tracking-dynatrace` sends normalized `ObserveErrorEvent` payloads directly to Dynatrace's OTLP/HTTP v1 logs ingest endpoint (`/api/v2/otlp/v1/logs`) using Node.js `fetch`. Optionally, when `@opentelemetry/api` is present, it also records the exception and error status on the active OpenTelemetry span for OneAgent / Grail trace correlation.

## Why This Package?

- **Direct OTLP/HTTP delivery**: Exports structured OpenTelemetry log records (`resourceLogs`) over HTTPS with zero required third-party SDK dependencies.
- **Dual token support**: Supports both Dynatrace Platform Tokens (`Authorization: Bearer <platformToken>`) and classic API Tokens (`Authorization: Api-Token <apiToken>`).
- **Optional OpenTelemetry span recording**: Automatically calls `recordException` and `setStatus` on the active `@opentelemetry/api` span when `recordOnActiveSpan` is enabled.

## Features

- Implements `ErrorTrackingAdapter` (`name: 'dynatrace'`) with `deliveryMode: 'direct-http'`.
- Capabilities: `exceptions`, `messages`, `tags`, `traceCorrelation`, `transactions` (`breadcrumbs`, `fingerprinting`, `userContext`, `sessions`, and `profiling` are `false`).
- Normalizes `endpoint` URLs automatically (accepts base environment URL, `/api/v2/otlp`, or full `/v1/logs` URL).
- Maps `ErrorSeverity` (`info`, `warning`, `error`, `fatal`) to OTLP `severityNumber` (`9`, `13`, `17`, `21`) and `severityText` (`INFO`, `WARN`, `ERROR`, `FATAL`).
- Supports request timeout (`timeoutMs`, default `3000`) and external `AbortSignal` cancellation.

## Architecture and Responsibilities

```mermaid
flowchart LR
    App["NestJS App / ErrorTrackingRuntime"] -->|"ObserveErrorEvent + AbortSignal"| Adapter["DynatraceErrorAdapter"]
    Adapter -->|"recordOnActiveSpan !== false"| OTel["@opentelemetry/api (optional peer)\nspan.recordException + setStatus"]
    Adapter -->|"buildPayload() -> POST /api/v2/otlp/v1/logs"| DT["Dynatrace OTLP Ingest"]
```

- **Adapter (`DynatraceErrorAdapter`)**: Owns endpoint URL resolution, OTLP `resourceLogs` payload construction, optional active-span exception recording, and HTTP POST delivery with timeout/abort handling.
- **Core Runtime (`@aldok10/nestjs-observe-error-tracking`)**: Owns NestJS exception capture, enrichment, redaction, deduplication, and retry/queue orchestration.

## Installation

```bash
pnpm add @aldok10/nestjs-observe-error-tracking-dynatrace @aldok10/nestjs-observe-error-tracking @aldok10/nestjs-observe-core
```

```bash
npm install @aldok10/nestjs-observe-error-tracking-dynatrace @aldok10/nestjs-observe-error-tracking @aldok10/nestjs-observe-core
```

```bash
yarn add @aldok10/nestjs-observe-error-tracking-dynatrace @aldok10/nestjs-observe-error-tracking @aldok10/nestjs-observe-core
```

Optional peer dependency for active-span recording:

```bash
pnpm add @opentelemetry/api
```

## Requirements

- **Node.js**: `>=22`
- **Peer dependencies**: `@opentelemetry/api` (`^1.10.0`, optional)
- **Module formats**: Dual ESM (`dist/index.js`) and CommonJS (`dist/index.cjs`) with TypeScript declarations (`dist/index.d.ts`)

## Quick Start

```ts
import { Module } from '@nestjs/common';
import { ErrorTrackingModule } from '@aldok10/nestjs-observe-error-tracking';
import { createDynatraceAdapter } from '@aldok10/nestjs-observe-error-tracking-dynatrace';

@Module({
  imports: [
    ErrorTrackingModule.forRoot({
      resource: {
        serviceName: 'orders-api',
        environment: 'production',
        release: '1.0.0',
      },
      destinations: [
        {
          name: 'dynatrace',
          adapter: createDynatraceAdapter({
            endpoint: 'https://abc12345.live.dynatrace.com',
            apiToken: process.env.DYNATRACE_API_TOKEN,
          }),
        },
      ],
    }),
  ],
})
export class AppModule {}
```

## Configuration

`DynatraceAdapterOptions`:

| Property             | Type                               | Required | Default     | Description                                                                                                              |
| -------------------- | ---------------------------------- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `endpoint`           | `string`                           | Yes      | —           | Base Dynatrace environment URL (e.g. `https://<env>.live.dynatrace.com`), `/api/v2/otlp` URL, or full `/v1/logs` URL.    |
| `apiToken`           | `string`                           | No       | `undefined` | Dynatrace API token sent as `Authorization: Api-Token <apiToken>` (used when `platformToken` is not set).                |
| `platformToken`      | `string`                           | No       | `undefined` | Dynatrace Platform token sent as `Authorization: Bearer <platformToken>` (takes precedence over `apiToken`).             |
| `headers`            | `Readonly<Record<string, string>>` | No       | `undefined` | Additional HTTP headers merged into the OTLP POST request.                                                               |
| `timeoutMs`          | `number`                           | No       | `3000`      | Request timeout in milliseconds before aborting the `fetch` call.                                                        |
| `recordOnActiveSpan` | `boolean`                          | No       | `true`      | When not `false`, records the exception and error status (`code: 2`) on the active `@opentelemetry/api` span if present. |

## Usage

### Direct Adapter Usage

```ts
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createDynatraceAdapter } from '@aldok10/nestjs-observe-error-tracking-dynatrace';

const adapter = createDynatraceAdapter({
  endpoint: 'https://abc12345.live.dynatrace.com',
  platformToken: process.env.DYNATRACE_PLATFORM_TOKEN,
});

await adapter.capture(
  normalizeError(new Error('Inventory sync failed'), {
    tags: { region: 'eu-central-1' },
  }),
);
```

### Endpoint Resolution

The constructor trims trailing slashes from `endpoint` and resolves the target URL as follows:

- Ends with `/v1/logs`: used as-is
- Ends with `/api/v2/otlp`: appends `/v1/logs`
- Otherwise: appends `/api/v2/otlp/v1/logs`

## Advanced Usage

### Custom Headers and AbortSignal

```ts
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import { createDynatraceAdapter } from '@aldok10/nestjs-observe-error-tracking-dynatrace';

const adapter = createDynatraceAdapter({
  endpoint: 'https://abc12345.live.dynatrace.com',
  apiToken: process.env.DYNATRACE_API_TOKEN,
  timeoutMs: 5000,
  recordOnActiveSpan: false,
  headers: {
    'x-custom-routing': 'edge',
  },
});

const controller = new AbortController();
await adapter.capture(normalizeError(new Error('Timeout')), controller.signal);
```

## API Reference

- `DynatraceErrorAdapter` — Class implementing `ErrorTrackingAdapter` (`name = 'dynatrace'`).
  - `constructor(options: DynatraceAdapterOptions)`
  - `capture(event: ObserveErrorEvent, signal?: AbortSignal): Promise<void>`
- `createDynatraceAdapter(options: DynatraceAdapterOptions): DynatraceErrorAdapter` — Factory helper returning a `DynatraceErrorAdapter` instance.
- `DynatraceAdapterOptions` — Configuration interface (`endpoint`, `apiToken?`, `platformToken?`, `headers?`, `timeoutMs?`, `recordOnActiveSpan?`).

## Integration with Other Packages

- `@aldok10/nestjs-observe-error-tracking`: Hosts `DynatraceErrorAdapter` in `ErrorTrackingModule` / `ErrorTrackingRuntime`.
- `@aldok10/nestjs-observe-core`: Provides `tryLoadOptionalPeer` for safely probing `@opentelemetry/api`.

## Dependencies and Optional Integrations

- **Runtime dependencies**: `@aldok10/nestjs-observe-core`, `@aldok10/nestjs-observe-error-tracking`
- **Optional peer dependency**: `@opentelemetry/api` (`^1.10.0`)

## Lifecycle and Resource Management

- No `initialize()`, `flush()`, or `shutdown()` hooks are required; the adapter is ready immediately after construction.
- Each `capture()` call creates an `AbortController` with an unref'd timeout timer (`timer.unref()`) so pending timers do not block Node.js process exit, and cleans up both the timer and external `AbortSignal` listener in a `finally` block.

## Error Handling

- Non-2xx HTTP responses throw `Error('Dynatrace OTLP export failed with HTTP <status>')`.
- Timeouts abort the underlying `fetch` call with `Error('Dynatrace OTLP timed out')`.
- When used inside `@aldok10/nestjs-observe-error-tracking`, failed deliveries are handled by the runtime's retry and diagnostics policy.

## Performance Considerations

- Uses native Node.js `fetch` with a bounded default timeout (`3000` ms) and `timer.unref()`.
- Payload serialization builds a single OTLP `resourceLogs` JSON structure per event.

## Security Considerations

- Supply `apiToken` or `platformToken` via environment variables or secret managers; never hardcode tokens in source control.
- Configure redaction in `@aldok10/nestjs-observe-error-tracking` before events reach the adapter to avoid sending sensitive data in `exception.message`, `exception.stacktrace`, or `tag.*` attributes.

## Testing

Run the workspace test suite or target this package directly with Vitest:

```bash
pnpm test
pnpm exec vitest run packages/traces/error-tracking/adapter-dynatrace
```

## Troubleshooting

- **HTTP 401 / 403 from Dynatrace**: Verify your token has the `logs.ingest` scope and check whether `platformToken` (`Bearer`) or `apiToken` (`Api-Token`) is required for your environment.
- **No span correlation**: Ensure `@opentelemetry/api` is installed and an active span exists when `capture()` runs (or set `traceId`/`spanId` on the event).

## Limitations

- `breadcrumbs`, `fingerprinting`, `userContext`, `sessions`, and `profiling` are not supported (`false` in `capabilities`).
- Does not batch multiple events into a single HTTP request; each `capture()` call sends one OTLP log record.

## Related Packages

- [`@aldok10/nestjs-observe-error-tracking`](../error-tracking/README.md)
- [`@aldok10/nestjs-observe-error-tracking-testing`](../testing/README.md)
- [`@aldok10/nestjs-observe-core`](../../../core/README.md)
- [`@aldok10/nestjs-observe-tracing`](../../tracing/README.md)
- [`@aldok10/nestjs-observe`](../../../observer/observer/README.md)

## Documentation

- [Dynatrace Adapter Guide](../../../../docs/integrations/error-tracking-providers.md)
- [Error Tracking Overview](../../../../docs/packages/traces/error-tracking/README.md)
- [Installation Guide](../../../../docs/packages/traces/error-tracking/README.md)
- [Configuration Guide](../../../../docs/packages/traces/error-tracking/README.md)
- [Troubleshooting Guide](../../../../docs/operations/troubleshooting.md)

## Contributing

See [CONTRIBUTING.md](../../../../CONTRIBUTING.md).

## License

[MIT](../../../../LICENSE)
