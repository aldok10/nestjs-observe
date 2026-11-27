import 'reflect-metadata';
import {
  Global,
  Inject,
  Module,
  type DynamicModule,
  type InjectionToken,
  type ModuleMetadata,
  type Provider,
  type Type,
} from '@nestjs/common';
import {
  createLoggerManager,
  type AdapterResolver,
  type ChannelConfiguration,
  type ChannelName,
  type ChannelsOptions,
  type LoggerFactory,
  type LoggerManager,
} from '@aldok10/nestjs-observe-logger-core';
import { InvalidLoggerConfigurationException } from '@aldok10/nestjs-observe-logger-core/exceptions';
import { LifecycleService } from './lifecycle.service.js';

export { LifecycleService };

export function createLoggerToken(name: string): string {
  return `LOGGER_CHANNEL:${name}`;
}

export const LOGGER_MANAGER = Symbol.for('cisea.channels.LOGGER_MANAGER');
export const LOGGER_CONTEXT = Symbol.for('cisea.channels.LOGGER_CONTEXT');
export const CHANNEL_REGISTRY = Symbol.for('cisea.channels.CHANNEL_REGISTRY');
export const CHANNEL_ROUTER = Symbol.for('cisea.channels.CHANNEL_ROUTER');
export const TRANSPORT_MANAGER = Symbol.for('cisea.channels.TRANSPORT_MANAGER');
export const LOGGER_FACTORY = Symbol.for('cisea.channels.LOGGER_FACTORY');
export const CHANNEL_OPTIONS = Symbol.for('cisea.channels.CHANNEL_OPTIONS');
export const CHANNEL_ADAPTER_RESOLVER = Symbol.for('cisea.channels.ADAPTER_RESOLVER');
const CHANNEL_OPTIONS_FACTORY = Symbol.for('cisea.channels.CHANNEL_OPTIONS_FACTORY');

type ModuleImports = NonNullable<ModuleMetadata['imports']>;

export function InjectLogger(name: string): ParameterDecorator & PropertyDecorator {
  return Inject(createLoggerToken(name));
}

export interface ChannelOptionsFactory {
  createChannelOptions(): ChannelsOptions | Promise<ChannelsOptions>;
}

export interface ChannelModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  readonly channels?: readonly string[];
  readonly resolver?: AdapterResolver;
  readonly inject?: readonly InjectionToken[];
  readonly useFactory?: (...args: readonly unknown[]) => ChannelsOptions | Promise<ChannelsOptions>;
  readonly useClass?: Type<ChannelOptionsFactory>;
  readonly useExisting?: InjectionToken;
}

function isChannelsOptions(value: unknown): value is ChannelsOptions {
  return (
    typeof value === 'object' &&
    value !== null &&
    'channels' in value &&
    Array.isArray(value.channels)
  );
}

function createChannelProviders(names: readonly ChannelName[]): {
  tokens: string[];
  providers: Provider[];
} {
  const unique = [...new Set(names)];
  const tokens = unique.map((name) => createLoggerToken(name));
  const providers: Provider[] = unique.map((name) => ({
    provide: createLoggerToken(name),
    useFactory: (factory: LoggerFactory) => factory.getLogger(name),
    inject: [LOGGER_FACTORY],
  }));
  return { tokens, providers };
}

