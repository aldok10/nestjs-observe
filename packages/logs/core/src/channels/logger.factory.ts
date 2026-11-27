import type { LogContextStore } from '../context/log-context-store.js';
import { ChannelNotFoundException, UnknownChannelError } from '../exceptions/index.js';
import { ChannelConfigResolver } from './channel-config.resolver.js';
import type {
  ChannelConfiguration,
  ChannelName,
  UnknownChannelPolicy,
} from './channel.contracts.js';
import { ChannelLogger } from './channel-logger.js';
import type { ChannelRegistry } from './channel-registry.js';
import type { ChannelRouter } from './channel-router.js';
import type { TransportManager } from './transport-manager.js';

export { ChannelNotFoundException, UnknownChannelError };
export { LoggerFactory as ChannelFactory };
export type { LoggerFactoryOptions as ChannelFactoryOptions };

export interface LoggerFactoryOptions<N extends ChannelName> {
  readonly registry: ChannelRegistry<N>;
  readonly transports: TransportManager<N>;
  readonly router: ChannelRouter<N>;
  readonly context?: LogContextStore;
  readonly unknownChannel?: UnknownChannelPolicy;
  readonly onUnknownChannel?: (name: string) => ChannelConfiguration | undefined;
}

export class LoggerFactory<N extends ChannelName = ChannelName> {
  private readonly cache = new Map<string, ChannelLogger<N>>();
  private readonly configResolver = new ChannelConfigResolver();

  constructor(private readonly options: LoggerFactoryOptions<N>) {}

  getLogger(name: N): ChannelLogger<N>;
  getLogger(name: string): ChannelLogger<N>;
  getLogger(name: string): ChannelLogger<N> {
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;
    if (this.options.registry.has(name)) return this.storeInCache(name, this.createLogger(name));

    if (this.options.unknownChannel === 'create' && this.isDynamicChannelName(name)) {
      const raw = this.options.onUnknownChannel?.(name);
      const config = this.toChannelConfig(name, raw);
      const resolved = this.configResolver.resolve(config);
      this.options.registry.register(resolved);
      this.options.transports.build(resolved);
      return this.storeInCache(name, this.createLogger(name));
    }
    if (this.options.unknownChannel === 'throw') throw new ChannelNotFoundException(name);

    // 'drop': the router has no pipeline for this origin, so records go nowhere.
    if (this.isDynamicChannelName(name)) {
      return this.storeInCache(name, this.createLogger(name));
    }
    throw new ChannelNotFoundException(name);
  }

  private createLogger(name: N): ChannelLogger<N> {
    const resolved = this.options.registry.has(name) ? this.options.registry.get(name) : undefined;
    const level = resolved?.level;
    const pipeline = this.options.transports.pipelines().get(name);
    const baseContext =
      resolved?.metadata !== undefined ? { metadata: resolved.metadata } : undefined;
    return new ChannelLogger(
      name,
      this.options.router,
      this.options.context,
      level,
      pipeline,
      baseContext,
    );
  }

  private toChannelConfig(name: N, raw: ChannelConfiguration | undefined): ChannelConfiguration<N> {
    if (raw === undefined) return { name };
    const { routes: rawRoutes, ...rest } = raw;
    if (rawRoutes === undefined) return { ...rest, name };
    const routes: NonNullable<ChannelConfiguration<N>['routes']>[number][] = [];
    for (const route of rawRoutes) {
      routes.push({
        ...(route.when !== undefined ? { when: route.when } : {}),
        to: this.isDynamicChannelName(route.to) ? route.to : name,
      });
    }
    return { ...rest, name, routes };
  }

  private isDynamicChannelName(name: string): name is N {
    return name.length > 0;
  }

  private storeInCache(name: string, logger: ChannelLogger<N>): ChannelLogger<N> {
    this.cache.set(name, logger);
    return logger;
  }
}
