import {
  BoundedExecution,
  NoopDiagnosticsSink,
  type ComponentHealth,
  type DiagnosticsSink,
  type LifecycleParticipant,
} from '@aldok10/nestjs-observe-core';
import { createApplicationEnricher, runEnrichers } from './enrichers.js';
import { normalizeError, normalizeMessageEvent } from './error-normalizer.js';
import { ErrorDeduplicator, matchesErrorFilter, shouldSampleEvent } from './error-pipeline.js';
import { redactErrorEvent } from './error-redactor.js';
import type {
  CaptureErrorInput,
  ErrorBreadcrumb,
  ErrorDeliveryPolicy,
  ErrorDestinationConfig,
  ErrorDestinationDiagnostics,
  ErrorEnricher,
  ErrorTrackingDiagnosticsReport,
  ErrorTrackingOptions,
  ObserveErrorEvent,
} from './error-tracking.contracts.js';

interface DestinationState {
  readonly config: ErrorDestinationConfig;
  readonly policy: Required<ErrorDeliveryPolicy>;
  readonly queue: ObserveErrorEvent[];
  initialized: boolean;
  initError?: string | undefined;
  sentCount: number;
  droppedCount: number;
  failedCount: number;
  retryCount: number;
  lastSuccessAt?: Date | undefined;
  lastFailureAt?: Date | undefined;
  lastError?: string | undefined;
  lastLatencyMs?: number | undefined;
  inFlight: number;
}

const DEFAULT_DELIVERY: Required<ErrorDeliveryPolicy> = {
  maxQueueSize: 500,
  overflowPolicy: 'drop-oldest',
  maxRetries: 1,
  retryDelayMs: 100,
  timeoutMs: 3000,
  maxConcurrent: 8,
};

function resolvePolicy(
  globalPolicy: ErrorDeliveryPolicy | undefined,
  destPolicy: ErrorDeliveryPolicy | undefined,
  deliveryMode: string,
): Required<ErrorDeliveryPolicy> {
  const defaultRetries = deliveryMode === 'sdk-managed' ? 0 : DEFAULT_DELIVERY.maxRetries;
  return {
    maxQueueSize:
      destPolicy?.maxQueueSize ?? globalPolicy?.maxQueueSize ?? DEFAULT_DELIVERY.maxQueueSize,
    overflowPolicy:
      destPolicy?.overflowPolicy ?? globalPolicy?.overflowPolicy ?? DEFAULT_DELIVERY.overflowPolicy,
    maxRetries: destPolicy?.maxRetries ?? globalPolicy?.maxRetries ?? defaultRetries,
    retryDelayMs:
      destPolicy?.retryDelayMs ?? globalPolicy?.retryDelayMs ?? DEFAULT_DELIVERY.retryDelayMs,
    timeoutMs: destPolicy?.timeoutMs ?? globalPolicy?.timeoutMs ?? DEFAULT_DELIVERY.timeoutMs,
    maxConcurrent:
      destPolicy?.maxConcurrent ?? globalPolicy?.maxConcurrent ?? DEFAULT_DELIVERY.maxConcurrent,
  };
}

export class ErrorTrackingRuntime implements LifecycleParticipant {
  readonly name = 'error-tracking';
  private readonly options: ErrorTrackingOptions;
  private readonly diagnostics: DiagnosticsSink;
  private readonly deduplicator: ErrorDeduplicator;
  private readonly enrichers: readonly ErrorEnricher[];
  private readonly destinations: DestinationState[];
  private readonly breadcrumbs: ErrorBreadcrumb[] = [];
  private readonly maxBreadcrumbs: number;
  private readonly bounded = new BoundedExecution();
  private initialized = false;
  private shuttingDown = false;
  private totalCaptured = 0;
  private totalDeduplicated = 0;
  private totalFiltered = 0;
  private totalSampledOut = 0;

  constructor(options: ErrorTrackingOptions = {}) {
    this.options = options;
    this.diagnostics = options.diagnostics ?? new NoopDiagnosticsSink();
    this.deduplicator = new ErrorDeduplicator(options.deduplication);
    this.maxBreadcrumbs = options.maxBreadcrumbs ?? 50;

    const baseEnrichers: ErrorEnricher[] = [];
    if (options.resource !== undefined) {
      baseEnrichers.push(createApplicationEnricher(options.resource));
    }
    this.enrichers = [...baseEnrichers, ...(options.enrichers ?? [])];

    this.destinations = (options.destinations ?? []).map((config) => ({
      config,
      policy: resolvePolicy(
        options.delivery,
        config.delivery,
        config.adapter.capabilities.deliveryMode,
      ),
      queue: [],
      initialized: false,
      sentCount: 0,
      droppedCount: 0,
      failedCount: 0,
      retryCount: 0,
      inFlight: 0,
    }));
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.shuttingDown = false;

    await Promise.allSettled(
      this.destinations.map(async (dest) => {
        if (dest.config.enabled === false) return;
        try {
          await dest.config.adapter.initialize?.();
          dest.initialized = true;
          dest.initError = undefined;
        } catch (error: unknown) {
          dest.initialized = false;
          dest.initError = error instanceof Error ? error.message : String(error);
          this.diagnostics.emit({
            domain: 'error-tracking',
            level: 'error',
            message: `adapter "${dest.config.name}" failed to initialize`,
            error,
          });
        }
      }),
    );

    this.initialized = true;
  }

