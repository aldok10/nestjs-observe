import { LoggerException } from './logger.exception.js';

export class ChannelNotFoundException extends LoggerException {
  constructor(readonly channel: string) {
    super(`Unknown channel: ${channel}`);
  }
}

export const ChannelNotFoundError = ChannelNotFoundException;
export const UnknownChannelError = ChannelNotFoundException;
