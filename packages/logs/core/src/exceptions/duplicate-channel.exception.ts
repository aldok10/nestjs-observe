import { LoggerException } from './logger.exception.js';

export class DuplicateChannelException extends LoggerException {
  constructor(readonly channel: string) {
    super(`Duplicate channel: ${channel}`);
  }
}
