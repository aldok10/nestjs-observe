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
import type { ObserverOptions } from './observer.contracts.js';
import { ObserverRuntime } from './observer.runtime.js';
import { ObserverService } from './observer.service.js';

export const OBSERVER_OPTIONS = Symbol.for('observe.observer.options');
export const OBSERVER_RUNTIME = Symbol.for('observe.observer.runtime');
export const OBSERVER_CONTEXT = Symbol.for('observe.observer.context');
export const OBSERVE_LOGGER = Symbol.for('observe.observer.logger');
export const OBSERVE_TRACER = Symbol.for('observe.observer.tracer');
export const OBSERVE_METRICS = Symbol.for('observe.observer.metrics');
export const OBSERVE_ERROR_TRACKER = Symbol.for('observe.observer.error_tracker');

export interface ObserverOptionsFactory {
  createObserverOptions(): ObserverOptions | Promise<ObserverOptions>;
}

export interface ObserverAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  readonly inject?: readonly InjectionToken[];
  readonly global?: boolean;
  readonly useFactory?: (...args: readonly unknown[]) => ObserverOptions | Promise<ObserverOptions>;
  readonly useClass?: Type<ObserverOptionsFactory>;
  readonly useExisting?: InjectionToken;
}

const OBSERVER_OPTIONS_FACTORY = Symbol.for('observe.observer.options_factory');

export class ObserverLifecycleService implements OnModuleDestroy, OnApplicationShutdown {
  private shutdownPromise: Promise<void> | undefined;

  constructor(private readonly runtime: ObserverRuntime) {}

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

Injectable()(ObserverLifecycleService);
Inject(OBSERVER_RUNTIME)(ObserverLifecycleService, undefined, 0);

function buildObserverModule(
  optionsProvider: Provider,
  imports: NonNullable<ModuleMetadata['imports']>,
  extraProviders: readonly Provider[],
  isGlobal: boolean,
): DynamicModule {
  const providers: Provider[] = [
    optionsProvider,
    ...extraProviders,
    {
      provide: OBSERVER_RUNTIME,
      useFactory: async (options: ObserverOptions): Promise<ObserverRuntime> => {
        const runtime = new ObserverRuntime(options);
        await runtime.initialize();
        return runtime;
      },
      inject: [OBSERVER_OPTIONS],
    },
    {
      provide: ObserverService,
      useFactory: (runtime: ObserverRuntime): ObserverService => new ObserverService(runtime),
      inject: [OBSERVER_RUNTIME],
    },
    {
      provide: OBSERVER_CONTEXT,
      useFactory: (runtime: ObserverRuntime) => runtime.contextStore,
      inject: [OBSERVER_RUNTIME],
    },
    {
      provide: OBSERVE_LOGGER,
      useFactory: (runtime: ObserverRuntime) => runtime.logger,
      inject: [OBSERVER_RUNTIME],
    },
    {
      provide: OBSERVE_TRACER,
      useFactory: (runtime: ObserverRuntime) => runtime.tracer,
      inject: [OBSERVER_RUNTIME],
    },
    {
      provide: OBSERVE_METRICS,
      useFactory: (runtime: ObserverRuntime) => runtime.metrics,
      inject: [OBSERVER_RUNTIME],
    },
    {
      provide: OBSERVE_ERROR_TRACKER,
      useFactory: (runtime: ObserverRuntime) => runtime.errorTracker,
      inject: [OBSERVER_RUNTIME],
    },
    ObserverLifecycleService,
  ];

  return {
    module: ObserverModule,
    global: isGlobal,
    imports: [...imports],
    providers,
    exports: [
      OBSERVER_OPTIONS,
      OBSERVER_RUNTIME,
      OBSERVER_CONTEXT,
      OBSERVE_LOGGER,
      OBSERVE_TRACER,
      OBSERVE_METRICS,
      OBSERVE_ERROR_TRACKER,
      ObserverService,
    ],
  };
}

export class ObserverModule {
  static forRoot(options: ObserverOptions = {}): DynamicModule {
    return buildObserverModule(
      { provide: OBSERVER_OPTIONS, useValue: options },
      [],
      [],
      options.global ?? true,
    );
  }

  static forRootAsync(options: ObserverAsyncOptions): DynamicModule {
    const imports = options.imports ?? [];
    const isGlobal = options.global ?? true;

    if (options.useFactory !== undefined) {
      return buildObserverModule(
        {
          provide: OBSERVER_OPTIONS,
          useFactory: options.useFactory,
          inject: [...(options.inject ?? [])],
        },
        imports,
        [],
        isGlobal,
      );
    }

    if (options.useClass !== undefined) {
      return buildObserverModule(
        {
          provide: OBSERVER_OPTIONS,
          useFactory: async (factory: ObserverOptionsFactory): Promise<ObserverOptions> =>
            await factory.createObserverOptions(),
          inject: [OBSERVER_OPTIONS_FACTORY],
        },
        imports,
        [{ provide: OBSERVER_OPTIONS_FACTORY, useClass: options.useClass }],
        isGlobal,
      );
    }

    if (options.useExisting !== undefined) {
      return buildObserverModule(
        {
          provide: OBSERVER_OPTIONS,
          useFactory: async (factory: ObserverOptionsFactory): Promise<ObserverOptions> =>
            await factory.createObserverOptions(),
          inject: [options.useExisting],
        },
        imports,
        [],
        isGlobal,
      );
    }

    throw new InvalidConfigurationException(
      'ObserverModule.forRootAsync requires useFactory, useClass, or useExisting',
    );
  }
}

Module({})(ObserverModule);
