import 'reflect-metadata';
import {
  Logger,
  Module,
  type DynamicModule,
  type InjectionToken,
  type ModuleMetadata,
  type Provider,
  type Type,
} from '@nestjs/common';
import type {
  ChannelConfiguration,
  ChannelsOptions,
  LoggerManager,
} from '@aldok10/nestjs-observe-logger-core';
import { LogContextStore } from '@aldok10/nestjs-observe-logger-core/context';
import type {
  BackendConfig,
  FormatterType,
  LogContext,
  LogLevel,
  LogTransport,
  LoggerAdapter,
  RedactionOptions,
  UniversalLogger,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import { InvalidLoggerConfigurationException } from '@aldok10/nestjs-observe-logger-core/exceptions';
import {
  AdapterResolver,
  LifecycleManager,
  LogPipeline,
  UniversalLoggerImpl,
} from '@aldok10/nestjs-observe-logger-core';
import { ConsoleTransport } from '@aldok10/nestjs-observe-logger-transports/console';
import { hasExternalBackend, resolveBackendLogger } from './backend-adapter.js';
import {
  AdapterRegistryBuilder,
  REGISTERED_ADAPTERS,
  type AdapterRegistration,
} from './adapter-registration.js';
import {
  CHANNEL_ADAPTER_RESOLVER,
  CHANNEL_OPTIONS,
  ChannelModule,
  LOGGER_MANAGER,
  createLoggerToken as createChannelLoggerToken,
  type ChannelModuleAsyncOptions,
} from './channel.module.js';
import { LifecycleService } from './lifecycle.service.js';

export { LifecycleService };
export const LoggerAdapterRegistry = AdapterResolver;

export function createLoggerToken(name: string): symbol {
  return Symbol.for(`cisea.logger.${name}`);
}

export const OBSERVE_LOGGER = createLoggerToken('OBSERVE_LOGGER');
export const DEV_LOGGER = OBSERVE_LOGGER;
export const LOGGER_OPTIONS = createLoggerToken('LOGGER_OPTIONS');
export const LOG_TRANSPORTS = createLoggerToken('LOG_TRANSPORTS');
export const ADAPTER_REGISTRY = AdapterResolver;
const OPTIONS_FACTORY = createLoggerToken('DEV_LOGGER_OPTIONS_FACTORY');
const RESOLVED_ADAPTERS = createLoggerToken('RESOLVED_ADAPTERS');

type ModuleImports = NonNullable<ModuleMetadata['imports']>;

export type ChannelRecordConfiguration = Record<
  string,
  Omit<ChannelConfiguration, 'name'> & { default?: boolean }
>;

export type DevLoggerChannels =
  ChannelsOptions | readonly ChannelConfiguration[] | ChannelRecordConfiguration;

export interface DevLoggerOptions {
  readonly adapters?: readonly AdapterRegistration[];
  readonly defaultAdapter?: string;
  readonly backend?: BackendConfig;
  readonly format?: FormatterType;
  readonly redaction?: RedactionOptions;
  readonly transports?: readonly LogTransport[];
  readonly context?: LogContext;
  readonly level?: LogLevel;
  readonly channels?: DevLoggerChannels;
  readonly global?: boolean;
}

export interface DevLoggerOptionsFactory {
  createDevLoggerOptions(): DevLoggerOptions | Promise<DevLoggerOptions>;
}

export interface DevLoggerAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  readonly adapters?: readonly AdapterRegistration[];
  readonly channels?: readonly string[];
  readonly inject?: readonly InjectionToken[];
  readonly global?: boolean;
  readonly useFactory?: (
    ...args: readonly unknown[]
  ) => DevLoggerOptions | Promise<DevLoggerOptions>;
  readonly useClass?: Type<DevLoggerOptionsFactory>;
  readonly useExisting?: InjectionToken;
}

const ADAPTER_REGISTRY_BUILDER = new AdapterRegistryBuilder();

function optionsFromFactoryToken(factoryToken: InjectionToken): Provider {
  return {
    provide: LOGGER_OPTIONS,
    useFactory: async (source: DevLoggerOptionsFactory): Promise<DevLoggerOptions> =>
      await source.createDevLoggerOptions(),
    inject: [factoryToken],
  };
}

function isChannelsOptions(value: DevLoggerChannels): value is ChannelsOptions {
  return 'channels' in value && Array.isArray(value.channels);
}

