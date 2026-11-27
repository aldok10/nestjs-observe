import {
  LifecycleCoordinator,
  NoopDiagnosticsSink,
  ObserveContextStore,
  OptionalPeerLoader,
  mergeResourceMetadata,
  type DiagnosticsSink,
  type LifecycleParticipant,
} from '@aldok10/nestjs-observe-core';
import type {
  ErrorEnricher,
  ErrorTrackingRuntime,
  ObserveErrorTracker,
} from '@aldok10/nestjs-observe-error-tracking';
import type {
  LogContext,
  LogTransport,
  LoggerManager,
  UniversalLogger,
} from '@aldok10/nestjs-observe-logger';
import type { MetricsRuntime, ObserveMetrics } from '@aldok10/nestjs-observe-metrics';
import type { ObserveTracer, TracingRuntime } from '@aldok10/nestjs-observe-tracing';
import type {
  ObserverErrorTrackingConfig,
  ObserverHealthReport,
  ObserverMetricsConfig,
  ObserverOptions,
  ObserverTracingConfig,
} from './observer.contracts.js';

interface PipelineLike {
  flush?(timeoutMs?: number): Promise<void>;
  close?(): Promise<void>;
}

interface TransportsExports {
  ConsoleTransport: new () => LogTransport;
}

function isTransportsExports(value: unknown): value is TransportsExports {
  return typeof value === 'object' && value !== null && 'ConsoleTransport' in value;
}

interface LoggerPackageExports {
  createLoggerManager(options: Record<string, unknown>): LoggerManager;
  UniversalLoggerImpl: new (options: Record<string, unknown>) => UniversalLogger;
  LogPipeline: new (options: Record<string, unknown>) => PipelineLike;
  LogContextStore: new (options?: { activeSpanProvider?: () => LogContext }) => {
    getContext(): LogContext;
    runWithContext<T>(context: LogContext, fn: () => T): T;
  };
}

interface TracingPackageExports {
  TracingRuntime: new (options?: ObserverTracingConfig) => TracingRuntime;
  ObserveTracer: new (runtime: TracingRuntime) => ObserveTracer;
}

interface MetricsPackageExports {
  MetricsRuntime: new (options?: ObserverMetricsConfig) => MetricsRuntime;
  ObserveMetrics: new (
    runtime: MetricsRuntime,
    cardinality?: ObserverMetricsConfig['cardinality'],
  ) => ObserveMetrics;
}

interface ErrorTrackingPackageExports {
  ErrorTrackingRuntime: new (options?: ObserverErrorTrackingConfig) => ErrorTrackingRuntime;
  ObserveErrorTracker: new (runtime: ErrorTrackingRuntime) => ObserveErrorTracker;
  createTraceContextEnricher?: (
    provider?: () => { traceId?: string; spanId?: string; traceFlags?: number } | undefined,
  ) => ErrorEnricher;
}

function isLoggerPkg(value: unknown): value is LoggerPackageExports {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createLoggerManager' in value &&
    'UniversalLoggerImpl' in value
  );
}

function isTracingPkg(value: unknown): value is TracingPackageExports {
  return (
    typeof value === 'object' &&
    value !== null &&
    'TracingRuntime' in value &&
    'ObserveTracer' in value
  );
}

function isMetricsPkg(value: unknown): value is MetricsPackageExports {
  return (
    typeof value === 'object' &&
    value !== null &&
    'MetricsRuntime' in value &&
    'ObserveMetrics' in value
  );
}

function isErrorTrackingPkg(value: unknown): value is ErrorTrackingPackageExports {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ErrorTrackingRuntime' in value &&
    'ObserveErrorTracker' in value
  );
}

function normalizeDomainConfig<T extends { readonly enabled?: boolean }>(
  value: boolean | T | undefined,
): Partial<T> | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return {};
  if (value.enabled === false) return undefined;
  return value;
}

export class ObserverRuntime {
  readonly contextStore = new ObserveContextStore();
  private readonly coordinator = new LifecycleCoordinator();
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private readonly diagnostics: DiagnosticsSink;
  private readonly options: ObserverOptions;

  private loggerInstance: UniversalLogger | undefined;
  private loggerManagerInstance: LoggerManager | undefined;
  private tracingRuntimeInstance: TracingRuntime | undefined;
  private tracerInstance: ObserveTracer | undefined;
  private metricsRuntimeInstance: MetricsRuntime | undefined;
  private metricsInstance: ObserveMetrics | undefined;
  private errorTrackingRuntimeInstance: ErrorTrackingRuntime | undefined;
  private errorTrackerInstance: ObserveErrorTracker | undefined;
  private initialized = false;

