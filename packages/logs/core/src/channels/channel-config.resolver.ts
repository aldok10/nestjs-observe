import { InvalidLoggerConfigurationException } from '../exceptions/index.js';
import type { ChannelConfiguration, ChannelName, ResolvedChannel } from './channel.contracts.js';

export class ChannelConfigResolver {
  resolve<N extends ChannelName>(config: ChannelConfiguration<N>): ResolvedChannel<N> {
    if (typeof config.name !== 'string' || config.name.trim().length === 0) {
      throw new InvalidLoggerConfigurationException(
        'Channel configuration requires a non-empty name',
      );
    }
    return {
      name: config.name,
      enabled: config.enabled !== false,
      ...(config.level !== undefined ? { level: config.level } : {}),
      ...(config.format !== undefined ? { format: config.format } : {}),
      ...(config.redaction !== undefined ? { redaction: config.redaction } : {}),
      filters: config.filters ?? [],
      transports: config.transports ?? [],
      ...(config.backend !== undefined ? { backend: config.backend } : {}),
      routes: config.routes ?? [],
      ...(config.metadata !== undefined ? { metadata: config.metadata } : {}),
    };
  }
}

const DEFAULT_CHANNEL_CONFIG_RESOLVER = new ChannelConfigResolver();

export function resolveChannel<N extends ChannelName>(
  config: ChannelConfiguration<N>,
): ResolvedChannel<N> {
  return DEFAULT_CHANNEL_CONFIG_RESOLVER.resolve(config);
}

export { ChannelConfigResolver as ChannelResolver };