function isDevLoggerOptionsFactory(value: unknown): value is DevLoggerOptionsFactory {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createDevLoggerOptions' in value &&
    typeof value.createDevLoggerOptions === 'function'
  );
}

function isDevLoggerOptions(value: unknown): value is DevLoggerOptions {
  return (
    typeof value === 'object' &&
    value !== null &&
    !('then' in value && typeof value.then === 'function')
  );
}

function hasConfiguredBackend(options: DevLoggerOptions): boolean {
  return hasExternalBackend(options.backend) || options.defaultAdapter !== undefined;
}

export function normalizeChannels(channels: DevLoggerChannels): ChannelsOptions {
  let source: ChannelsOptions;
  if (Array.isArray(channels)) {
    source = { channels };
  } else if (isChannelsOptions(channels)) {
    source = channels;
  } else {
    const entries = Object.entries(channels);
    const defaultEntry = entries.find(([, config]) => config.default === true);
    const configs: ChannelConfiguration[] = [];
    for (const [name, config] of entries) {
      const { default: _ignoredDefault, ...channelConfig } = config;
      configs.push({ ...channelConfig, name });
    }
    source = {
      channels: configs,
      ...(defaultEntry !== undefined ? { defaultChannel: defaultEntry[0] } : {}),
    };
  }
  const { defaultChannel: sourceDefault, ...rest } = source;
  const defaultChannel = sourceDefault ?? rest.channels[0]?.name;
  return {
    ...rest,
    ...(defaultChannel !== undefined ? { defaultChannel } : {}),
    unknownChannel: rest.unknownChannel ?? 'throw',
  };
}

function channelAliasProviders(defaultName: string | undefined): Provider[] {
  const defaultProvider: Provider =
    defaultName !== undefined
      ? { provide: DEV_LOGGER, useExisting: createChannelLoggerToken(defaultName) }
      : {
          provide: DEV_LOGGER,
          useFactory: (manager: LoggerManager) => manager.getLogger(),
          inject: [LOGGER_MANAGER],
        };
  return [defaultProvider, { provide: Logger, useExisting: DEV_LOGGER }];
}

function buildChannelResolver(registrations: readonly AdapterRegistration[] = []): Provider[] {
  return [
    ...ADAPTER_REGISTRY_BUILDER.createProviders(registrations),
    {
      provide: CHANNEL_ADAPTER_RESOLVER,
      useFactory: (adapters: readonly LoggerAdapter[]): AdapterResolver =>
        ADAPTER_REGISTRY_BUILDER.buildResolver(adapters),
      inject: [REGISTERED_ADAPTERS],
    },
  ];
}

function buildChannelModule(
  options: DevLoggerOptions,
  optionsProvider: Provider,
  imports: ModuleImports = [],
): DynamicModule {
  const channels = options.channels;
  if (channels === undefined) {
    throw new InvalidLoggerConfigurationException('LoggerModule channel options are missing');
  }
  const normalized = normalizeChannels(channels);
  const registrations = options.adapters ?? [];
  const channelModule = ChannelModule.forRoot(normalized);

  if (registrations.length > 0) {
    const adapterModule = class {};
    const adapterProviders = buildChannelResolver(registrations);
    Module({
      providers: adapterProviders,
      exports: [CHANNEL_ADAPTER_RESOLVER],
    })(adapterModule);
    const wrappedChannelModule: DynamicModule = {
      ...channelModule,
      imports: [...(channelModule.imports ?? []), adapterModule],
    };
    return {
      module: LoggerModule,
      global: options.global ?? true,
      imports: [...imports, wrappedChannelModule],
      providers: [optionsProvider, ...channelAliasProviders(normalized.defaultChannel)],
      exports: [LOGGER_OPTIONS, DEV_LOGGER, Logger, wrappedChannelModule],
    };
  }

  return {
    module: LoggerModule,
    global: options.global ?? true,
    imports: [...imports, channelModule],
    providers: [optionsProvider, ...channelAliasProviders(normalized.defaultChannel)],
    exports: [LOGGER_OPTIONS, DEV_LOGGER, Logger, channelModule],
  };
}

