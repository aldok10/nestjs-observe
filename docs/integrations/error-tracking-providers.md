# Error Tracking Providers

[`@aldok10/nestjs-observe-error-tracking`](../../packages/traces/error-tracking/error-tracking/README.md) routes normalized, redacted `ObserveErrorEvent`s to one or more `ErrorTrackingAdapter` destinations. Sixteen provider adapters are available.

## Sentry-Compatible Adapters

These adapters use `@sentry/node` (`^8.0.0 || ^9.0.0 || ^10.0.0`) as a peer dependency.

| Provider  | Package                                                                                                                | Factory / Class                                    | Verified Limitations                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sentry    | [`@aldok10/nestjs-observe-error-tracking-sentry`](../../packages/traces/error-tracking/adapter-sentry/README.md)       | `createSentryAdapter` / `SentryErrorAdapter`       | `capture()` requires `initialize()` to have run first when `client` is not passed in `options`. When `dsn` is omitted, `client.init()` is not called automatically. |
| GlitchTip | [`@aldok10/nestjs-observe-error-tracking-glitchtip`](../../packages/traces/error-tracking/adapter-glitchtip/README.md) | `createGlitchTipAdapter` / `GlitchTipErrorAdapter` | `sessions` and `profiling` capabilities are `false`. Breadcrumbs forwarded include `message`, `category`, and `level` (not `data` or `timestamp`).                  |
| Bugsink   | [`@aldok10/nestjs-observe-error-tracking-bugsink`](../../packages/traces/error-tracking/adapter-bugsink/README.md)     | `createBugsinkAdapter` / `BugsinkErrorAdapter`     | `transactions`, `sessions`, and `profiling` capabilities are `false`. Breadcrumbs forwarded include `message`, `category`, and `level` (not `data` or `timestamp`). |

## Dedicated SaaS Adapters

| Provider     | Package                                                                                                                    | Peer Dependency                            | Factory / Class                                        | Verified Limitations                                                                                                                                                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bugsnag      | [`@aldok10/nestjs-observe-error-tracking-bugsnag`](../../packages/traces/error-tracking/adapter-bugsnag/README.md)         | `@bugsnag/js` `^7.0.0 \|\| ^8.0.0`         | `createBugsnagAdapter` / `BugsnagErrorAdapter`         | Bugsnag's `notify` severity supports `'error' \| 'warning' \| 'info'`, so `'fatal'` maps to `'error'`. `transactions` and `profiling` are `false`. No `flush()` or `shutdown()` hooks.                                                                                                                                    |
| Rollbar      | [`@aldok10/nestjs-observe-error-tracking-rollbar`](../../packages/traces/error-tracking/adapter-rollbar/README.md)         | `rollbar` `^2.26.0 \|\| ^3.0.0`            | `createRollbarAdapter` / `RollbarErrorAdapter`         | `ROLLBAR_CAPABILITIES` advertises `breadcrumbs: true` and `userContext: true`, but `capture()` currently forwards `tags`, `trace`, `context`, `attributes`, and `fingerprint` in `custom` and does not forward `event.breadcrumbs` or `event.user`. `transactions`, `sessions`, `profiling` are `false`. No `shutdown()`. |
| Honeybadger  | [`@aldok10/nestjs-observe-error-tracking-honeybadger`](../../packages/traces/error-tracking/adapter-honeybadger/README.md) | `@honeybadger-io/js` `^5.0.0 \|\| ^6.0.0`  | `createHoneybadgerAdapter` / `HoneybadgerErrorAdapter` | `user` context forwards `user_id` and `user_email` into `notice.context` (`username` and `ipAddress` are not mapped). `transactions`, `sessions`, `profiling` are `false`. No `flush()` or `shutdown()`.                                                                                                                  |
| Highlight.io | [`@aldok10/nestjs-observe-error-tracking-highlight`](../../packages/traces/error-tracking/adapter-highlight/README.md)     | `@highlight-run/node` `^3.0.0 \|\| ^4.0.0` | `createHighlightAdapter` / `HighlightErrorAdapter`     | `messages`, `breadcrumbs`, `fingerprinting`, `userContext`, and `profiling` capabilities are `false`.                                                                                                                                                                                                                     |
| Airbrake     | [`@aldok10/nestjs-observe-error-tracking-airbrake`](../../packages/traces/error-tracking/adapter-airbrake/README.md)       | `@airbrake/node` `^2.0.0 \|\| ^3.0.0`      | `createAirbrakeAdapter` / `AirbrakeErrorAdapter`       | `breadcrumbs`, `fingerprinting`, `transactions`, `sessions`, and `profiling` are `false`. Does not implement `flush()` separately from `shutdown()`.                                                                                                                                                                      |
| Raygun       | [`@aldok10/nestjs-observe-error-tracking-raygun`](../../packages/traces/error-tracking/adapter-raygun/README.md)           | `raygun` `^0.14.0 \|\| ^1.0.0`             | `createRaygunAdapter` / `RaygunErrorAdapter`           | `breadcrumbs`, `fingerprinting`, `transactions`, `sessions`, and `profiling` are `false`. Does not implement `flush()` separately from `shutdown()`.                                                                                                                                                                      |