function buildModule(
  optionsProviders: Provider | readonly Provider[],
  imports: ModuleImports = [],
  channelNames: readonly ChannelName[] = [],
  resolver?: AdapterResolver,
): DynamicModule {
  const { tokens, providers: channelTokenProviders } = createChannelProviders(channelNames);
  const providers: Provider[] = [
    ...(Array.isArray(optionsProviders) ? optionsProviders : [optionsProviders]),
    ...(resolver !== undefined ? [{ provide: CHANNEL_ADAPTER_RESOLVER, useValue: resolver }] : []),
    {
      provide: LOGGER_MANAGER,
      useFactory: (options: ChannelsOptions, injectedResolver?: AdapterResolver): LoggerManager =>
        createLoggerManager(
          options,
          injectedResolver !== undefined ? { resolver: injectedResolver } : undefined,
        ),
      inject: [CHANNEL_OPTIONS, { token: CHANNEL_ADAPTER_RESOLVER, optional: true }],
    },
    {
      provide: LOGGER_CONTEXT,
      useFactory: (manager: LoggerManager) => manager.context,
      inject: [LOGGER_MANAGER],
    },
    {
      provide: CHANNEL_REGISTRY,
      useFactory: (manager: LoggerManager) => manager.registry,
      inject: [LOGGER_MANAGER],
    },
    {
      provide: CHANNEL_ROUTER,
      useFactory: (manager: LoggerManager) => manager.router,
      inject: [LOGGER_MANAGER],
    },
    {
      provide: TRANSPORT_MANAGER,
      useFactory: (manager: LoggerManager) => manager.transports,
      inject: [LOGGER_MANAGER],
    },
    {
      provide: LOGGER_FACTORY,
      useFactory: (manager: LoggerManager) => manager.factory,
      inject: [LOGGER_MANAGER],
    },
    {
      provide: LifecycleService,
      useFactory: (manager: LoggerManager) => new LifecycleService(manager),
      inject: [LOGGER_MANAGER],
    },
    ...channelTokenProviders,
  ];

  const dynamic: DynamicModule = {
    module: ChannelModule,
    global: true,
    providers,
    exports: [
      CHANNEL_OPTIONS,
      LOGGER_MANAGER,
      LOGGER_CONTEXT,
      CHANNEL_REGISTRY,
      CHANNEL_ROUTER,
      TRANSPORT_MANAGER,
      LOGGER_FACTORY,
      LifecycleService,
      ...tokens,
    ],
  };
  if (imports.length > 0) dynamic.imports = imports;
  return dynamic;
}

export class ChannelModule {
  static forRoot(options: ChannelsOptions, resolver?: AdapterResolver): DynamicModule {
    return buildModule(
      { provide: CHANNEL_OPTIONS, useValue: options },
      [],
      options.channels.map((channel: ChannelConfiguration) => channel.name),
      resolver,
    );
  }

  static forFeature(channels: readonly string[]): DynamicModule {
    const { tokens, providers } = createChannelProviders(channels);
    return {
      module: ChannelModule,
      providers,
      exports: tokens,
    };
  }

  static forRootAsync(options: ChannelModuleAsyncOptions): DynamicModule {
    const strategies = [options.useFactory, options.useClass, options.useExisting].filter(
      (value) => value !== undefined,
    );
    if (strategies.length !== 1) {
      throw new InvalidLoggerConfigurationException(
        'ChannelModule.forRootAsync requires exactly one of useFactory, useClass or useExisting',
      );
    }

    const imports: ModuleImports = [...(options.imports ?? [])];
    const declaredChannels = options.channels ?? [];

    if (options.useFactory !== undefined) {
      const inject = [...(options.inject ?? [])];
      let eager: ChannelsOptions | undefined;
      if (inject.length === 0) {
        try {
          const value = options.useFactory();
          if (isChannelsOptions(value)) eager = value;
        } catch {
          // Keep the factory provider; resolution errors surface from Nest.
        }
      }
      const names = [
        ...(eager?.channels.map((channel) => channel.name) ?? []),
        ...declaredChannels,
      ];
      return buildModule(
        eager !== undefined
          ? { provide: CHANNEL_OPTIONS, useValue: eager }
          : { provide: CHANNEL_OPTIONS, useFactory: options.useFactory, inject },
        imports,
        names,
        options.resolver,
      );
    }

    if (options.useClass !== undefined) {
      return buildModule(
        [
          { provide: CHANNEL_OPTIONS_FACTORY, useClass: options.useClass },
          {
            provide: CHANNEL_OPTIONS,
            useFactory: async (factory: ChannelOptionsFactory) =>
              await factory.createChannelOptions(),
            inject: [CHANNEL_OPTIONS_FACTORY],
          },
        ],
        imports,
        declaredChannels,
        options.resolver,
      );
    }

    const existing = options.useExisting;
    if (existing === undefined) {
      throw new InvalidLoggerConfigurationException(
        'ChannelModule.forRootAsync requires useExisting when useFactory and useClass are omitted',
      );
    }
    return buildModule(
      {
        provide: CHANNEL_OPTIONS,
        useFactory: async (factory: ChannelOptionsFactory) => await factory.createChannelOptions(),
        inject: [existing],
      },
      imports,
      declaredChannels,
      options.resolver,
    );
  }
}

Module({})(ChannelModule);
Global()(ChannelModule);