function buildAsyncChannelModule(options: DevLoggerAsyncOptions): DynamicModule {
  const imports: ModuleImports = [...(options.imports ?? [])];
  const declaredChannels = options.channels ?? [];
  let cachedDevOptions: DevLoggerOptions | undefined;

  const toChannelsOptions = (devOptions: DevLoggerOptions): ChannelsOptions => {
    cachedDevOptions = devOptions;
    if (devOptions.channels === undefined) {
      throw new InvalidLoggerConfigurationException(
        'LoggerModule async channel configuration must return channels',
      );
    }
    return normalizeChannels(devOptions.channels);
  };

  let channelAsync: ChannelModuleAsyncOptions;
  if (options.useFactory !== undefined) {
    const factory = options.useFactory;
    channelAsync = {
      imports,
      channels: declaredChannels,
      ...(options.inject !== undefined ? { inject: options.inject } : {}),
      useFactory: async (...args: readonly unknown[]) => toChannelsOptions(await factory(...args)),
    };
  } else if (options.useClass !== undefined) {
    const FactoryClass = options.useClass;
    const ProxyFactoryModule = class {};
    Module({
      ...(imports.length > 0 ? { imports } : {}),
      providers: [FactoryClass],
      exports: [FactoryClass],
    })(ProxyFactoryModule);
    channelAsync = {
      imports: [...imports, ProxyFactoryModule],
      channels: declaredChannels,
      inject: [FactoryClass],
      useFactory: async (source: unknown) => {
        if (!isDevLoggerOptionsFactory(source)) {
          throw new InvalidLoggerConfigurationException(
            'LoggerModule options factory must implement createDevLoggerOptions()',
          );
        }
        return toChannelsOptions(await source.createDevLoggerOptions());
      },
    };
  } else {
    const existing = options.useExisting;
    if (existing === undefined) {
      throw new InvalidLoggerConfigurationException(
        'LoggerModule.forRootAsync requires useExisting when useFactory and useClass are omitted',
      );
    }
    channelAsync = {
      imports,
      channels: declaredChannels,
      inject: [existing],
      useFactory: async (source: unknown) => {
        if (!isDevLoggerOptionsFactory(source)) {
          throw new InvalidLoggerConfigurationException(
            'LoggerModule options factory must implement createDevLoggerOptions()',
          );
        }
        return toChannelsOptions(await source.createDevLoggerOptions());
      },
    };
  }

  const channelModule = ChannelModule.forRootAsync(channelAsync);
  const staticRegistrations = options.adapters ?? [];
  const adapterProviders: Provider[] = [
    ...ADAPTER_REGISTRY_BUILDER.createProviders(staticRegistrations),
    {
      provide: CHANNEL_ADAPTER_RESOLVER,
      useFactory: async (
        _channelOptions: ChannelsOptions,
        diAdapters: readonly LoggerAdapter[],
      ): Promise<AdapterResolver> => {
        const dynamicRegistrations = cachedDevOptions?.adapters ?? [];
        const dynamicAdapters =
          dynamicRegistrations.length > 0
            ? await ADAPTER_REGISTRY_BUILDER.resolveRegistrations(dynamicRegistrations)
            : [];
        return ADAPTER_REGISTRY_BUILDER.buildResolver([...diAdapters, ...dynamicAdapters]);
      },
      inject: [CHANNEL_OPTIONS, REGISTERED_ADAPTERS],
    },
  ];
  channelModule.providers = [...(channelModule.providers ?? []), ...adapterProviders];
  channelModule.exports = [...(channelModule.exports ?? []), CHANNEL_ADAPTER_RESOLVER];

  return {
    module: LoggerModule,
    global: options.global ?? true,
    imports: [channelModule],
    providers: [
      {
        provide: LOGGER_OPTIONS,
        useFactory: (channelOptions: ChannelsOptions): DevLoggerOptions =>
          cachedDevOptions ?? { channels: channelOptions },
        inject: [CHANNEL_OPTIONS],
      },
      ...channelAliasProviders(undefined),
    ],
    exports: [LOGGER_OPTIONS, DEV_LOGGER, Logger, channelModule],
  };
}

