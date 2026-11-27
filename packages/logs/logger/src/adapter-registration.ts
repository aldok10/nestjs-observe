import type { InjectionToken, Provider, Type } from '@nestjs/common';
import type { LoggerAdapter } from '@aldok10/nestjs-observe-logger-core/contracts';
import { InvalidLoggerConfigurationException } from '@aldok10/nestjs-observe-logger-core/exceptions';
import { AdapterResolver } from '@aldok10/nestjs-observe-logger-core';
import { NestjsLoggerAdapter } from './nestjs-logger.adapter.js';

export type AdapterClass = Type<LoggerAdapter>;

export interface AdapterClassRegistration {
  readonly name?: string;
  readonly useClass: AdapterClass;
}

export interface AdapterValueRegistration {
  readonly name?: string;
  readonly useValue: LoggerAdapter;
}

export interface AdapterFactoryRegistration {
  readonly name?: string;
  readonly useFactory: (...args: readonly unknown[]) => LoggerAdapter | Promise<LoggerAdapter>;
  readonly inject?: readonly InjectionToken[];
}

export type AdapterRegistration =
  | LoggerAdapter
  | AdapterClass
  | AdapterClassRegistration
  | AdapterValueRegistration
  | AdapterFactoryRegistration;

export const REGISTERED_ADAPTERS = Symbol.for('cisea.logger.REGISTERED_ADAPTERS');

function isAdapterInstance(value: unknown): value is LoggerAdapter {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'create' in value &&
    typeof value.create === 'function'
  );
}

function wrapWithName(adapter: LoggerAdapter, name: string | undefined): LoggerAdapter {
  if (name === undefined || adapter.name === name) return adapter;
  return {
    name,
    ...(adapter.capabilities !== undefined ? { capabilities: adapter.capabilities } : {}),
    ...(adapter.initialize !== undefined
      ? { initialize: (options) => adapter.initialize?.(options) }
      : {}),
    create: (logger, options) => adapter.create(logger, options),
    ...(adapter.dispose !== undefined ? { dispose: () => adapter.dispose?.() } : {}),
  };
}

export class AdapterRegistryBuilder {
  buildResolver(adapters: readonly LoggerAdapter[]): AdapterResolver {
    const resolver = new AdapterResolver();
    const hasNestjs = adapters.some((adapter) => adapter.name === 'nestjs');
    if (!hasNestjs) {
      resolver.register(new NestjsLoggerAdapter());
    }
    // The same instance may arrive from both static and async registration; register it once.
    // Distinct instances sharing a name still raise DuplicateAdapterException.
    const seen = new Set<LoggerAdapter>();
    for (const adapter of adapters) {
      if (seen.has(adapter)) continue;
      seen.add(adapter);
      resolver.register(adapter);
    }
    return resolver;
  }

  async resolveRegistrations(
    registrations: readonly AdapterRegistration[],
  ): Promise<readonly LoggerAdapter[]> {
    return Promise.all(registrations.map((registration) => this.resolveSingle(registration)));
  }

  createProviders(registrations: readonly AdapterRegistration[]): Provider[] {
    const tokens: symbol[] = [];
    const providers: Provider[] = [];

    registrations.forEach((registration, index) => {
      const token = Symbol.for(`cisea.logger.adapter.${index}`);
      tokens.push(token);

      if (isAdapterInstance(registration)) {
        providers.push({ provide: token, useValue: registration });
        return;
      }
      if (typeof registration === 'function') {
        providers.push({ provide: token, useClass: registration });
        return;
      }
      if ('useValue' in registration) {
        providers.push({
          provide: token,
          useValue: wrapWithName(registration.useValue, registration.name),
        });
        return;
      }
      if ('useClass' in registration) {
        if (registration.name === undefined) {
          providers.push({ provide: token, useClass: registration.useClass });
          return;
        }
        const rawToken = Symbol.for(`cisea.logger.adapter.raw.${index}`);
        providers.push(
          { provide: rawToken, useClass: registration.useClass },
          {
            provide: token,
            useFactory: (adapter: LoggerAdapter) => wrapWithName(adapter, registration.name),
            inject: [rawToken],
          },
        );
        return;
      }
      if ('useFactory' in registration) {
        providers.push({
          provide: token,
          useFactory: async (...args: readonly unknown[]) =>
            wrapWithName(await registration.useFactory(...args), registration.name),
          inject: [...(registration.inject ?? [])],
        });
        return;
      }
      throw new InvalidLoggerConfigurationException('Unsupported adapter registration entry');
    });

    providers.push({
      provide: REGISTERED_ADAPTERS,
      useFactory: (...resolved: LoggerAdapter[]) => resolved,
      inject: tokens,
    });
    return providers;
  }

  private async resolveSingle(registration: AdapterRegistration): Promise<LoggerAdapter> {
    if (isAdapterInstance(registration)) return registration;
    if (typeof registration === 'function') return new registration();
    if ('useValue' in registration) return wrapWithName(registration.useValue, registration.name);
    if ('useClass' in registration) {
      return wrapWithName(new registration.useClass(), registration.name);
    }
    if ('useFactory' in registration) {
      return wrapWithName(await registration.useFactory(), registration.name);
    }
    throw new InvalidLoggerConfigurationException('Unsupported adapter registration entry');
  }
}
