import { LoggerException } from './logger.exception.js';

export class OptionalPeerMissingException extends LoggerException {
  constructor(
    readonly specifier: string,
    purpose?: string,
    cause?: unknown,
  ) {
    const detail = purpose === undefined ? '' : ` for ${purpose}`;
    const reason = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Optional peer dependency "${specifier}" is required${detail}${reason}`, cause);
  }
}
