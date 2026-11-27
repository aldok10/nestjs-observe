# Log Transports and HTTP Request Logging

[`@aldok10/nestjs-observe-logger-transports`](../../packages/logs/transports/README.md) provides seven tree-shakeable log transports via subpath entrypoints. HTTP request logging for Express, Fastify, and NestJS lives in [`@aldok10/nestjs-observe-logger-http`](../../packages/logs/integration-http/README.md).

## Transports Overview

| Subpath           | Export                   | Default Formatter  | Delivery Model                                                         |
| ----------------- | ------------------------ | ------------------ | ---------------------------------------------------------------------- |
| `./console`       | `ConsoleTransport`       | `textFormatter`    | `stdout` / `stderr` (`warn`, `error`, `fatal` -> `stderr`)             |
| `./file`          | `StreamTransport`        | `jsonFormatter`    | File (`fs.createWriteStream` / `rotating-file-stream`) or `Writable`   |
| `./http`          | `HttpTransport`          | `defaultFormatter` | Buffered JSON array (`POST` / `PUT` / `PATCH`)                         |
| `./elasticsearch` | `ElasticsearchTransport` | `defaultFormatter` | Buffered NDJSON to `/_bulk`                                            |
| `./openobserve`   | `OpenObserveTransport`   | `defaultFormatter` | Buffered JSON array to `/api/<organization>/<stream>/_json`            |
| `./loki`          | `LokiTransport`          | `defaultFormatter` | Buffered Loki streams (gzip enabled by default) to `/loki/api/v1/push` |
| `./otlp`          | `OtlpLogTransport`       | `defaultFormatter` | Buffered OTLP/HTTP JSON (`ExportLogsServiceRequest`) to `/v1/logs`     |

All five remote transports extend `BufferedRemoteTransport` from [`@aldok10/nestjs-observe-logger-delivery`](../../packages/logs/delivery/README.md) and use Node.js `fetch` (`globalThis.fetch` by default, or a custom `fetchImpl`).

## Console (`./console`)

```ts
import { ConsoleTransport } from '@aldok10/nestjs-observe-logger-transports/console';

const transport = new ConsoleTransport({ color: true });
```

Options: `formatter`, `stdout`, `stderr`, `color` (default `false`), `onError`. `close()` flushes pending writes and detaches listeners without ending `process.stdout` or `process.stderr`.

## File and Rotation (`./file`)

`StreamTransport` supports either a file `path` (with `{pid}` placeholder substitution and recursive parent directory creation) or an existing `Writable` `stream`.

Enabling `rotation` requires the optional peer dependency `rotating-file-stream` (`^4.0.0`), loaded lazily only when `rotation` is configured:

```ts
import { StreamTransport } from '@aldok10/nestjs-observe-logger-transports/file';

const fileTransport = new StreamTransport({
  path: './logs/app-{pid}.log',
  rotation: { size: '10M', interval: '1d', maxFiles: 7, compress: true },
  mode: 0o600,
});
```

`close()` flushes pending writes (5000 ms timeout), ends owned file streams, and detaches error listeners.

## Buffered Remote Transports

All remote transports inherit `BufferedRemoteTransportOptions`:

- `queueCapacity` (default `1000`), `batchSize` (default `100`), `flushIntervalMs` (default `1000`)
- `overflow`: `'drop-oldest'` (default), `'drop-newest'`, `'block'`, or `'fail'`
- `maxRetries` (default `3`), `baseDelayMs` (default `100`), `timeoutMs` (default `5000`)
- `headers`, `fetchImpl`, `onError`, `onDeadLetter`
- Circuit breaker opens for `30_000` ms after `5` consecutive permanent batch failures

### HTTP (`./http`)

```ts
import { HttpTransport } from '@aldok10/nestjs-observe-logger-transports/http';

const http = new HttpTransport({
  endpoint: 'https://logs.example.com/ingest',
  method: 'POST',
  authorization: `Bearer ${process.env['LOG_TOKEN']}`,
});
```

### Elasticsearch (`./elasticsearch`)

