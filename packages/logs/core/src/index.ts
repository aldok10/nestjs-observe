// Curated public surface. Internal modules stay private; add exports here deliberately.
export { LOG_LEVELS, isLogLevel, levelIndex, normalizeLogLevel } from './contracts/index.js';
export type {
  AdapterCapabilities,
  BackendConfig,
  BackendConfigBase,
  DeliveryResult,
  FormatterOptions,
  FormatterType,
  LifecycleManaged,
  LifecycleOwner,
  LogContext,
  LogContextProvider,
  LogEvent,
  LogFilter,
  LogFormatter,
  LogLevel,
  LogMetadata,
  LogPipelineError,
  LogPipelineOptions,
  LogRecord,
  LogRedactor,
  LogSerializer,
  LogSource,
  LogTransport,
  LoggerAdapter,
  LoggerAdapterOptions,
  RedactionMatcher,
  RedactionOptions,
  RemoteLogTransport,
  ResolverOptions,
  SerializedError,
  TimestampFormat,
  TransportHealth,
  UniversalLogger,
} from './contracts/index.js';

export {
  AdapterNotFoundException,
  DuplicateAdapterException,
  DuplicateChannelException,
  InvalidLoggerConfigurationException,
  LoggerException,
  OptionalPeerMissingException,
  TransportShutdownException,
  UnknownChannelError,
  ChannelNotFoundException,
} from './exceptions/index.js';

export {
  LogRecordFactory,
  createLogRecord,
  ErrorSerializer,
  serializeError,
} from './record/index.js';

export {
  RedactionEngine,
  isSanitized,
  markSanitized,
  safeString,
  sanitize,
} from './redaction/index.js';
export type { SafeValue } from './redaction/index.js';

export {
  LogRecordNormalizer,
  defaultFormatter,
  registerFormatter,
  resolveFormatter,
  stringField,
} from './formatters/index.js';

export {
  LogContextStore,
  createCorrelationContext,
  generateCorrelationId,
  generateRequestId,
  generateSpanId,
  generateTraceId,
  mergeContexts,
} from './context/index.js';

export { FilterEngine, LogPipeline } from './pipeline/index.js';
export { UniversalLoggerImpl } from './logger/index.js';
export type { LogSink } from './logger/index.js';
export { AdapterResolver } from './resolver/index.js';
export { BoundedExecution, LifecycleManager } from './lifecycle/index.js';

export { AdapterLogBridge, LevelMappingResolver } from './adapters/index.js';
export type {
  AdapterBridgeParams,
  AdapterLogger,
  AdapterOptionsBase,
  LevelMap,
  ResolvedLevelMap,
} from './adapters/index.js';

export type {
  ChannelConfiguration,
  ChannelName,
  ChannelPredicate,
  ChannelRoute,
  ChannelsOptions,
  ResolvedChannel,
  UnknownChannelPolicy,
} from './channels/channel.contracts.js';
export {
  ChannelLogger,
  LoggerFactory,
  LoggerManager,
  createLoggerManager,
} from './channels/index.js';

export {
  LOGGER_CONFIG_DEFAULTS,
  normalizeLoggerConfig,
  readEnv,
  readLoggerConfigFromEnv,
  readProcessEnvelope,
  resolveLoggerConfig,
} from './config/index.js';
export type {
  EnvSource,
  LoggerConfig,
  LoggerConfigInput,
  ResolveLoggerConfigOptions,
} from './config/index.js';
