import { LogContextStore } from '../context/log-context-store.js';
import type { LogContext, TransportHealth } from '../contracts/index.js';
import { ChannelNotFoundException, LoggerException } from '../exceptions/index.js';
import type { AdapterResolver } from '../resolver/adapter.resolver.js';
import { ChannelConfigResolver } from './channel-config.resolver.js';
import type { ChannelConfiguration, ChannelName, ChannelsOptions } from './channel.contracts.js';
import type { ChannelLogger } from './channel-logger.js';
import { ChannelRegistry } from './channel-registry.js';
import { ChannelRouter } from './channel-router.js';
import { LoggerFactory } from './logger.factory.js';
import { TransportManager } from './transport-manager.js';

export interface LoggerManagerDeps {
  readonly context?: LogContextStore;
  readonly resolver?: AdapterResolver;
}

export class LoggerManager<N extends ChannelName = ChannelName> {
  readonly context: LogContextStore;
  readonly registry: ChannelRegistry<N>;
  readonly transports: TransportManager<N>;
  readonly router!: ChannelRouter<N>;
  readonly factory!: LoggerFactory<N>;

  private readonly configResolver = new ChannelConfigResolver();
  private shutDown = false;
  private shutdownInFlight: Promise<void> | undefined;

  constructor(
    private readonly options: ChannelsOptions<N>,
    deps: LoggerManagerDeps = {},
  ) {
    this.context = deps.context ?? new LogContextStore();
    this.registry = new ChannelRegistry<N>();
    this.transports = new TransportManager<N>(undefined, deps.resolver);
    try {
      for (const config of options.channels) {
        const resolved = this.configResolver.resolve(config);
        this.registry.register(resolved);
        this.transports.build(resolved);
      }
      this.router = new ChannelRouter(this.registry, this.transports.pipelines());
      this.factory = new LoggerFactory({
        registry: this.registry,
        transports: this.transports,
        router: this.router,
        context: this.context,
        ...(options.unknownChannel !== undefined ? { unknownChannel: options.unknownChannel } : {}),
        ...(options.onUnknownChannel !== undefined
          ? { onUnknownChannel: options.onUnknownChannel }
          : {}),
      });
      if (options.defaultChannel !== undefined && !this.registry.has(options.defaultChannel)) {
        throw new ChannelNotFoundException(options.defaultChannel);
      }
    } catch (error) {
      this.shutDown = true;
      // Best-effort rollback: startup failure must not leave owned transports running.
      void this.transports.shutdown('startup-failure', 1000).catch(() => undefined);
      throw error;
    }
  }

  getLogger(): ChannelLogger<N>;
  getLogger(name: N | string): ChannelLogger<N>;
  getLogger(name?: string): ChannelLogger<N> {
    if (name === undefined) {
      if (this.options.defaultChannel === undefined) {
        throw new ChannelNotFoundException('<default>');
      }
      return this.factory.getLogger(this.options.defaultChannel);
    }
    return this.factory.getLogger(name);
  }

  registerChannel(config: ChannelConfiguration): ChannelLogger {
    if (this.shutDown) throw new LoggerException('Cannot register channels after shutdown');
    const resolved = this.configResolver.resolve(this.toChannelConfig(config));
    this.registry.register(resolved);
    this.transports.build(resolved);
    return this.factory.getLogger(config.name);
  }

  private toChannelConfig(config: ChannelConfiguration): ChannelConfiguration<N> {
    const name = this.isChannelName(config.name) ? config.name : undefined;
    if (name === undefined) throw new LoggerException('Channel name cannot be empty');
    const { routes: rawRoutes, ...rest } = config;
    if (rawRoutes === undefined) return { ...rest, name };
    const routes: NonNullable<ChannelConfiguration<N>['routes']>[number][] = [];
    for (const route of rawRoutes) {
      routes.push({
        ...(route.when !== undefined ? { when: route.when } : {}),
        to: this.isChannelName(route.to) ? route.to : name,
      });
    }
    return { ...rest, name, routes };
  }

  private isChannelName(name: string): name is N {
    return name.length > 0;
  }

  run<T>(context: LogContext, fn: () => T): T {
    return this.context.run(context, fn);
  }

  async flush(timeoutMs?: number): Promise<void> {
    await this.transports.flush(timeoutMs ?? this.options.shutdownTimeoutMs);
  }

  shutdown(signal?: string, timeoutMs?: number): Promise<void> {
    if (this.shutdownInFlight !== undefined) return this.shutdownInFlight;
    this.shutDown = true;
    this.shutdownInFlight = this.transports.shutdown(
      signal,
      timeoutMs ?? this.options.shutdownTimeoutMs,
    );
    return this.shutdownInFlight;
  }

  async close(timeoutMs?: number): Promise<void> {
    await this.shutdown('close', timeoutMs);
  }

  health(): readonly TransportHealth[] {
    return this.transports.health();
  }
}

export function createLoggerManager<N extends ChannelName = ChannelName>(
  options: ChannelsOptions<N>,
  deps?: LoggerManagerDeps,
): LoggerManager<N> {
  return new LoggerManager<N>(options, deps);
}
