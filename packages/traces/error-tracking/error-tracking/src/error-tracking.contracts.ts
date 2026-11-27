import type {
  ComponentHealth,
  DiagnosticsSink,
  ResourceMetadata,
} from '@aldok10/nestjs-observe-core';

export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';

export type ErrorDeliveryMode = 'sdk-managed' | 'core-managed' | 'direct-http';

export interface ErrorCauseInfo {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly code?: string | number;
}

export interface ErrorSourceContext {
  readonly component?: string;
  readonly operation?: string;
  readonly module?: string;
}

export interface ErrorExecutionContext {
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly tenantId?: string;
  readonly jobId?: string;
  readonly workerId?: string;
}

export interface ErrorTraceContext {
  readonly traceId?: string;
  readonly spanId?: string;
  readonly traceFlags?: number;
}

export interface ErrorUserContext {
  readonly id?: string;
  readonly username?: string;
  readonly email?: string;
  readonly ipAddress?: string;
}

export interface ErrorBreadcrumb {
  readonly timestamp: Date;
  readonly message: string;
  readonly category?: string;
  readonly level?: ErrorSeverity;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface ErrorRequestContext {
  readonly method?: string;
  readonly url?: string;
  readonly route?: string;
  readonly statusCode?: number;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
  readonly ip?: string;
}

export interface ErrorJobContext {
  readonly queueName?: string;
  readonly jobId?: string;
  readonly workerName?: string;
  readonly operation?: string;
  readonly attemptsMade?: number;
  readonly maxAttempts?: number;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface ErrorDatabaseContext {
  readonly system: 'postgresql' | 'mysql' | 'mongodb' | 'redis' | (string & {});
  readonly operation?: string;
  readonly durationMs?: number;
  readonly pool?: string;
  readonly errorCode?: string | number;
  readonly querySummary?: string;
}

export interface ObserveErrorEvent {
  readonly id: string;
  readonly timestamp: Date;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly causes?: readonly ErrorCauseInfo[];
  readonly aggregateErrors?: readonly ErrorCauseInfo[];
  readonly severity: ErrorSeverity;
  readonly handled: boolean;
  readonly release?: string;
  readonly environment?: string;
  readonly deployment?: string;
  readonly serviceName?: string;
  readonly hostname?: string;
  readonly instanceId?: string;
  readonly source?: ErrorSourceContext;
  readonly context?: ErrorExecutionContext;
  readonly trace?: ErrorTraceContext;
  readonly user?: ErrorUserContext;
  readonly request?: ErrorRequestContext;
  readonly job?: ErrorJobContext;
  readonly database?: ErrorDatabaseContext;
  readonly breadcrumbs?: readonly ErrorBreadcrumb[];
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly tags?: Readonly<Record<string, string>>;
  readonly fingerprint?: readonly string[];
  readonly vendorContext?: Readonly<Record<string, unknown>>;
  readonly exception?: unknown;
}

export interface ErrorAdapterCapabilities {
  readonly exceptions: boolean;
  readonly messages: boolean;
  readonly breadcrumbs: boolean;
  readonly fingerprinting: boolean;
  readonly tags: boolean;
  readonly userContext: boolean;
  readonly traceCorrelation: boolean;
  readonly transactions: boolean;
  readonly sessions: boolean;
  readonly profiling: boolean;
  readonly deliveryMode: ErrorDeliveryMode;
}

export interface ErrorTrackingAdapter {
  readonly name: string;
  readonly capabilities: ErrorAdapterCapabilities;
  initialize?(): Promise<void> | void;
  capture(event: ObserveErrorEvent, signal?: AbortSignal): Promise<void> | void;
  flush?(timeoutMs?: number): Promise<void>;
  shutdown?(timeoutMs?: number): Promise<void>;
  health?(): ComponentHealth | Promise<ComponentHealth>;
}

export interface ErrorEnricher {
  readonly name: string;
  enrich(
    event: ObserveErrorEvent,
  ): Partial<ObserveErrorEvent> | Promise<Partial<ObserveErrorEvent>> | void;
}

export interface ErrorFilterOptions {
  readonly minSeverity?: ErrorSeverity;
  readonly ignoreErrors?: readonly (string | RegExp)[];
  readonly environments?: readonly string[];
  readonly modules?: readonly string[];
  readonly predicate?: (event: ObserveErrorEvent) => boolean;
}

export type ErrorFilter = ErrorFilterOptions | ((event: ObserveErrorEvent) => boolean);

export interface ErrorRedactionOptions {
  readonly enabled?: boolean;
  readonly replacement?: string;
  readonly denylistKeys?: readonly string[];
  readonly allowlistKeys?: readonly string[];
  readonly maxDepth?: number;
  readonly maxStringLength?: number;
  readonly stripStackFrames?: boolean;
}

export interface ErrorSamplingOptions {
  readonly rate?: number;
  readonly sampleFatal?: boolean;
  readonly random?: () => number;
}

export interface ErrorDeduplicationOptions {
  readonly enabled?: boolean;
  readonly windowMs?: number;
  readonly maxEntries?: number;
}

export interface ErrorDeliveryPolicy {
  readonly maxQueueSize?: number;
  readonly overflowPolicy?: 'drop-newest' | 'drop-oldest';
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly timeoutMs?: number;
  readonly maxConcurrent?: number;
}

export interface ErrorDestinationConfig {
  readonly name: string;
  readonly adapter: ErrorTrackingAdapter;
  readonly enabled?: boolean;
  readonly filter?: ErrorFilter;
  readonly sampleRate?: number;
  readonly delivery?: ErrorDeliveryPolicy;
}

export interface ErrorDestinationDiagnostics {
  readonly name: string;
  readonly enabled: boolean;
  readonly initialized: boolean;
  readonly available: boolean;
  readonly deliveryMode: ErrorDeliveryMode;
  readonly capabilities: ErrorAdapterCapabilities;
  readonly queueDepth: number;
  readonly sentCount: number;
  readonly droppedCount: number;
  readonly failedCount: number;
  readonly retryCount: number;
  readonly lastSuccessAt?: Date;
  readonly lastFailureAt?: Date;
  readonly lastError?: string;
  readonly lastLatencyMs?: number;
  readonly initError?: string;
}

export interface ErrorTrackingDiagnosticsReport {
  readonly status: 'healthy' | 'degraded' | 'unhealthy' | 'stopped';
  readonly totalCaptured: number;
  readonly totalDeduplicated: number;
  readonly totalFiltered: number;
  readonly totalSampledOut: number;
  readonly destinations: readonly ErrorDestinationDiagnostics[];
}

export interface ErrorTrackingOptions {
  readonly resource?: ResourceMetadata;
  readonly destinations?: readonly ErrorDestinationConfig[];
  readonly enrichers?: readonly ErrorEnricher[];
  readonly filter?: ErrorFilter;
  readonly redaction?: ErrorRedactionOptions;
  readonly sampling?: ErrorSamplingOptions;
  readonly deduplication?: ErrorDeduplicationOptions;
  readonly delivery?: ErrorDeliveryPolicy;
  readonly maxBreadcrumbs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly diagnostics?: DiagnosticsSink;
  readonly global?: boolean;
}

export interface CaptureErrorInput {
  readonly severity?: ErrorSeverity;
  readonly handled?: boolean;
  readonly source?: ErrorSourceContext;
  readonly context?: ErrorExecutionContext;
  readonly trace?: ErrorTraceContext;
  readonly user?: ErrorUserContext;
  readonly request?: ErrorRequestContext;
  readonly job?: ErrorJobContext;
  readonly database?: ErrorDatabaseContext;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly tags?: Readonly<Record<string, string>>;
  readonly fingerprint?: readonly string[];
  readonly vendorContext?: Readonly<Record<string, unknown>>;
}
