import type {
  ComponentHealth,
  DiagnosticsSink,
  ResourceMetadata,
} from '@aldok10/nestjs-observe-core';
import type { ErrorTrackingOptions } from '@aldok10/nestjs-observe-error-tracking';
import type { ObserveLoggerOptions } from '@aldok10/nestjs-observe-logger';
import type { MetricsOptions } from '@aldok10/nestjs-observe-metrics';
import type { TracingOptions } from '@aldok10/nestjs-observe-tracing';

export interface ObserverLoggerConfig extends ObserveLoggerOptions {
  readonly enabled?: boolean;
}

export interface ObserverTracingConfig extends TracingOptions {
  readonly enabled?: boolean;
}

export interface ObserverMetricsConfig extends MetricsOptions {
  readonly enabled?: boolean;
}

export interface ObserverErrorTrackingConfig extends ErrorTrackingOptions {
  readonly enabled?: boolean;
}

export interface ObserverOptions {
  readonly resource?: ResourceMetadata;
  readonly logger?: boolean | ObserverLoggerConfig;
  readonly tracing?: boolean | ObserverTracingConfig;
  readonly metrics?: boolean | ObserverMetricsConfig;
  readonly errorTracking?: boolean | ObserverErrorTrackingConfig;
  readonly shutdownTimeoutMs?: number;
  readonly diagnostics?: DiagnosticsSink;
  readonly global?: boolean;
}

export interface ObserverHealthReport {
  readonly status: 'healthy' | 'degraded' | 'unhealthy' | 'stopped';
  readonly components: readonly ComponentHealth[];
}
