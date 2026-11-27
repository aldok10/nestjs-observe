import 'reflect-metadata';
import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type InjectionToken,
  type ModuleMetadata,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type Provider,
  type Type,
} from '@nestjs/common';
import { InvalidConfigurationException } from '@aldok10/nestjs-observe-core';
import { ObserveTracer } from './observe-tracer.service.js';
import type { TracingOptions } from './tracing.contracts.js';
import { TracingInterceptor } from './tracing.interceptor.js';
import { TracingRuntime } from './tracing.runtime.js';

export const TRACING_OPTIONS = Symbol.for('observe.tracing.options');
export const TRACING_RUNTIME = Symbol.for('observe.tracing.runtime');
export const OBSERVE_TRACER = ObserveTracer;

export interface TracingOptionsFactory {
  createTracingOptions(): TracingOptions | Promise<TracingOptions>;
}

export interface TracingAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  readonly inject?: readonly InjectionToken[];
  readonly global?: boolean;
  readonly useFactory?: (...args: readonly unknown[]) => TracingOptions | Promise<TracingOptions>;
  readonly useClass?: Type<TracingOptionsFactory>;
  readonly useExisting?: InjectionToken;
}

const TRACING_OPTIONS_FACTORY = Symbol.for('observe.tracing.options_factory');

export class TracingLifecycleService implements OnModuleDestroy, OnApplicationShutdown {
  private shutdownPromise: Promise<void> | undefined;

  constructor(private readonly runtime: TracingRuntime) {}

  onModuleDestroy(): Promise<void> {
    return this.shutdownOnce();
  }

  onApplicationShutdown(): Promise<void> {
    return this.shutdownOnce();
  }

  private shutdownOnce(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.shutdownPromise = this.runtime.shutdown();
    return this.shutdownPromise;
  }
}

Injectable()(TracingLifecycleService);
Inject(TRACING_RUNTIME)(TracingLifecycleService, undefined, 0);

function buildTracingModule(
  optionsProvider: Provider,
  imports: NonNullable<ModuleMetadata['imports']>,
  extraProviders: readonly Provider[],
  isGlobal: boolean,
): DynamicModule {
  const providers: Provider[] = [
    optionsProvider,
    ...extraProviders,
    {
      provide: TRACING_RUNTIME,
      useFactory: (options: TracingOptions): TracingRuntime => {
        const runtime = new TracingRuntime(options);
        runtime.initialize();
        return runtime;
      },
      inject: [TRACING_OPTIONS],
    },
    {
      provide: ObserveTracer,
      useFactory: (runtime: TracingRuntime): ObserveTracer => new ObserveTracer(runtime),
      inject: [TRACING_RUNTIME],
    },
    TracingInterceptor,
    TracingLifecycleService,
  ];

  return {
    module: TracingModule,
    global: isGlobal,
    imports: [...imports],
    providers,
    exports: [TRACING_OPTIONS, TRACING_RUNTIME, ObserveTracer, TracingInterceptor],
  };
}

export class TracingModule {
  static forRoot(options: TracingOptions = {}): DynamicModule {
    return buildTracingModule(
      { provide: TRACING_OPTIONS, useValue: options },
      [],
      [],
      options.global ?? true,
    );
  }

  static forRootAsync(options: TracingAsyncOptions): DynamicModule {
    const imports = options.imports ?? [];
    const isGlobal = options.global ?? true;

    if (options.useFactory !== undefined) {
      return buildTracingModule(
        {
          provide: TRACING_OPTIONS,
          useFactory: options.useFactory,
          inject: [...(options.inject ?? [])],
        },
        imports,
        [],
        isGlobal,
      );
    }

    if (options.useClass !== undefined) {
      return buildTracingModule(
        {
          provide: TRACING_OPTIONS,
          useFactory: async (factory: TracingOptionsFactory): Promise<TracingOptions> =>
            await factory.createTracingOptions(),
          inject: [TRACING_OPTIONS_FACTORY],
        },
        imports,
        [{ provide: TRACING_OPTIONS_FACTORY, useClass: options.useClass }],
        isGlobal,
      );
    }

    if (options.useExisting !== undefined) {
      return buildTracingModule(
        {
          provide: TRACING_OPTIONS,
          useFactory: async (factory: TracingOptionsFactory): Promise<TracingOptions> =>
            await factory.createTracingOptions(),
          inject: [options.useExisting],
        },
        imports,
        [],
        isGlobal,
      );
    }

    throw new InvalidConfigurationException(
      'TracingModule.forRootAsync requires useFactory, useClass, or useExisting',
    );
  }
}

Module({})(TracingModule);