## OpenTelemetry OTLP Adapter

| Provider | Package                                                                                                      | Peer Dependency                | Factory / Class                               | Verified Limitations                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OTLP     | [`@aldok10/nestjs-observe-error-tracking-otlp`](../../packages/traces/error-tracking/adapter-otlp/README.md) | `@opentelemetry/api` `^1.10.0` | `createOtlpErrorAdapter` / `OtlpErrorAdapter` | Uses OTLP/HTTP JSON (`content-type: application/json`) rather than OTLP/gRPC or Protobuf. `breadcrumbs`, `fingerprinting`, `userContext`, `transactions`, `sessions`, and `profiling` are `false`. |

## APM Agent Adapters

| Provider    | Package                                                                                                                    | Peer Dependency                                                     | Factory / Class                                        | Verified Limitations                                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New Relic   | [`@aldok10/nestjs-observe-error-tracking-new-relic`](../../packages/traces/error-tracking/adapter-new-relic/README.md)     | `newrelic` `^11.0.0 \|\| ^12.0.0`                                   | `createNewRelicAdapter` / `NewRelicErrorAdapter`       | `breadcrumbs`, `fingerprinting`, `userContext`, `sessions`, and `profiling` are `false`. `NewRelicAgentLike.addCustomAttributes` is declared for structural compatibility, but `capture()` only calls `noticeError()`. |
| Datadog     | [`@aldok10/nestjs-observe-error-tracking-datadog`](../../packages/traces/error-tracking/adapter-datadog/README.md)         | `dd-trace` `^4.0.0 \|\| ^5.0.0`                                     | `createDatadogAdapter` / `DatadogErrorAdapter`         | `breadcrumbs`, `fingerprinting`, `sessions`, and `profiling` are `false`. Does not implement `flush()` or `shutdown()`.                                                                                                |
| Dynatrace   | [`@aldok10/nestjs-observe-error-tracking-dynatrace`](../../packages/traces/error-tracking/adapter-dynatrace/README.md)     | `@opentelemetry/api` `^1.10.0`                                      | `createDynatraceAdapter` / `DynatraceErrorAdapter`     | `breadcrumbs`, `fingerprinting`, `userContext`, `sessions`, and `profiling` are `false`. Does not batch multiple events into a single HTTP request; each `capture()` sends one OTLP log record.                        |
| Elastic APM | [`@aldok10/nestjs-observe-error-tracking-elastic-apm`](../../packages/traces/error-tracking/adapter-elastic-apm/README.md) | `elastic-apm-node` `^4.0.0`                                         | `createElasticApmAdapter` / `ElasticApmErrorAdapter`   | `breadcrumbs`, `fingerprinting`, `sessions`, and `profiling` are `false`. Does not implement `shutdown()`.                                                                                                             |
| Splunk      | [`@aldok10/nestjs-observe-error-tracking-splunk`](../../packages/traces/error-tracking/adapter-splunk/README.md)           | `@opentelemetry/api` `^1.10.0`, `@splunk/otel` `^2.0.0 \|\| ^3.0.0` | `createSplunkAdapter` / `SplunkErrorAdapter`           | `breadcrumbs`, `fingerprinting`, `userContext`, `sessions`, and `profiling` are `false`. Does not batch multiple events into a single HTTP request; each `capture()` sends one OTLP log record.                        |
| AppDynamics | [`@aldok10/nestjs-observe-error-tracking-appdynamics`](../../packages/traces/error-tracking/adapter-appdynamics/README.md) | `appdynamics` `^23.0.0 \|\| ^24.0.0`                                | `createAppDynamicsAdapter` / `AppDynamicsErrorAdapter` | `messages`, `breadcrumbs`, `fingerprinting`, `userContext`, `sessions`, and `profiling` are `false`. Does not implement `flush()` or `shutdown()`.                                                                     |

## Minimal Setup Example

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
          adapter: createSentryAdapter({
            dsn: process.env['SENTRY_DSN'] ?? '',
          }),
        },
      ],
    }),
  ],
})
export class AppModule {}
```
