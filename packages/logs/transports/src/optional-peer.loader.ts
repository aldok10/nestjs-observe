import { createRequire } from 'node:module';
import { OptionalPeerMissingException } from '@aldok10/nestjs-observe-logger-core/exceptions';

// Resolves optional peers relative to this package.
export class OptionalPeerLoader {
  private readonly requireModule = createRequire(import.meta.url);

  load(specifier: string, purpose?: string): unknown {
    try {
      return this.requireModule(specifier) as unknown;
    } catch (error: unknown) {
      throw new OptionalPeerMissingException(specifier, purpose, error);
    }
  }
}

const DEFAULT_PEER_LOADER = new OptionalPeerLoader();

export function loadOptionalPeer(specifier: string, purpose?: string): unknown {
  return DEFAULT_PEER_LOADER.load(specifier, purpose);
}