  addBreadcrumb(
    breadcrumb: Omit<ErrorBreadcrumb, 'timestamp'> & { readonly timestamp?: Date },
  ): void {
    if (this.maxBreadcrumbs <= 0) return;
    if (this.breadcrumbs.length >= this.maxBreadcrumbs) {
      this.breadcrumbs.shift();
    }
    this.breadcrumbs.push({
      ...breadcrumb,
      timestamp: breadcrumb.timestamp ?? new Date(),
    });
  }

  getBreadcrumbs(): readonly ErrorBreadcrumb[] {
    return [...this.breadcrumbs];
  }

  async captureException(
    exception: unknown,
    input: CaptureErrorInput = {},
  ): Promise<string | undefined> {
    const raw = normalizeError(exception, input);
    return await this.processEvent(raw);
  }

  async captureMessage(
    message: string,
    input: CaptureErrorInput = {},
  ): Promise<string | undefined> {
    const raw = normalizeMessageEvent(message, input);
    return await this.processEvent(raw);
  }

  private async processEvent(raw: ObserveErrorEvent): Promise<string | undefined> {
    if (!this.initialized) {
      await this.initialize();
    }

    const withBreadcrumbs: ObserveErrorEvent =
      this.breadcrumbs.length > 0 ? { ...raw, breadcrumbs: [...this.breadcrumbs] } : raw;

    const enriched = await runEnrichers(withBreadcrumbs, this.enrichers);

    if (!matchesErrorFilter(enriched, this.options.filter)) {
      this.totalFiltered += 1;
      return undefined;
    }

    if (this.deduplicator.isDuplicate(enriched)) {
      this.totalDeduplicated += 1;
      return undefined;
    }

    if (!shouldSampleEvent(enriched, this.options.sampling)) {
      this.totalSampledOut += 1;
      return undefined;
    }

    const sanitized = redactErrorEvent(enriched, this.options.redaction);
    this.totalCaptured += 1;

    await Promise.allSettled(
      this.destinations.map(async (dest) => {
        await this.dispatchToDestination(dest, sanitized);
      }),
    );

    return sanitized.id;
  }

  private async dispatchToDestination(
    dest: DestinationState,
    event: ObserveErrorEvent,
  ): Promise<void> {
    if (dest.config.enabled === false) return;
    if (!dest.initialized && dest.initError !== undefined) return;
    if (!matchesErrorFilter(event, dest.config.filter)) return;
    if (
      dest.config.sampleRate !== undefined &&
      !shouldSampleEvent(event, { rate: dest.config.sampleRate })
    ) {
      return;
    }

    if (dest.inFlight >= dest.policy.maxConcurrent) {
      if (dest.queue.length >= dest.policy.maxQueueSize) {
        if (dest.policy.overflowPolicy === 'drop-newest') {
          dest.droppedCount += 1;
          return;
        }
        dest.queue.shift();
        dest.droppedCount += 1;
      }
      dest.queue.push(event);
      return;
    }

    await this.deliverWithRetry(dest, event);
    await this.drainDestinationQueue(dest);
  }

  private async drainDestinationQueue(dest: DestinationState): Promise<void> {
    if (dest.queue.length === 0 || dest.inFlight >= dest.policy.maxConcurrent) return;
    const next = dest.queue.shift();
    if (next === undefined) return;
    await this.deliverWithRetry(dest, next);
    await this.drainDestinationQueue(dest);
  }

  private async deliverWithRetry(dest: DestinationState, event: ObserveErrorEvent): Promise<void> {
    dest.inFlight += 1;
    const start = Date.now();
    try {
      await this.attemptDelivery(dest, event, start, 0);
    } finally {
      dest.inFlight -= 1;
    }
  }

