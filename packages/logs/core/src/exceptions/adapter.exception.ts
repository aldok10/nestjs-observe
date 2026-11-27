import { LoggerException } from './logger.exception.js';

export class DuplicateAdapterException extends LoggerException {
  constructor(readonly adapterName: string) {
    super(`Duplicate logger adapter: ${adapterName}`);
  }
}

export class AdapterNotFoundException extends LoggerException {
  constructor(readonly adapterName: string) {
    super(
      `Unknown logger adapter: ${adapterName}. Register it explicitly via AdapterResolver/adapter registry, or install a matching adapter package such as @aldok10/nestjs-observe-logger-${adapterName}.`,
    );
  }
}