  constructor(options: ObserverOptions = {}) {
    this.options = options;
    this.diagnostics = options.diagnostics ?? new NoopDiagnosticsSink();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const tracingConfig = normalizeDomainConfig(this.options.tracing);
    const metricsConfig = normalizeDomainConfig(this.options.metrics);
    const loggerConfig = normalizeDomainConfig(this.options.logger);
    const errorTrackingConfig = normalizeDomainConfig(this.options.errorTracking);

    // 1. Tracing (if enabled)
    if (tracingConfig !== undefined) {
      const loaded = this.peerLoader.load('@aldok10/nestjs-observe-tracing', 'Observer tracing');
      if (!isTracingPkg(loaded)) {
        throw new Error('Invalid @aldok10/nestjs-observe-tracing package exports');
      }
      const mergedResource = mergeResourceMetadata(this.options.resource, tracingConfig.resource);
      const runtime = new loaded.TracingRuntime({
        ...tracingConfig,
        resource: mergedResource,
        diagnostics: tracingConfig.diagnostics ?? this.diagnostics,
        ...(this.options.shutdownTimeoutMs !== undefined &&
        tracingConfig.shutdownTimeoutMs === undefined
          ? { shutdownTimeoutMs: this.options.shutdownTimeoutMs }
          : {}),
      });
      this.tracingRuntimeInstance = runtime;
      this.tracerInstance = new loaded.ObserveTracer(runtime);
      this.coordinator.register(runtime);
    }

    // 2. Metrics (if enabled)
    if (metricsConfig !== undefined) {
      const loaded = this.peerLoader.load('@aldok10/nestjs-observe-metrics', 'Observer metrics');
      if (!isMetricsPkg(loaded)) {
        throw new Error('Invalid @aldok10/nestjs-observe-metrics package exports');
      }
      const mergedResource = mergeResourceMetadata(this.options.resource, metricsConfig.resource);
      const runtime = new loaded.MetricsRuntime({
        ...metricsConfig,
        resource: mergedResource,
        diagnostics: metricsConfig.diagnostics ?? this.diagnostics,
        ...(this.options.shutdownTimeoutMs !== undefined &&
        metricsConfig.shutdownTimeoutMs === undefined
          ? { shutdownTimeoutMs: this.options.shutdownTimeoutMs }
          : {}),
      });
      this.metricsRuntimeInstance = runtime;
      this.metricsInstance = new loaded.ObserveMetrics(runtime, metricsConfig.cardinality);
      this.coordinator.register(runtime);
    }

    // 3. Logger (if enabled) — optionally correlated with active span when Tracing is enabled
    if (loggerConfig !== undefined) {
      const loaded = this.peerLoader.load('@aldok10/nestjs-observe-logger', 'Observer logger');
      if (!isLoggerPkg(loaded)) {
        throw new Error('Invalid @aldok10/nestjs-observe-logger package exports');
      }
      const tracerRef = this.tracerInstance;
      const contextStore = new loaded.LogContextStore(
        tracerRef !== undefined ? { activeSpanProvider: () => tracerRef.getTraceContext() } : {},
      );
      const contextProvider =
        tracerRef !== undefined
          ? {
              getContext: (): LogContext => ({
                ...tracerRef.getTraceContext(),
                ...contextStore.getContext(),
              }),
              runWithContext: <T>(ctx: LogContext, fn: () => T): T =>
                contextStore.runWithContext(ctx, fn),
            }
          : contextStore;
      const resourceContext: LogContext = {
        ...(this.options.resource?.serviceName !== undefined
          ? { service: this.options.resource.serviceName }
          : {}),
        ...(this.options.resource?.environment !== undefined
          ? { environment: this.options.resource.environment }
          : {}),
        ...(this.options.resource?.application !== undefined
          ? { application: this.options.resource.application }
          : {}),
        ...(this.options.resource?.serviceInstanceId !== undefined
          ? { instanceId: this.options.resource.serviceInstanceId }
          : {}),
        ...loggerConfig.context,
      };

      let transports = loggerConfig.transports;
      if (transports === undefined || transports.length === 0) {
        const transportsMod = this.peerLoader.load(
          '@aldok10/nestjs-observe-logger/transports',
          'Observer default console transport',
        );
        if (!isTransportsExports(transportsMod)) {
          throw new Error('Invalid @aldok10/nestjs-observe-logger/transports exports');
        }
        transports = [new transportsMod.ConsoleTransport()];
      }

      const pipeline = new loaded.LogPipeline({
        transports,
        ...(loggerConfig.redaction !== undefined ? { redaction: loggerConfig.redaction } : {}),
        ...(loggerConfig.format !== undefined ? { format: loggerConfig.format } : {}),
      });

      const logger = new loaded.UniversalLoggerImpl({
        pipeline,
        context: contextProvider,
        baseContext: resourceContext,
        ...(loggerConfig.level !== undefined ? { level: loggerConfig.level } : {}),
      });

      this.loggerInstance = logger;

      const loggerParticipant: LifecycleParticipant = {
        name: 'logger',
        flush: async (timeoutMs) => {
          await pipeline.flush?.(timeoutMs);
        },
        shutdown: async () => {
          await pipeline.close?.();
        },
      };
      this.coordinator.register(loggerParticipant);
    }

    // 4. Error Tracking (if enabled) — optionally enriched with active trace context
    if (errorTrackingConfig !== undefined) {
      const loaded = this.peerLoader.load(
        '@aldok10/nestjs-observe-error-tracking',
        'Observer error tracking',
      );
      if (!isErrorTrackingPkg(loaded)) {
        throw new Error('Invalid @aldok10/nestjs-observe-error-tracking package exports');
      }
      const mergedResource = mergeResourceMetadata(
        this.options.resource,
        errorTrackingConfig.resource,
      );
      const tracerRef = this.tracerInstance;
      const traceEnricher =
        tracerRef !== undefined && loaded.createTraceContextEnricher !== undefined
          ? [loaded.createTraceContextEnricher(() => tracerRef.getTraceContext())]
          : [];
      const runtime = new loaded.ErrorTrackingRuntime({
        ...errorTrackingConfig,
        resource: mergedResource,
        enrichers: [...traceEnricher, ...(errorTrackingConfig.enrichers ?? [])],
        diagnostics: errorTrackingConfig.diagnostics ?? this.diagnostics,
        ...(this.options.shutdownTimeoutMs !== undefined &&
        errorTrackingConfig.shutdownTimeoutMs === undefined
          ? { shutdownTimeoutMs: this.options.shutdownTimeoutMs }
          : {}),
      });
      this.errorTrackingRuntimeInstance = runtime;
      this.errorTrackerInstance = new loaded.ObserveErrorTracker(runtime);
      this.coordinator.register(runtime);
    }

    await this.coordinator.initializeAll();
    this.initialized = true;
  }