function buildModule(
  optionsProviders: Provider | readonly Provider[],
  imports: ModuleImports = [],
  staticAdapters: readonly AdapterRegistration[] = [],
  staticIncludesOptionsAdapters = true,
  isGlobal = true,
): DynamicModule {
  const providers: Provider[] = [
    ...(Array.isArray(optionsProviders) ? optionsProviders : [optionsProviders]),
    ...ADAPTER_REGISTRY_BUILDER.createProviders(staticAdapters),
    {
      provide: LOG_TRANSPORTS,
      useFactory: (options: DevLoggerOptions): readonly LogTransport[] => {
        if (options.transports !== undefined) return options.transports;
        if (hasConfiguredBackend(options)) return [];
        return [new ConsoleTransport()];
      },
      inject: [LOGGER_OPTIONS],
    },
    {
      provide: LogPipeline,
      useFactory: (options: DevLoggerOptions, transports: readonly LogTransport[]): LogPipeline => {
        const redaction = options.redaction ?? options.backend?.redaction;
        const format = options.format ?? options.backend?.format;
        return new LogPipeline({
          ...(redaction !== undefined ? { redaction } : {}),
          ...(format !== undefined ? { format } : {}),
          transports,
        });
      },
      inject: [LOGGER_OPTIONS, LOG_TRANSPORTS],
    },
    {
      provide: LogContextStore,
      useFactory: (options: DevLoggerOptions): LogContextStore => {
        const store = new LogContextStore();
        const context = options.context ?? options.backend?.context;
        if (context !== undefined) store.set(context);
        return store;
      },
      inject: [LOGGER_OPTIONS],
    },
    {
      provide: UniversalLoggerImpl,
      useFactory: (
        options: DevLoggerOptions,
        pipeline: LogPipeline,
        store: LogContextStore,
      ): UniversalLoggerImpl => {
        const level = options.level ?? options.backend?.level;
        return new UniversalLoggerImpl({
          pipeline,
          context: store,
          ...(level !== undefined ? { level } : {}),
        });
      },
      inject: [LOGGER_OPTIONS, LogPipeline, LogContextStore],
    },
    {
      provide: RESOLVED_ADAPTERS,
      useFactory: async (
        options: DevLoggerOptions,
        diAdapters: readonly LoggerAdapter[],
      ): Promise<readonly LoggerAdapter[]> => {
        if (staticIncludesOptionsAdapters || options.adapters === undefined) {
          return diAdapters;
        }
        const dynamicAdapters = await ADAPTER_REGISTRY_BUILDER.resolveRegistrations(
          options.adapters,
        );
        return [...diAdapters, ...dynamicAdapters];
      },
      inject: [LOGGER_OPTIONS, REGISTERED_ADAPTERS],
    },
    {
      provide: AdapterResolver,
      useFactory: (adapters: readonly LoggerAdapter[]): AdapterResolver =>
        ADAPTER_REGISTRY_BUILDER.buildResolver(adapters),
      inject: [RESOLVED_ADAPTERS],
    },
    {
      provide: LifecycleManager,
      useFactory: (transports: readonly LogTransport[]): LifecycleManager => {
        const manager = new LifecycleManager();
        manager.register(...transports);
        return manager;
      },
      inject: [LOG_TRANSPORTS],
    },
    {
      provide: LifecycleService,
      useFactory: (
        manager: LifecycleManager,
        options: DevLoggerOptions,
        adapters: readonly LoggerAdapter[],
      ): LifecycleService => {
        const level = options.level ?? options.backend?.level ?? 'info';
        const redaction = options.redaction ?? options.backend?.redaction;
        const format = options.format ?? options.backend?.format;
        const context = options.context ?? options.backend?.context;
        return new LifecycleService(manager, adapters, {
          level,
          ...(redaction !== undefined ? { redaction } : {}),
          ...(format !== undefined ? { format } : {}),
          ...(context !== undefined ? { context } : {}),
        });
      },
      inject: [LifecycleManager, LOGGER_OPTIONS, RESOLVED_ADAPTERS],
    },
    {
      provide: DEV_LOGGER,
      useFactory: (
        options: DevLoggerOptions,
        impl: UniversalLoggerImpl,
        pipeline: LogPipeline,
        resolver: AdapterResolver,
        store: LogContextStore,
      ): UniversalLogger => {
        if (!hasConfiguredBackend(options)) return impl;

        const level = options.level ?? options.backend?.level ?? 'trace';
        const redaction = options.redaction ?? options.backend?.redaction;
        const format = options.format ?? options.backend?.format;
        const context = options.context ?? options.backend?.context;
        const adapterOptions = {
          level,
          contextStore: store,
          ...(redaction !== undefined ? { redaction } : {}),
          ...(format !== undefined ? { format } : {}),
          ...(context !== undefined ? { context } : {}),
          ...(options.transports !== undefined
            ? {
                sink: (record: Parameters<LogPipeline['emit']>[0]) => pipeline.emit(record),
                ownership: 'package' as const,
              }
            : { ownership: 'backend' as const }),
        };

        if (options.backend !== undefined) {
          return resolveBackendLogger(options.backend, resolver, adapterOptions);
        }
        const defaultName = options.defaultAdapter;
        if (defaultName === undefined) return impl;
        return resolver.resolve(defaultName).create(undefined, adapterOptions);
      },
      inject: [LOGGER_OPTIONS, UniversalLoggerImpl, LogPipeline, AdapterResolver, LogContextStore],
    },
    { provide: Logger, useExisting: DEV_LOGGER },
  ];

  const module: DynamicModule = {
    module: LoggerModule,
    global: isGlobal,
    providers,
    exports: [
      DEV_LOGGER,
      LOGGER_OPTIONS,
      LOG_TRANSPORTS,
      LogPipeline,
      LogContextStore,
      UniversalLoggerImpl,
      AdapterResolver,
      LifecycleManager,
      LifecycleService,
      Logger,
    ],
  };
  if (imports.length > 0) module.imports = imports;
  return module;
}

