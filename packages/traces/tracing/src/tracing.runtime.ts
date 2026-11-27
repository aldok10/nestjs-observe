import {
  BoundedExecution,
  NoopDiagnosticsSink,
  toSemanticResourceAttributes,
  type ComponentHealth,
  type DiagnosticsSink,
  type LifecycleParticipant,
} from '@aldok10/nestjs-observe-core';
import { context, trace, type Tracer } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  TracerProvider,
  type Sampler,
} from '@opentelemetry/sdk-trace';
import type { TracingOptions, TracingSamplingConfig } from './tracing.contracts.js';

function isSamplerInstance(value: Sampler | TracingSamplingConfig): value is Sampler {
  return 'shouldSample' in value && typeof value.shouldSample === 'function';
}

function resolveSampler(input: Sampler | TracingSamplingConfig | undefined): Sampler {
  if (input === undefined) return new ParentBasedSampler({ root: new AlwaysOnSampler() });
  if (isSamplerInstance(input)) return input;
  switch (input.strategy) {
    case 'always_on':
      return new AlwaysOnSampler();
    case 'always_off':
      return new AlwaysOffSampler();
    case 'ratio': {
      const ratioSampler = new TraceIdRatioBasedSampler(input.ratio);
      return input.parentBased === false
        ? ratioSampler
        : new ParentBasedSampler({ root: ratioSampler });
    }
    default:
      return new ParentBasedSampler({ root: new AlwaysOnSampler() });
  }
}

export class TracingRuntime implements LifecycleParticipant {
  readonly name = 'tracing';
  private readonly options: TracingOptions;
  private readonly diagnostics: DiagnosticsSink;
  private readonly boundedExecution = new BoundedExecution();
  private provider: TracerProvider | undefined;
  private contextManager: AsyncLocalStorageContextManager | undefined;
  private initialized = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(options: TracingOptions = {}) {
    this.options = options;
    this.diagnostics = options.diagnostics ?? new NoopDiagnosticsSink();
  }

  initialize(): void {
    if (this.initialized) {
      this.diagnostics.emit({
        domain: 'tracing',
        level: 'warn',
        message: 'TracingRuntime.initialize() called more than once; ignoring duplicate call',
      });
      return;
    }

    const resourceAttrs = toSemanticResourceAttributes(this.options.resource);
    const resource = resourceFromAttributes(resourceAttrs);
    const sampler = resolveSampler(this.options.sampler);
    const spanProcessors = [...(this.options.spanProcessors ?? [])];

    this.provider = new TracerProvider({
      resource,
      sampler,
      spanProcessors,
    });

    if (this.options.registerGlobal !== false) {
      const cm = new AsyncLocalStorageContextManager();
      cm.enable();
      this.contextManager = cm;
      context.setGlobalContextManager(cm);
      trace.setGlobalTracerProvider(this.provider);
    }

    this.initialized = true;
    this.diagnostics.emit({
      domain: 'tracing',
      level: 'info',
      message: 'TracingRuntime initialized',
    });
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getProvider(): TracerProvider {
    if (this.provider === undefined) {
      this.initialize();
    }
    if (this.provider === undefined) {
      throw new Error('TracingRuntime failed to initialize TracerProvider');
    }
    return this.provider;
  }

  getTracer(name = '@aldok10/nestjs-observe-tracing', version = '0.1.1'): Tracer {
    return this.getProvider().getTracer(name, version);
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
        domain: 'tracing',
        level: 'error',
        message: 'TracingRuntime shutdown error',
        error,
      });
      throw error;
    } finally {
      if (this.options.registerGlobal !== false) {
        trace.disable();
        context.disable();
      }
      this.contextManager?.disable();
      this.contextManager = undefined;
      this.initialized = false;
    }
  }
}

export function bootstrapTracing(options: TracingOptions = {}): TracingRuntime {
  const runtime = new TracingRuntime(options);
  runtime.initialize();
  return runtime;
}
