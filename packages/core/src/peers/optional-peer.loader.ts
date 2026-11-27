import { createRequire } from 'node:module';
import { OptionalPeerMissingException } from '../exceptions/index.js';

export class OptionalPeerLoader {
  private readonly cache = new Map<string, unknown>();
  private readonly requireModule: NodeRequire;

  constructor(importMetaUrl?: string) {
    const base = importMetaUrl ?? (typeof __filename === 'string' ? __filename : import.meta.url);
    this.requireModule = createRequire(base);
  }

  load(packageName: string, featureName: string): unknown {
    if (this.cache.has(packageName)) return this.cache.get(packageName);
    try {
      const loaded: unknown = this.requireModule(packageName);
      this.cache.set(packageName, loaded);
      return loaded;
    } catch (error: unknown) {
      throw new OptionalPeerMissingException(packageName, featureName, error);
    }
  }

  tryLoad(packageName: string): unknown {
    if (this.cache.has(packageName)) return this.cache.get(packageName);
    try {
      const loaded: unknown = this.requireModule(packageName);
      this.cache.set(packageName, loaded);
      return loaded;
    } catch {
      return undefined;
    }
  }
}

const DEFAULT_PEER_LOADER = new OptionalPeerLoader();

export function loadOptionalPeer(packageName: string, featureName: string): unknown {
  return DEFAULT_PEER_LOADER.load(packageName, featureName);
}

export function tryLoadOptionalPeer(packageName: string): unknown {
  return DEFAULT_PEER_LOADER.tryLoad(packageName);
}
