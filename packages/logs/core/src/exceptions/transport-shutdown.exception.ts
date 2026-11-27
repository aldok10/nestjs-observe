import { LoggerException } from './logger.exception.js';

export class TransportShutdownException extends LoggerException {
  constructor(readonly failures: readonly string[]) {
    super(`shutdown failed: ${failures.join('; ')}`);
  }
}
