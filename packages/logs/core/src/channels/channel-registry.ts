import { ChannelNotFoundException, DuplicateChannelException } from '../exceptions/index.js';
import type { ChannelName, ResolvedChannel } from './channel.contracts.js';

export { ChannelNotFoundException, DuplicateChannelException };

export class ChannelRegistry<N extends ChannelName = ChannelName> {
  private readonly channels = new Map<string, ResolvedChannel<N>>();

  constructor(channels: readonly ResolvedChannel<N>[] = []) {
    for (const channel of channels) this.register(channel);
  }

  has(name: string): name is N {
    return this.channels.has(name);
  }

  get(name: string): ResolvedChannel<N> {
    const channel = this.channels.get(name);
    if (channel === undefined) throw new ChannelNotFoundException(name);
    return channel;
  }

  register(resolved: ResolvedChannel<N>): void {
    if (this.channels.has(resolved.name)) {
      throw new DuplicateChannelException(resolved.name);
    }
    this.channels.set(resolved.name, resolved);
  }

  names(): readonly N[] {
    return [...this.channels.values()].map((channel) => channel.name);
  }
}
