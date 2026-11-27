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
import type { MetricsOptions } from './metrics.contracts.js';
import { MetricsRuntime } from './metrics.runtime.js';
import { ObserveMetrics } from './observe-metrics.service.js';

export const METRICS_OPTIONS = Symbol.for('observe.metrics.options');
export const METRICS_RUNTIME = Symbol.for('observe.metrics.runtime');
export const OBSERVE_METRICS = ObserveMetrics;

export interface MetricsOptionsFactory {
  createMetricsOptions(): MetricsOptions | Promise<MetricsOptions>;
}

export interface MetricsAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  readonly inject?: readonly InjectionToken[];
  readonly global?: boolean;
  readonly useFactory?: (...args: readonly unknown[]) => MetricsOptions | Promise<MetricsOptions>;
  readonly useClass?: Type<MetricsOptionsFactory>;
  readonly useExisting?: InjectionToken;
}

const METRICS_OPTIONS_FACTORY = Symbol.for('observe.metrics.options_factory');

export class MetricsLifecycleService implements OnModuleDestroy, OnApplicationShutdown {
  private shutdownPromise: Promise<void> | undefined;

  constructor(private readonly runtime: MetricsRuntime) {}

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

Injectable()(MetricsLifecycleService);
Inject(METRICS_RUNTIME)(MetricsLifecycleService, undefined, 0);

function buildMetricsModule(
  optionsProvider: Provider,
  imports: NonNullable<ModuleMetadata['imports']>,
  extraProviders: readonly Provider[],
  isGlobal: boolean,
): DynamicModule {
  const providers: Provider[] = [
    optionsProvider,
    ...extraProviders,
    {
      provide: METRICS_RUNTIME,
      useFactory: (options: MetricsOptions): MetricsRuntime => {
        const runtime = new MetricsRuntime(options);
        runtime.initialize();
        return runtime;
      },
      inject: [METRICS_OPTIONS],
    },
    {
      provide: ObserveMetrics,
      useFactory: (runtime: MetricsRuntime, options: MetricsOptions): ObserveMetrics =>
        new ObserveMetrics(runtime, options.cardinality),
      inject: [METRICS_RUNTIME, METRICS_OPTIONS],
    },
    MetricsLifecycleService,
  ];

  return {
    module: MetricsModule,
    global: isGlobal,
    imports: [...imports],
    providers,
    exports: [METRICS_OPTIONS, METRICS_RUNTIME, ObserveMetrics],
  };
}

export class MetricsModule {
  static forRoot(options: MetricsOptions = {}): DynamicModule {
    return buildMetricsModule(
      { provide: METRICS_OPTIONS, useValue: options },
      [],
      [],
      options.global ?? true,
    );
  }

  static forRootAsync(options: MetricsAsyncOptions): DynamicModule {
    const imports = options.imports ?? [];
    const isGlobal = options.global ?? true;

    if (options.useFactory !== undefined) {
      return buildMetricsModule(
        {
          provide: METRICS_OPTIONS,
          useFactory: options.useFactory,
          inject: [...(options.inject ?? [])],
        },
        imports,
        [],
        isGlobal,
      );
    }

    if (options.useClass !== undefined) {
      return buildMetricsModule(
        {
          provide: METRICS_OPTIONS,
          useFactory: async (factory: MetricsOptionsFactory): Promise<MetricsOptions> =>
            await factory.createMetricsOptions(),
          inject: [METRICS_OPTIONS_FACTORY],
        },
        imports,
        [{ provide: METRICS_OPTIONS_FACTORY, useClass: options.useClass }],
        isGlobal,
      );
    }

    if (options.useExisting !== undefined) {
      return buildMetricsModule(
        {
          provide: METRICS_OPTIONS,
          useFactory: async (factory: MetricsOptionsFactory): Promise<MetricsOptions> =>
            await factory.createMetricsOptions(),
          inject: [options.useExisting],
        },
        imports,
        [],
        isGlobal,
      );
    }

    throw new InvalidConfigurationException(
      'MetricsModule.forRootAsync requires useFactory, useClass, or useExisting',
    );
  }
}

Module({})(MetricsModule);
