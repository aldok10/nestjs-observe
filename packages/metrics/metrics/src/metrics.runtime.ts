import {
  BoundedExecution,
  NoopDiagnosticsSink,
  toSemanticResourceAttributes,
  type ComponentHealth,
  type DiagnosticsSink,
  type LifecycleParticipant,
} from '@aldok10/nestjs-observe-core';
import { metrics, type Meter } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import type { MetricsOptions } from './metrics.contracts.js';

export class MetricsRuntime implements LifecycleParticipant {
  readonly name = 'metrics';
  private readonly options: MetricsOptions;
  private readonly diagnostics: DiagnosticsSink;
  private readonly boundedExecution = new BoundedExecution();
  private provider: MeterProvider | undefined;
  private initialized = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(options: MetricsOptions = {}) {
    this.options = options;
    this.diagnostics = options.diagnostics ?? new NoopDiagnosticsSink();
  }

  initialize(): void {
    if (this.initialized) {
      this.diagnostics.emit({
        domain: 'metrics',
        level: 'warn',
        message: 'MetricsRuntime.initialize() called more than once; ignoring duplicate call',
      });
      return;
    }

    const resource = resourceFromAttributes(toSemanticResourceAttributes(this.options.resource));
    this.provider = new MeterProvider({
      resource,
      readers: [...(this.options.readers ?? [])],
      ...(this.options.views !== undefined ? { views: [...this.options.views] } : {}),
    });

    if (this.options.registerGlobal !== false) {
      metrics.setGlobalMeterProvider(this.provider);
    }

    this.initialized = true;
    this.diagnostics.emit({
      domain: 'metrics',
      level: 'info',
      message: 'MetricsRuntime initialized',
    });
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getProvider(): MeterProvider {
    if (this.provider === undefined) {
      this.initialize();
    }
    if (this.provider === undefined) {
      throw new Error('MetricsRuntime failed to initialize MeterProvider');
    }
    return this.provider;
  }

  getMeter(name = '@aldok10/nestjs-observe-metrics', version = '0.1.0'): Meter {
    return this.getProvider().getMeter(name, version);
  }

  async flush(timeoutMs?: number): Promise<void> {
    if (this.provider === undefined) return;
    await this.boundedExecution.run(
      this.provider.forceFlush(),
      timeoutMs ?? this.options.shutdownTimeoutMs,
    );
  }

  shutdown(timeoutMs?: number): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.shutdownPromise = this.teardown(timeoutMs ?? this.options.shutdownTimeoutMs);
    return this.shutdownPromise;
  }

  health(): ComponentHealth {
    return {
      name: this.name,
      state: this.initialized ? 'healthy' : 'stopped',
    };
  }

  private async teardown(timeoutMs?: number): Promise<void> {
    if (!this.initialized || this.provider === undefined) return;
    try {
      await this.boundedExecution.run(this.provider.shutdown(), timeoutMs);
    } catch (error: unknown) {
      this.diagnostics.emit({
        domain: 'metrics',
        level: 'error',
        message: 'MetricsRuntime shutdown error',
        error,
      });
      throw error;
    } finally {
      if (this.options.registerGlobal !== false) {
        metrics.disable();
      }
      this.initialized = false;
    }
  }
}

export function bootstrapMetrics(options: MetricsOptions = {}): MetricsRuntime {
  const runtime = new MetricsRuntime(options);
  runtime.initialize();
  return runtime;
}
