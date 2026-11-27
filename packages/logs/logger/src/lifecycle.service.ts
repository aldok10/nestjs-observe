import 'reflect-metadata';
import {
  Injectable,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  LoggerAdapter,
  LoggerAdapterOptions,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import { TransportShutdownException } from '@aldok10/nestjs-observe-logger-core/exceptions';

export interface ShutdownCapable {
  shutdown(signal?: string, timeoutMs?: number): Promise<void>;
}

export class LifecycleService implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown {
  private readonly manager: ShutdownCapable;
  private readonly adapters: readonly LoggerAdapter[];
  private readonly adapterOptions: LoggerAdapterOptions | undefined;
  private initPromise: Promise<void> | undefined;
  private shutdownPromise: Promise<void> | undefined;
  private readonly initialized: LoggerAdapter[] = [];

  constructor(
    manager: ShutdownCapable,
    adapters: readonly LoggerAdapter[] = [],
    adapterOptions?: LoggerAdapterOptions,
  ) {
    this.manager = manager;
    this.adapters = adapters;
    this.adapterOptions = adapterOptions;
  }

  onModuleInit(): Promise<void> {
    this.initPromise ??= this.initializeAdapters().catch(async (error: unknown) => {
      // A failed attempt must not be cached: the next hook can retry after the cause is fixed.
      this.initPromise = undefined;
      await this.rollbackInitialized();
      throw error;
    });
    return this.initPromise;
  }

  onModuleDestroy(): Promise<void> {
    return this.shutdown();
  }

  onApplicationShutdown(signal?: string): Promise<void> {
    return this.shutdown(signal);
  }

  private async initializeAdapters(): Promise<void> {
    const options: LoggerAdapterOptions = this.adapterOptions ?? { level: 'info' };
    for (const adapter of this.adapters) {
      if (adapter.initialize !== undefined) {
        // Adapters initialize in registration order so the first failure is deterministic.
        // oxlint-disable-next-line no-await-in-loop
        await adapter.initialize(options);
        this.initialized.push(adapter);
      }
    }
  }

  private async rollbackInitialized(): Promise<void> {
    const adapters = this.initialized.splice(0);
    await Promise.allSettled(
      adapters.map(async (adapter) => {
        if (adapter.dispose !== undefined) await adapter.dispose();
      }),
    );
  }

  private shutdown(signal?: string): Promise<void> {
    this.shutdownPromise ??= this.runShutdown(signal);
    return this.shutdownPromise;
  }

  private async runShutdown(signal?: string): Promise<void> {
    const failures: string[] = [];
    try {
      await this.manager.shutdown(signal);
    } catch (error: unknown) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    const disposeResults = await Promise.allSettled(
      this.adapters.map(async (adapter) => {
        if (adapter.dispose !== undefined) await adapter.dispose();
      }),
    );
    disposeResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        const name = this.adapters[index]?.name ?? 'adapter';
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.push(`${name}: ${message}`);
      }
    });
    if (failures.length > 0) {
      throw new TransportShutdownException(failures);
    }
  }
}

Injectable()(LifecycleService);
