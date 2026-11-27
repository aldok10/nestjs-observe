import type { LoggerAdapter } from '../contracts/index.js';
import {
  AdapterNotFoundException,
  DuplicateAdapterException,
  InvalidLoggerConfigurationException,
} from '../exceptions/index.js';

export class AdapterResolver {
  private readonly adapters = new Map<string, LoggerAdapter>();

  constructor(adapters: readonly LoggerAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: LoggerAdapter): this {
    if (typeof adapter.name !== 'string' || adapter.name.trim().length === 0) {
      throw new InvalidLoggerConfigurationException(
        'Logger adapter registration requires a non-empty name',
      );
    }
    if (this.adapters.has(adapter.name)) {
      throw new DuplicateAdapterException(adapter.name);
    }
    this.adapters.set(adapter.name, adapter);
    return this;
  }

  resolve(name: string): LoggerAdapter {
    const adapter = this.adapters.get(name);
    if (adapter === undefined) throw new AdapterNotFoundException(name);
    return adapter;
  }

  has(name: string): boolean {
    return this.adapters.has(name);
  }
}