  private async attemptDelivery(
    dest: DestinationState,
    event: ObserveErrorEvent,
    start: number,
    attempt: number,
  ): Promise<void> {
    const controller = new AbortController();
    try {
      await this.bounded.run(
        Promise.resolve(dest.config.adapter.capture(event, controller.signal)),
        dest.policy.timeoutMs,
      );
      dest.sentCount += 1;
      dest.lastSuccessAt = new Date();
      dest.lastLatencyMs = Date.now() - start;
      dest.lastError = undefined;
    } catch (error: unknown) {
      controller.abort(error);
      if (attempt < dest.policy.maxRetries && !this.shuttingDown) {
        dest.retryCount += 1;
        await delay(dest.policy.retryDelayMs * (attempt + 1));
        await this.attemptDelivery(dest, event, start, attempt + 1);
        return;
      }
      dest.failedCount += 1;
      dest.lastFailureAt = new Date();
      dest.lastLatencyMs = Date.now() - start;
      dest.lastError = error instanceof Error ? error.message : String(error);
      this.diagnostics.emit({
        domain: 'error-tracking',
        level: 'error',
        message: `delivery failed for "${dest.config.name}"`,
        error,
      });
    }
  }

  async flush(timeoutMs: number = this.options.shutdownTimeoutMs ?? 3000): Promise<void> {
    await Promise.allSettled(
      this.destinations.map(async (dest) => {
        if (dest.config.enabled === false) return;
        await this.drainDestinationQueue(dest);
        try {
          await dest.config.adapter.flush?.(timeoutMs);
        } catch (error: unknown) {
          this.diagnostics.emit({
            domain: 'error-tracking',
            level: 'warn',
            message: `flush failed for "${dest.config.name}"`,
            error,
          });
        }
      }),
    );
  }

  async shutdown(timeoutMs: number = this.options.shutdownTimeoutMs ?? 3000): Promise<void> {
    this.shuttingDown = true;
    await this.flush(timeoutMs);
    await Promise.allSettled(
      this.destinations.map(async (dest) => {
        if (dest.config.enabled === false) return;
        try {
          await dest.config.adapter.shutdown?.(timeoutMs);
        } catch (error: unknown) {
          this.diagnostics.emit({
            domain: 'error-tracking',
            level: 'warn',
            message: `shutdown failed for "${dest.config.name}"`,
            error,
          });
        } finally {
          dest.initialized = false;
        }
      }),
    );
    this.initialized = false;
  }

  async health(): Promise<ComponentHealth> {
    const report = await this.getDiagnostics();
    return {
      name: this.name,
      state: report.status,
      details: {
        totalCaptured: report.totalCaptured,
        totalDeduplicated: report.totalDeduplicated,
        destinations: report.destinations.map((d) => ({
          name: d.name,
          available: d.available,
          sentCount: d.sentCount,
          failedCount: d.failedCount,
          droppedCount: d.droppedCount,
        })),
      },
    };
  }

  async getDiagnostics(): Promise<ErrorTrackingDiagnosticsReport> {
    const destinationReports: ErrorDestinationDiagnostics[] = await Promise.all(
      this.destinations.map(async (dest) => {
        let adapterHealthy = dest.initError === undefined;
        if (dest.config.adapter.health !== undefined) {
          try {
            const h = await dest.config.adapter.health();
            adapterHealthy = h.state === 'healthy' || h.state === 'degraded';
          } catch {
            adapterHealthy = false;
          }
        }
        const available = dest.config.enabled !== false && dest.initialized && adapterHealthy;
        return {
          name: dest.config.name,
          enabled: dest.config.enabled !== false,
          initialized: dest.initialized,
          available,
          deliveryMode: dest.config.adapter.capabilities.deliveryMode,
          capabilities: dest.config.adapter.capabilities,
          queueDepth: dest.queue.length,
          sentCount: dest.sentCount,
          droppedCount: dest.droppedCount,
          failedCount: dest.failedCount,
          retryCount: dest.retryCount,
          ...(dest.lastSuccessAt !== undefined ? { lastSuccessAt: dest.lastSuccessAt } : {}),
          ...(dest.lastFailureAt !== undefined ? { lastFailureAt: dest.lastFailureAt } : {}),
          ...(dest.lastError !== undefined ? { lastError: dest.lastError } : {}),
          ...(dest.lastLatencyMs !== undefined ? { lastLatencyMs: dest.lastLatencyMs } : {}),
          ...(dest.initError !== undefined ? { initError: dest.initError } : {}),
        };
      }),
    );

    const enabled = destinationReports.filter((d) => d.enabled);
    const anyFailed = enabled.some((d) => !d.available || d.failedCount > 0 || d.droppedCount > 0);
    const allUnavailable = enabled.length > 0 && enabled.every((d) => !d.available);

    const status = !this.initialized
      ? 'stopped'
      : allUnavailable
        ? 'unhealthy'
        : anyFailed
          ? 'degraded'
          : 'healthy';

    return {
      status,
      totalCaptured: this.totalCaptured,
      totalDeduplicated: this.totalDeduplicated,
      totalFiltered: this.totalFiltered,
      totalSampledOut: this.totalSampledOut,
      destinations: destinationReports,
    };
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}