Default `endpoint`: `'http://localhost:9200'`. Default `index`: `'logs-{level}-{environment}'` (supports `{level}` and `{environment}` placeholders). Supports `apiKey` (`Authorization: ApiKey <apiKey>`) or `authorization`.

```ts
import { ElasticsearchTransport } from '@aldok10/nestjs-observe-logger-transports/elasticsearch';

const es = new ElasticsearchTransport({
  endpoint: 'http://localhost:9200',
  index: 'app-{level}-{environment}',
  apiKey: process.env['ES_API_KEY'],
});
```

### OpenObserve (`./openobserve`)

Default `endpoint`: `'http://localhost:5080'`, `organization`: `'default'`, `stream`: `'logs'`. Supports Basic auth via `username`/`password` or `token`/`tokenName` (defaults to `'default'`).

```ts
import { OpenObserveTransport } from '@aldok10/nestjs-observe-logger-transports/openobserve';

const oo = new OpenObserveTransport({
  endpoint: 'http://localhost:5080',
  organization: 'default',
  stream: 'api-logs',
  username: 'root@example.com',
  password: process.env['OO_PASSWORD'],
});
```

### Grafana Loki (`./loki`)

Default `endpoint`: `'http://localhost:3100'`, `gzip`: `true`. Supports `tenantId` (`X-Scope-OrgID`), `authorization`, `extraLabels`, and `extraLabelAllowlist`.

`LokiTransport` promotes stable fields (`application`, `environment`, `service`, `level`, `region`, `instance`) to stream labels and places high-cardinality IDs (`requestId`, `traceId`, `spanId`, `correlationId`) into Loki structured metadata while blocking them from `extraLabels`.

```ts
import { LokiTransport } from '@aldok10/nestjs-observe-logger-transports/loki';

const loki = new LokiTransport({
  endpoint: 'http://localhost:3100',
  tenantId: 'tenant-1',
  extraLabels: { team: 'platform' },
});
```

### OTLP/HTTP (`./otlp`)

Default `endpoint`: `'http://localhost:4318'`, `path`: `'/v1/logs'`. Supports `serviceName`, `serviceVersion`, `environment`, `resourceAttributes`, `scopeName`, and `scopeVersion`.

Maps universal levels to OTLP `severityNumber` (`trace` -> `1`, `debug`/`verbose` -> `5`, `info`/`log` -> `9`, `warn` -> `13`, `error` -> `17`, `fatal` -> `21`) and extracts `traceId`/`spanId` onto each OTLP `logRecord`.

```ts
import { OtlpLogTransport } from '@aldok10/nestjs-observe-logger-transports/otlp';

const otlp = new OtlpLogTransport({
  endpoint: 'http://localhost:4318',
  serviceName: 'orders',
  environment: 'production',
});
```

## HTTP Request Logging

[`@aldok10/nestjs-observe-logger-http`](../../packages/logs/integration-http/README.md) provides inbound HTTP request logging with status-based severity, W3C `traceparent` / `x-request-id` / `x-correlation-id` extraction, route `include`/`exclude`, `sampleRate`, `slowRequestMs`, and header allowlisting (`DEFAULT_HEADER_ALLOWLIST`: `accept`, `content-type`, `user-agent`, `x-request-id`, `x-correlation-id`, `traceparent`).

Optional peer dependencies: `express` (`^4.0.0 || ^5.0.0`), `fastify` (`^4.0.0 || ^5.0.0`), `@nestjs/common` (`^10.0.0 || ^11.0.0 || ^12.0.0`), `rxjs` (`^7.0.0`).

- **Express**: `createExpressRequestLogger(options)` and `createExpressErrorLogger()`
- **Fastify**: `createFastifyHooks(options)` returning `{ onRequest, onResponse, onError }`
- **NestJS** (`@aldok10/nestjs-observe-logger-http/nestjs`): `NestHttpRequestLogger` / `createNestHttpRequestLogger(options)` (instruments `context.getType() === 'http'` only; loads `rxjs` lazily)

```ts
import { NestHttpRequestLogger } from '@aldok10/nestjs-observe-logger-http/nestjs';

const interceptor = new NestHttpRequestLogger({
  sink: (record) => pipeline.emit(record),
  exclude: ['/health'],
});
```