  get logger(): UniversalLogger | undefined {
    return this.loggerInstance;
  }

  get loggerManager(): LoggerManager | undefined {
    return this.loggerManagerInstance;
  }

  get tracer(): ObserveTracer | undefined {
    return this.tracerInstance;
  }

  get tracingRuntime(): TracingRuntime | undefined {
    return this.tracingRuntimeInstance;
  }

  get metrics(): ObserveMetrics | undefined {
    return this.metricsInstance;
  }

  get metricsRuntime(): MetricsRuntime | undefined {
    return this.metricsRuntimeInstance;
  }

  get errorTracker(): ObserveErrorTracker | undefined {
    return this.errorTrackerInstance;
  }

  get errorTrackingRuntime(): ErrorTrackingRuntime | undefined {
    return this.errorTrackingRuntimeInstance;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async flush(timeoutMs?: number): Promise<void> {
    await this.coordinator.flush(timeoutMs ?? this.options.shutdownTimeoutMs);
  }

  async shutdown(timeoutMs?: number): Promise<void> {
    await this.coordinator.shutdown(timeoutMs ?? this.options.shutdownTimeoutMs);
    this.initialized = false;
  }

  async health(): Promise<ObserverHealthReport> {
    const components = await this.coordinator.health();
    const hasUnhealthy = components.some((c) => c.state === 'unhealthy');
    const hasDegraded = components.some((c) => c.state === 'degraded');
    const allStopped = components.length > 0 && components.every((c) => c.state === 'stopped');
    const status = hasUnhealthy
      ? 'unhealthy'
      : hasDegraded
        ? 'degraded'
        : allStopped
          ? 'stopped'
          : 'healthy';
    return { status, components };
  }
}