export class LoggerModule {
  static forRoot(options: DevLoggerOptions): DynamicModule {
    if (options.channels !== undefined) {
      return buildChannelModule(options, { provide: LOGGER_OPTIONS, useValue: options });
    }
    return buildModule(
      { provide: LOGGER_OPTIONS, useValue: options },
      [],
      options.adapters ?? [],
      true,
      options.global ?? true,
    );
  }

  static forFeature(channels: readonly string[]): DynamicModule {
    return ChannelModule.forFeature(channels);
  }

  static forRootAsync(options: DevLoggerAsyncOptions): DynamicModule {
    const strategies = [options.useFactory, options.useClass, options.useExisting].filter(
      (value) => value !== undefined,
    );
    if (strategies.length !== 1) {
      throw new InvalidLoggerConfigurationException(
        'LoggerModule.forRootAsync requires exactly one of useFactory, useClass or useExisting',
      );
    }

    if (options.channels !== undefined) {
      return buildAsyncChannelModule(options);
    }

    const imports: ModuleImports = [...(options.imports ?? [])];
    const staticAdapters = options.adapters ?? [];

    if (options.useFactory !== undefined) {
      const factory = options.useFactory;
      if ((options.inject ?? []).length === 0) {
        let eager: DevLoggerOptions | undefined;
        try {
          const value: unknown = factory();
          if (isDevLoggerOptions(value)) eager = value;
        } catch {
          // Keep the factory provider; Nest surfaces resolution errors.
        }
        if (eager !== undefined) {
          const optionsProvider = { provide: LOGGER_OPTIONS, useValue: eager };
          if (eager.channels !== undefined) {
            return buildChannelModule(
              staticAdapters.length > 0 && eager.adapters === undefined
                ? { ...eager, adapters: staticAdapters }
                : eager,
              optionsProvider,
              imports,
            );
          }
          return buildModule(
            optionsProvider,
            imports,
            [...staticAdapters, ...(eager.adapters ?? [])],
            true,
            options.global ?? eager.global ?? true,
          );
        }
      }
      return buildModule(
        {
          provide: LOGGER_OPTIONS,
          useFactory: factory,
          inject: [...(options.inject ?? [])],
        },
        imports,
        staticAdapters,
        false,
        options.global ?? true,
      );
    }

    if (options.useClass !== undefined) {
      return buildModule(
        [
          { provide: OPTIONS_FACTORY, useClass: options.useClass },
          optionsFromFactoryToken(OPTIONS_FACTORY),
        ],
        imports,
        staticAdapters,
        false,
        options.global ?? true,
      );
    }

    const existing = options.useExisting;
    if (existing === undefined) {
      throw new InvalidLoggerConfigurationException(
        'LoggerModule.forRootAsync requires useExisting when useFactory and useClass are omitted',
      );
    }
    return buildModule(
      optionsFromFactoryToken(existing),
      imports,
      staticAdapters,
      false,
      options.global ?? true,
    );
  }
}

Module({})(LoggerModule);

export const ObserveLoggerModule = LoggerModule;
export const DevLoggerModule = LoggerModule;
export type ObserveLoggerChannels = DevLoggerChannels;
export type ObserveLoggerOptions = DevLoggerOptions;
export type ObserveLoggerOptionsFactory = DevLoggerOptionsFactory;
export type ObserveLoggerAsyncOptions = DevLoggerAsyncOptions;
