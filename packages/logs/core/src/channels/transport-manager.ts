import {
  BackendTransportAdapter,
  hasExternalBackend,
} from '../adapters/backend-transport.adapter.js';
import type { LogTransport, TransportHealth } from '../contracts/index.js';
import { LifecycleManager } from '../lifecycle/lifecycle-manager.js';
import { LogPipeline } from '../pipeline/log-pipeline.js';
import { AdapterResolver } from '../resolver/adapter.resolver.js';
import type { ChannelName, ResolvedChannel } from './channel.contracts.js';

export class TransportManager<N extends ChannelName = ChannelName> {
  private readonly registered = new Set<LogTransport>();
  private readonly channelPipelines = new Map<N, LogPipeline>();
  private readonly healthSources = new Map<LogTransport, () => TransportHealth | undefined>();
  private readonly resolver: AdapterResolver;

  constructor(
    private readonly lifecycle: LifecycleManager = new LifecycleManager(),
    resolver?: AdapterResolver,
  ) {
    this.resolver = resolver ?? new AdapterResolver();
  }

  build(config: ResolvedChannel<N>): LogPipeline {
    const transports = [...config.transports];
    if (hasExternalBackend(config.backend)) {
      transports.push(
        new BackendTransportAdapter(config.backend, this.resolver, {
          level: config.level,
          format: config.format,
          redaction: config.redaction,
        }),
      );
    }
    this.register(...transports);
    const pipeline = new LogPipeline({
      transports,
      ...(config.format !== undefined ? { format: config.format } : {}),
      ...(config.redaction !== undefined ? { redaction: config.redaction } : {}),
    });
    this.channelPipelines.set(config.name, pipeline);
    transports.forEach((transport, index) => {
      this.healthSources.set(transport, () => pipeline.health()[index]);
    });
    return pipeline;
  }

  register(...transports: readonly LogTransport[]): void {
    for (const transport of transports) {
      if (this.registered.has(transport)) continue;
      this.registered.add(transport);
      this.lifecycle.register(transport);
    }
  }

  pipelines(): ReadonlyMap<N, LogPipeline> {
    return this.channelPipelines;
  }

  async flush(timeoutMs?: number): Promise<void> {
    await this.lifecycle.flush(timeoutMs);
  }

  async shutdown(signal?: string, timeoutMs?: number): Promise<void> {
    await this.lifecycle.shutdown(signal, timeoutMs);
  }

  health(): readonly TransportHealth[] {
    const result: TransportHealth[] = [];
    for (const transport of this.registered) {
      let entry: TransportHealth | undefined;
      try {
        entry = this.healthSources.get(transport)?.() ?? transport.health?.();
      } catch {
        entry = undefined;
      }
      result.push(
        entry ?? {
          name: transport.name,
          status: 'healthy',
          healthy: true,
          queued: 0,
          capacity: 0,
          dropped: 0,
          sent: 0,
          failed: 0,
        },
      );
    }
    return result;
  }
}
