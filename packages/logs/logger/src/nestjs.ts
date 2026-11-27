export {
  NESTJS_ADAPTER_CAPABILITIES,
  NestjsAdapter,
  NestjsLoggerAdapter,
} from './nestjs-logger.adapter.js';
export type {
  AdapterOptions as NestjsAdapterOptions,
  LoggerServiceLike,
} from './nestjs-logger.adapter.js';
export {
  DEV_LOGGER,
  DevLoggerModule,
  LOGGER_OPTIONS,
  LOG_TRANSPORTS,
  LifecycleService,
  LoggerAdapterRegistry,
  LoggerModule,
  OBSERVE_LOGGER,
  ObserveLoggerModule,
  createLoggerToken,
} from './logger.module.js';
export { InjectLogger } from './channel.module.js';

export type { ChannelConfiguration, ChannelsOptions } from '@aldok10/nestjs-observe-logger-core';
export type {
  ChannelRecordConfiguration,
  DevLoggerAsyncOptions,
  DevLoggerChannels,
  DevLoggerOptions,
  DevLoggerOptionsFactory,
  ObserveLoggerAsyncOptions,
  ObserveLoggerChannels,
  ObserveLoggerOptions,
  ObserveLoggerOptionsFactory,
} from './logger.module.js';
