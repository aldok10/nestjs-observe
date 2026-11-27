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
import type { ErrorTrackingOptions } from './error-tracking.contracts.js';
import { ErrorTrackingRuntime } from './error-tracking.runtime.js';
import { ObserveErrorTracker } from './observe-error-tracker.service.js';

export const ERROR_TRACKING_OPTIONS = Symbol.for('observe.error_tracking.options');
export const ERROR_TRACKING_RUNTIME = Symbol.for('observe.error_tracking.runtime');
export const OBSERVE_ERROR_TRACKER = Symbol.for('observe.error_tracking.tracker');

export function InjectErrorTracker(): ParameterDecorator {
  return Inject(OBSERVE_ERROR_TRACKER);
}

export interface ErrorTrackingOptionsFactory {
  createErrorTrackingOptions(): ErrorTrackingOptions | Promise<ErrorTrackingOptions>;
}

export interface ErrorTrackingAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  readonly inject?: readonly InjectionToken[];
  readonly global?: boolean;
  readonly useFactory?: (
    ...args: readonly unknown[]
  ) => ErrorTrackingOptions | Promise<ErrorTrackingOptions>;
  readonly useClass?: Type<ErrorTrackingOptionsFactory>;
  readonly useExisting?: InjectionToken;
}

const ERROR_TRACKING_OPTIONS_FACTORY = Symbol.for('observe.error_tracking.options_factory');

export class ErrorTrackingLifecycleService implements OnModuleDestroy, OnApplicationShutdown {
  private shutdownPromise: Promise<void> | undefined;

  constructor(private readonly runtime: ErrorTrackingRuntime) {}

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

Injectable()(ErrorTrackingLifecycleService);
Inject(ERROR_TRACKING_RUNTIME)(ErrorTrackingLifecycleService, undefined, 0);

function buildErrorTrackingModule(
  optionsProvider: Provider,
  imports: NonNullable<ModuleMetadata['imports']>,
  extraProviders: readonly Provider[],
  isGlobal: boolean,
): DynamicModule {
  const providers: Provider[] = [
    optionsProvider,
    ...extraProviders,
    {
      provide: ERROR_TRACKING_RUNTIME,
      useFactory: async (options: ErrorTrackingOptions): Promise<ErrorTrackingRuntime> => {
        const runtime = new ErrorTrackingRuntime(options);
        await runtime.initialize();
        return runtime;
      },
      inject: [ERROR_TRACKING_OPTIONS],
    },
    {
      provide: ObserveErrorTracker,
      useFactory: (runtime: ErrorTrackingRuntime): ObserveErrorTracker =>
        new ObserveErrorTracker(runtime),
      inject: [ERROR_TRACKING_RUNTIME],
    },
    {
      provide: OBSERVE_ERROR_TRACKER,
      useExisting: ObserveErrorTracker,
    },
    ErrorTrackingLifecycleService,
  ];

  return {
    module: ErrorTrackingModule,
    global: isGlobal,
    imports: [...imports],
    providers,
    exports: [
      ERROR_TRACKING_OPTIONS,
      ERROR_TRACKING_RUNTIME,
      OBSERVE_ERROR_TRACKER,
      ObserveErrorTracker,
    ],
  };
}

export class ErrorTrackingModule {
  static forRoot(options: ErrorTrackingOptions = {}): DynamicModule {
    return buildErrorTrackingModule(
      { provide: ERROR_TRACKING_OPTIONS, useValue: options },
      [],
      [],
      options.global ?? true,
    );
  }

  static forRootAsync(options: ErrorTrackingAsyncOptions): DynamicModule {
    const imports = options.imports ?? [];
    const isGlobal = options.global ?? true;

    if (options.useFactory !== undefined) {
      return buildErrorTrackingModule(
        {
          provide: ERROR_TRACKING_OPTIONS,
          useFactory: options.useFactory,
          inject: [...(options.inject ?? [])],
        },
        imports,
        [],
        isGlobal,
      );
    }

    if (options.useClass !== undefined) {
      return buildErrorTrackingModule(
        {
          provide: ERROR_TRACKING_OPTIONS,
          useFactory: async (factory: ErrorTrackingOptionsFactory): Promise<ErrorTrackingOptions> =>
            await factory.createErrorTrackingOptions(),
          inject: [ERROR_TRACKING_OPTIONS_FACTORY],
        },
        imports,
        [{ provide: ERROR_TRACKING_OPTIONS_FACTORY, useClass: options.useClass }],
        isGlobal,
      );
    }

    if (options.useExisting !== undefined) {
      return buildErrorTrackingModule(
        {
          provide: ERROR_TRACKING_OPTIONS,
          useFactory: async (factory: ErrorTrackingOptionsFactory): Promise<ErrorTrackingOptions> =>
            await factory.createErrorTrackingOptions(),
          inject: [options.useExisting],
        },
        imports,
        [],
        isGlobal,
      );
    }

    throw new InvalidConfigurationException(
      'ErrorTrackingModule.forRootAsync requires useFactory, useClass, or useExisting',
    );
  }
}

Module({})(ErrorTrackingModule);
