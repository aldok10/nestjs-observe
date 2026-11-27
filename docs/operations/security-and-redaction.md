# Security & Redaction

## Log Redaction

Log records pass through [`RedactionEngine`](../../packages/logs/core/src/redaction/redaction-engine.ts) in `@aldok10/nestjs-observe-logger-core` before formatting and delivery. Default redaction rules are always active and cannot be disabled.

### Default Behavior

- **Default key patterns** (`DEFAULT_PATTERNS`, case-insensitive match):
  `password`, `authorization`, `accesstoken`, `refreshtoken`, `apikey`, `secret`, `clientsecret`, `cookie`, `session`, `privatekey`, `credentials`, `cardnumber`, `cvv`.
- **Replacement**: `'[REDACTED]'` (`DEFAULT_REPLACEMENT`).
- **Structural bounds**: `maxDepth: 6`, `maxKeys: 64`, `maxStringLength: 4096` (truncated with `'...[truncated]'`).
- **Fail-safe**: If a custom matcher or pattern throws during `redactRecord()`, `RedactionEngine` drops the raw record and emits a minimal error record with `message: replacement`.
- **Remote delivery**: `parseRecordFields()` in [`BufferedRemoteTransport`](../../packages/logs/delivery/src/buffered-remote.transport.ts) also runs `RedactionEngine.sanitize()` before constructing remote payloads.

### Advanced Redaction Matchers

[`@aldok10/nestjs-observe-logger-redaction`](../../packages/logs/redaction/src/index.ts) provides composable matchers for `RedactionOptions.matchers`:

- `fieldRedactor({ fields, mode })`: Substring match on leaf keys (`'deny'` masks listed keys; `'allow'` masks everything except listed keys).
- `regexRedactor(patterns)`: Masks keys or string values matching any `RegExp` (stateful `g`/`y` flags are stripped automatically).
- `headerRedactor({ allow, deny })`: Masks denied headers or any header outside `allow`.
- `queryRedactor({ params, allow })`: Masks sensitive query parameters by key or inside URL/query strings.
- `createAdvancedRedactor(options)`: Combines all four matchers into a single `RedactionMatcher[]` array.

## Error-Tracking Redaction

[`redactErrorEvent`](../../packages/traces/error-tracking/error-tracking/src/error-redactor.ts) sanitizes `ObserveErrorEvent` payloads (messages, stack traces, causes, aggregate errors, request URLs/headers/query/body, job data, database `querySummary`, attributes, vendor context, tags, and breadcrumbs):

- **Default denylist keys** (`DEFAULT_DENYLIST_KEYS`): `password`, `passwd`, `pwd`, `secret`, `token`, `accesstoken`, `access_token`, `refreshtoken`, `refresh_token`, `apikey`, `api_key`, `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `privatekey`, `private_key`, `connectionstring`, `connection_string`, `dsn`, `credential`, `credentials`, `ssn`, `creditcard`, `credit_card`, `x-api-key`, `x-auth-token`.
- **Inline secret patterns**: Masks credentials embedded in URLs (`scheme://user:pass@host` → `scheme://[REDACTED]@host`) and `Bearer` / `Basic` authorization tokens.
- **Bounds**: `maxDepth: 6`, `maxStringLength: 2048` (truncated with `'...[TRUNCATED]'`), circular reference protection (`'[Circular]'`).
- **Optional stack stripping**: Set `stripStackFrames: true` in `ErrorRedactionOptions` to omit `event.stack` from outbound events.

## Secret Handling, Headers & TLS

- **Credentials & tokens**: Never hardcode API keys, DSNs, or `Authorization` headers in source or committed config files; inject them at runtime via environment variables or `forRootAsync`.
- **Transport endpoints**: Use `https://` endpoints in production for `BufferedRemoteTransport` subclasses, OTLP exporters, and error-tracking adapters so `headers` (such as `Authorization` or `x-api-key`) and payloads are encrypted in transit.
- **Inbound HTTP logging**: Combine `headerRedactor` and `queryRedactor` with `RedactionOptions` so `Cookie`, `Authorization`, and signed URL tokens are masked before logs leave the process.

## Production Advisory Audit in CI

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs a dedicated `audit` job on every push and pull request:

```sh
pnpm install --prod --frozen-lockfile
pnpm audit --prod --json
```

CI fails if `metadata.vulnerabilities.total !== 0` across production dependencies. Run `pnpm audit --prod` locally when updating dependencies.
